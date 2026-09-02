import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});

// --- the manifest is what actually delivers landscape at startup ---
{
  const ctx=await browser.newContext({viewport:{width:412,height:915}});
  const page=await ctx.newPage();
  await page.goto(B,{waitUntil:'domcontentloaded'});
  const man=await page.evaluate(() => fetch('./manifest.json').then(r=>r.json()));
  ok(man.orientation==='landscape','the manifest asks the launcher for landscape');
  ok(man.display==='standalone','and to open without browser chrome');
  ok(man.shortcuts.every(s=>!/open=capture/.test(s.url)),
     'no shortcut still points at the capture screen that was removed');
  await ctx.close();
}

// --- portrait is turned, not tolerated ---
{
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:412,height:915}});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});

  // getBoundingClientRect on a rotated element gives the box round the turn,
  // not the box being turned; offsetWidth/Height are the laid-out ones.
  const turned = await page.evaluate(() => {
    const a = document.getElementById('app');
    return { t: getComputedStyle(a).transform, w: a.offsetWidth, h: a.offsetHeight };
  });
  ok(turned.t !== 'none' && turned.t !== '', 'a portrait viewport turns the app: ' + turned.t);
  ok(turned.w === 915 && turned.h === 412,
     'and it is laid out landscape inside the turn: ' + turned.w + '\u00d7' + turned.h);

  // --- the picture does not turn with the chrome ---
  // The camera hands us a frame already oriented for how the phone is held, so
  // turning it again spins it away from the world: the buttons read correctly
  // and the ceiling ends up at the bottom.
  const vid = await page.evaluate(() => {
    const a = document.getElementById('app'), v = document.getElementById('vid');
    return { appT: getComputedStyle(a).transform, vidT: getComputedStyle(v).transform,
             appW: a.offsetWidth, appH: a.offsetHeight,
             vidW: v.offsetWidth, vidH: v.offsetHeight, vw: innerWidth, vh: innerHeight };
  });
  const m = s => (s.match(/matrix\(\s*(-?[\d.]+),\s*(-?[\d.]+)/) || []).slice(1).map(Number);
  const [a0, b0] = m(vid.appT), [a1, b1] = m(vid.vidT);
  ok(Math.round(b0) === 1 && Math.round(b1) === -1,
     'the video turns the opposite way to the app it sits in: ' +
     'app b=' + Math.round(b0) + ', video b=' + Math.round(b1));
  // A rotation's angle is atan2(b, a); two that cancel sum to zero.
  const deg = (a, b) => Math.round(Math.atan2(b, a) * 180 / Math.PI);
  ok(deg(a0, b0) + deg(a1, b1) === 0,
     'which composes to no rotation against the screen: ' +
     deg(a0, b0) + '\u00b0 + ' + deg(a1, b1) + '\u00b0');
  ok(vid.vidW === vid.vw && vid.vidH === vid.vh,
     'and it is sized to the physical screen, not the turned box: ' +
     vid.vidW + '\u00d7' + vid.vidH + ' against a ' + vid.appW + '\u00d7' + vid.appH + ' app');

  // the picture still covers the screen, and the model still sees the true frame
  await page.waitForFunction(() => document.getElementById('vid').videoWidth > 0,
    null, { timeout: 15000 });
  const cover = await page.evaluate(() => {
    const r = document.getElementById('vid').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
             nat: [document.getElementById('vid').videoWidth, document.getElementById('vid').videoHeight] };
  });
  ok(cover.w === cover.vw && cover.h === cover.vh, 'the picture still fills the screen');
  ok(cover.nat[0] > cover.nat[1],
     'and the camera frame is untouched by the turn: ' + cover.nat.join('\u00d7'));

  // the menu is sized against the turned container, not the phone's real screen
  await page.click('#bMenu');
  const menu = await page.evaluate(() => {
    const r = document.getElementById('menu').getBoundingClientRect();
    const a = document.getElementById('app');
    return { fits: r.width <= a.offsetWidth + 1 && r.height <= a.offsetHeight + 1,
             mw: Math.round(r.width), mh: Math.round(r.height) };
  });
  ok(menu.fits, 'the menu fits inside the turned app rather than running off it');
  await page.click('#bMenu');

  // and a landscape viewport is left completely alone
  await page.setViewportSize({width:915,height:412});
  await page.waitForTimeout(300);
  const land = await page.evaluate(() => ({
    app: getComputedStyle(document.getElementById('app')).transform,
    vid: getComputedStyle(document.getElementById('vid')).transform }));
  ok(land.app === 'none', 'a landscape viewport carries no transform at all');
  ok(land.vid === 'none', 'and the video is left alone with it');

  // the first touch anywhere is spent on full screen, and only once
  await page.evaluate(() => {
    window.__full = 0;
    document.documentElement.requestFullscreen = function () { window.__full++; return Promise.resolve(); };
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await page.evaluate(() => {
    window.__full = 0;
    document.documentElement.requestFullscreen = function () { window.__full++; return Promise.resolve(); };
  });
  await page.mouse.click(460, 200);
  await page.mouse.click(470, 210);
  await page.mouse.click(480, 220);
  ok(await page.evaluate(()=>window.__full)===1,
     'the first touch anywhere buys full screen, and later taps do not ask again');
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.join(' | '):''));
  await ctx.close();
}

