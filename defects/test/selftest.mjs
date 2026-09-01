import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openMenu, settled } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});

async function run(label, preds, expectBad) {
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:915,height:412},
    acceptDownloads:true});
  const page=await ctx.newPage();
  await ctx.route('https://api.roboflow.com/tfjs/**', route => {
    if (/[?&]u=/.test(route.request().url())) return route.abort();
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640,
        model:'https://storage.googleapis.com/example/model.json?token=SECRET'}})});
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await settled(page);
  // stub the engine, then run the self-test by hand as the boot path would
  await page.evaluate(p => {
    window.engine = { infer: () => Promise.resolve(p) };
    window.worker = 1; window.selfTest = null;
  }, preds);
  const t = await page.evaluate(() => runSelfTest());
  console.log('   ' + label + ' -> ' + JSON.stringify(t.confidenceRange) +
              ' allInRange=' + t.allInRange);
  ok(t.state === 'ran', label + ': the self-test ran');
  ok(t.allInRange === !expectBad, label + ': in-range verdict is ' + t.allInRange);
  await ctx.close();
  return page;
}

await run('a working model on flat grey',
  [{class:'pothole',confidence:0.04,bbox:{x:1,y:1,width:2,height:2}}], false);
await run('the model as it actually behaves',
  [{class:'pothole',confidence:696270080,bbox:{x:1,y:1,width:2,height:2}},
   {__diag:true,outputs:1,rawShape:[1,6,8400],afterTranspose:[1,8400,6],
    readAs:{boxes:8400,classes:2},firstEight:[33.4581,-7160,33.4581,-7160,33.4581,-7160,33.4581,-7160],
    imageDims:[640,640]}], true);

// --- the chip says so, and the weights url stays off the glass ---
{
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:915,height:412},
    acceptDownloads:true});
  const page=await ctx.newPage();
  await ctx.route('https://api.roboflow.com/tfjs/**', route => {
    if (/[?&]u=/.test(route.request().url())) return route.abort();
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640,
        model:'https://storage.googleapis.com/example/model.json?token=SECRET'}})});
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await settled(page);
  await page.evaluate(() => {
    window.engine = { infer: () => Promise.resolve(
      [{class:'pothole',confidence:696270080,bbox:{x:1,y:1,width:2,height:2}}]) };
    window.worker = 1; window.selfTest = null;
    return runSelfTest().then(t => {
      if (t.allInRange === false) modelChip('Model answers nonsense', 'bad');
    });
  });
  ok(await page.isVisible('#modelChip') &&
     /Nonsense/i.test(await page.textContent('#modelChip')),
     'the chip says the model answers nonsense');
  const onGlass = await page.evaluate(() => document.body.innerText);
  ok(!/storage\.googleapis|SECRET/.test(onGlass),
     'and the signed weights url is nowhere on the glass');

  await page.evaluate(() => putEntry({ id: Date.now(), t:new Date().toISOString(), img:null,
    imp:2, prob:2, score:4, cat:'Below threshold', resp:'No response category', key:'k0',
    surface:'Carriageway', scoredBy:'inspector', type:'Pothole', note:'' })
    .then(()=>allEntries()).then(r=>{ S.items=r; render(); }));
  const dl = page.waitForEvent('download');
  await openMenu(page); await page.click('#bJson');
  const j = JSON.parse((await import('fs')).readFileSync(await (await dl).path(),'utf8'));
  ok(/storage\.googleapis/.test(j.model.roboflow.weights || ''),
     'but it is in the export, where the owner chooses to send it');
  ok(j.model.selfTest && j.model.selfTest.allInRange === false,
     'and the self-test verdict travels with it');
  await ctx.close();
}

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
