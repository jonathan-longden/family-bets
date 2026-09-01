import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { toCamera, openLog, openMenu, rec, settled } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const ctx=await browser.newContext({permissions:['camera','geolocation'],
  geolocation:{latitude:53,longitude:-1.1},viewport:{width:915,height:412},acceptDownloads:true});
const page=await ctx.newPage();
page.on('dialog',d=>d.accept());
await ctx.route('https://api.roboflow.com/tfjs/**', route => {
  if (/[?&]u=/.test(route.request().url())) return route.abort();
  route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640}})});
});
await page.goto(B,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});

// --- the vendored bundle still imports and constructs after the patch ---
const mod = await page.evaluate(async () => {
  try { const m = await import('./vendor/inference.es.js');
        const e = new m.InferenceEngine();
        return { ok:true, engine:typeof m.InferenceEngine, image:typeof m.CVImage,
                 infer:typeof e.infer, start:typeof e.startWorkerByModelId };
  } catch (e) { return { ok:false, err:String(e) }; }
});
ok(mod.ok && mod.engine==='function' && mod.image==='function' && mod.infer==='function'
   && mod.start==='function',
   'the patched bundle still imports and constructs' + (mod.ok?'':': '+mod.err));

// --- the diagnostic record never reaches the app's own logic ---
await settled(page);
await page.evaluate(() => {
  window.__diagRec = { __diag:true, outputs:1, rawShape:[1,6,8400], afterTranspose:[1,8400,6],
                       readAs:{boxes:8400,classes:2}, firstEight:[1.5,2.5,3.5,4.5,0.1,0.2,5,6],
                       imageDims:[640,640] };
  // a box larger than the whole 640 square, so the find is genuinely unusable
  window.__hits = [{ class:'pothole', confidence:1481.2, bbox:{x:9,y:9,width:5000,height:5000} },
                   window.__diagRec];
  window.engine = { infer: () => Promise.resolve(window.__hits.slice()) };
  window.worker = 1; window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(()=>document.getElementById('vid').videoWidth>0);
await rec(page);
await page.waitForFunction(()=>/unusable/i.test(document.getElementById('hudState').textContent),
  null,{timeout:20000});
const said = await page.textContent('#hudToast');
ok(/^20 results|^1 result/.test(said.trim()) === false || !/2 results/.test(said),
   'the diagnostic is not counted as a detection: ' + said.slice(0,24));
ok(/1 result/.test(said), 'exactly the real detection is counted: ' + said.slice(0,20));

await page.waitForFunction(()=>/Output/.test(document.getElementById('hudToast').textContent),
  null,{timeout:15000});
const full = await page.textContent('#hudToast');
ok(/Output 1×6×8400/.test(full), 'the raw tensor shape is said out loud');
ok(/transposed to 1×8400×6/.test(full), 'and what the library turned it into');
ok(/read as 8400 boxes × 2 classes/.test(full), 'and what it read that as');
ok(/First eight: 1\.5, 2\.5/.test(full), 'along with the numbers themselves');
console.log('   → ' + full.slice(full.indexOf('Output')));
await page.evaluate(()=>{window.__hits=[];});
await page.click('#bRec');

// --- and it reaches the export ---
await page.evaluate(() => putEntry({ id: Date.now(), t:new Date().toISOString(), img:null,
  imp:2, prob:2, score:4, cat:'Below threshold', resp:'No response category', key:'k0',
  surface:'Carriageway', scoredBy:'inspector', type:'Pothole', note:'' })
  .then(()=>allEntries()).then(r=>{ S.items=r; render(); }));
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bJson');
const j = JSON.parse((await import('fs')).readFileSync(await (await dl).path(),'utf8'));
ok(j.lastUnusableOutput.tensor && j.lastUnusableOutput.tensor.rawShape.join(',') === '1,6,8400',
   'the export carries the tensor shape');
ok(!j.defects.some(d => d.__diag), 'and no diagnostic leaked into the defects');

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