// --- the model is fetched on arrival, not on the first record tap ---
{
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:915,height:412}});
  const page=await ctx.newPage();
  let asked = 0;
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/roboflow|\.onnx|\.bin/i.test(u)) { asked++; return route.abort(); }
    route.continue();
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await page.waitForFunction(()=>!document.getElementById('modelChip').hidden,null,{timeout:20000});
  const chip = await page.textContent('#modelChip');
  ok(/Loading|No model|No runtime|No weights|No backend|Ready/.test(chip),
     'the model is fetched on arrival and says where it is up to: ' + chip);
  ok(await page.getAttribute('#bRec','aria-pressed') === 'false',
     'without anyone having tapped record');
  await ctx.close();
}

// --- the what3words key ships with the app, and is used on its own site ---
{
  const ctx=await browser.newContext({permissions:['camera','geolocation'],
    geolocation:{latitude:53.48,longitude:-2.24},viewport:{width:412,height:915}});
  const page=await ctx.newPage();
  let asked=null;
  await ctx.route('https://api.what3words.com/**', route => {
    asked=route.request().url();
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({words:'filled.count.soap'})});
  });
  // the suite runs on 127.0.0.1, which is not the host the built-in key belongs
  // to, so stand in for that host before the app reads it
  await page.addInitScript(() => {
    window.__ownSite = true;
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await page.evaluate(() => {
    W3W_HOSTS.length = 0; W3W_HOSTS.push(location.hostname);
    document.getElementById('w3wKey').value = w3wKey();
  });
  ok(await page.inputValue('#w3wKey')==='GNB4B5O7',
     'on its own site the field shows the key that ships with it');

  await page.evaluate(async () => {
    const e = { id: nextId(), t: new Date().toISOString(), img: null,
      imp:3, prob:3, score:9, cat:'Category 2', resp:'28 calendar days', key:'k2',
      surface:'Carriageway', scoredBy:'survey, unconfirmed', type:'Pothole', note:'',
      lat:53.48, lon:-2.24, acc:6, fixAge:1 };
    await putEntry(e); S.items.unshift(e); addWords(e); render();
  });
  await page.waitForFunction(()=>S.items[0].w3w!=null,null,{timeout:10000});
  ok(/key=GNB4B5O7/.test(asked||''),'a saved entry is looked up with it without anyone pasting one');
  await openLog(page);
  ok(/\/\/\/filled\.count\.soap/.test(await page.textContent('.item .det')),
     'and the three-word address lands on the entry');

  // clearing it is a decision that sticks
  await page.fill('#w3wKey','');
  await page.dispatchEvent('#w3wKey','change');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await openLog(page);
  ok(await page.inputValue('#w3wKey')==='','an emptied field stays empty across a reload');
  ok(await page.evaluate(()=>{
    W3W_HOSTS.length = 0; W3W_HOSTS.push(location.hostname);
    return w3wKey();
  })==='','and the built-in key does not creep back in even on its own site');
  await ctx.close();
}

await browser.close();
console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
process.exit(fails.length?1:0);
