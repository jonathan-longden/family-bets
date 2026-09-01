import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const ctx=await browser.newContext({permissions:['camera','geolocation'],
  geolocation:{latitude:53.001,longitude:-1.1},viewport:{width:412,height:915}});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('dialog',d=>d.accept());
await page.goto(B,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});

// read out of app.js rather than hard-coded: this line had to be edited on
// every build bump, which makes it a test that only ever cries wolf
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
ok(await page.textContent('#build') === wantBuild,
   'the screen shows the build that is in app.js: ' + wantBuild);

// --- opens on the camera, with nothing over it ---
ok(await page.isVisible('#vid'),'the viewfinder is on screen at once');
ok(!await page.isVisible('#camGate'),'no gate in the way once the camera is live');
ok(!await page.isVisible('#p-log') && !await page.isVisible('#p-map'),'no sheet is open on arrival');
ok(await page.isVisible('#bRec') && !await page.isDisabled('#bRec'),'the record button is live');
ok(await page.isVisible('#bMenu'),'the three dots are on screen');
// nothing left of the old shell
for (const id of ['bShot','bStart','t-cap','t-log','t-map','bSurvey','bEnd','bFull']) {
  ok(!await page.isVisible('#'+id), 'the old '+id+' control is gone');
}

// --- the viewfinder fills the viewport ---
const box=await page.evaluate(()=>{const r=document.getElementById('vid').getBoundingClientRect();
  return {w:Math.round(r.width),h:Math.round(r.height),vw:innerWidth,vh:innerHeight};});
ok(box.w===box.vw && box.h===box.vh,'the picture is the whole screen ('+box.w+'×'+box.h+')');

// --- the menu ---
await page.click('#bMenu');
ok(await page.isVisible('#menu'),'the three dots open a menu');
ok(await page.isVisible('#mLog') && await page.isVisible('#mMap'),'the menu offers the log and the map');
await page.mouse.click(30, 200);   // away from the menu itself, in screen coordinates
ok(!await page.isVisible('#menu'),'tapping away closes it');

// --- seed a survey find, as the survey would write it ---
await page.evaluate(async () => {
  const c=document.createElement('canvas'); c.width=c.height=64;
  const x=c.getContext('2d'); x.fillStyle='#333'; x.fillRect(0,0,64,64);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.8));
  const e={id:nextId(),t:new Date().toISOString(),img:blob,
    imp:3,prob:3,score:9,cat:'Category 2',resp:'28 calendar days',key:'k2',
    surface:'Carriageway',scoredBy:'survey, unconfirmed',
    detConf:0.81,detShare:0.06,detCount:1,type:'Pothole',note:'',
    lat:53.001,lon:-1.1,acc:8,fixAge:2};
  await putEntry(e); S.items.unshift(e); render();
});
ok(await page.textContent('#cnt')==='1','the menu badge counts it');

await page.click('#bMenu'); await page.click('#mLog');
ok(await page.isVisible('#p-log'),'the log opens over the camera');
ok(await page.isVisible('.del.go'),'an unconfirmed entry offers Confirm');
ok(await page.isVisible('#vid'),'the camera is still running underneath');

// --- confirming ---
await page.click('.del.go');
ok(await page.isVisible('#p-score'),'Confirm opens the matrix');
ok(await page.getAttribute('#prev','src')!==null,'the logged photograph is shown');
ok((await page.textContent('#scan')).includes('81%'),'what the model said is repeated back');
ok(await page.evaluate(()=>document.querySelector('.cell[aria-pressed="true"]')!==null),
   'the survey score arrives pre-selected');
ok((await page.textContent('#fixNote')).includes('53.00100'),'the fix is stated before signing off');

// overrule it and save
await page.click('.cell[data-i="4"][data-p="4"]');
await page.fill('#fNote','A38 northbound, lane 1');
await page.click('#bSave');
await page.waitForTimeout(200);
ok(await page.isVisible('#p-log'),'saving returns to the log');
const after=await page.evaluate(()=>({by:S.items[0].scoredBy,score:S.items[0].score,
  cat:S.items[0].cat,note:S.items[0].note,conf:S.items[0].confirmedAt}));
ok(after.by==='inspector','an overruled score is recorded as the inspector\'s');
ok(after.score===16 && after.cat==='Category 1','the new cell is what is stored');
ok(after.note==='A38 northbound, lane 1','the note is kept');
ok(!!after.conf,'it is stamped as confirmed');
ok(!await page.isVisible('.del.go'),'a confirmed entry no longer offers Confirm');

// --- it survives a reload, and still opens on the camera ---
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
ok(!await page.isVisible('#p-log'),'a reload lands on the camera, not the log');
ok(await page.textContent('#cnt')==='1','the entry survived the reload');
const kept=await page.evaluate(()=>S.items[0].scoredBy);
ok(kept==='inspector','and it is still confirmed');

// --- back out of a sheet ---
await page.click('#bMenu'); await page.click('#mMap');
ok(await page.isVisible('#p-map'),'the map opens');
await page.click('#xMap');
ok(!await page.isVisible('#p-map') && await page.isVisible('#vid'),'Back returns to the road');

console.log(errs.length?('ERRORS: '+errs.join(' | ')):'no page errors');
console.log(fails.length?(fails.length+' FAILED'):'all passed');
await browser.close();
process.exit(fails.length?1:0);
