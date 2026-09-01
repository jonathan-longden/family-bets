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

// stand in for Roboflow's metadata endpoint
// The library asks this same endpoint for itself at boot, so only requests
// without its fingerprint parameter are the app's own diagnostic.
let metaHits = 0;
await ctx.route('https://api.roboflow.com/tfjs/**', route => {
  if (!/[?&]u=/.test(route.request().url())) metaHits++;
  route.fulfill({status:200, contentType:'application/json',
    body: JSON.stringify({ tfjs: { modelType:'yolov11n', classes:['manhole','pothole'],
                                   size:640, model:'https://example.invalid/model.json' } })});
});
await page.goto(B,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});

// --- the dispatch table matches the library's, read out of its own bundle ---
const d = await page.evaluate(() => ['yolov8n','yolov5s','yolov11n','yolo11n','rfdetr-nano',
  'yolo26n','yololite','', 'wat'].map(t => t + ' -> ' + decoderFor(t)));
console.log('   ' + d.join('\n   '));
ok(d[0].endsWith('YOLOv8') && d[2].endsWith('YOLOv11'), 'the usual types map to their decoders');
ok(/refuses this type/.test(d[3]),
   'yolo11n without the v is refused — the library has no case for it');
ok(/refuses this type/.test(d[8]) && /no model type/.test(d[7]),
   'an unknown type and a missing one are told apart');

// --- the metadata is no longer a diagnostic luxury ---
// It used to be fetched only when the diagnostics screen asked for it, and a
// working app spent no request on it. The survey now runs on the app's own
// TensorFlow.js, and the WEIGHTS live in this same metadata — so it is fetched
// once at startup because the model cannot be built without it.
await settled(page);
ok(metaHits === 1,
   'the metadata is fetched exactly once, because the weights are in it: ' + metaHits);
ok(await page.evaluate(() => !!(rfMeta && rfMeta.weights)),
   'and it carries the weights the backend loads');

// --- an unusable frame asks, and says it on the glass ---
await page.evaluate(() => {
  window.__hits = Array.from({length:20}, () => ({class:'pothole', confidence:1481.2}));
  window.engine = { infer: () => Promise.resolve(window.__hits) };
  window.worker = 1; window.loadModel = () => Promise.resolve({});
});
await page.waitForFunction(()=>document.getElementById('vid').videoWidth>0);
await rec(page);
await page.waitForFunction(()=>/unusable/i.test(document.getElementById('hudState').textContent),
  null,{timeout:20000});
await page.waitForFunction(()=>/Roboflow calls it/.test(document.getElementById('hudToast').textContent),
  null,{timeout:15000});
const toast = await page.textContent('#hudToast');
ok(/yolov11n/.test(toast) && /YOLOv11/.test(toast),
   'the toast names the model type and the decoder: ' + toast.slice(-72));
ok(metaHits === 1, 'and asked exactly once');
await page.evaluate(()=>{window.__hits=[];});
await page.click('#bRec');

// --- and it reaches the export ---
await page.evaluate(() => {
  return putEntry({ id: Date.now(), t:new Date().toISOString(), img:null,
    imp:2, prob:2, score:4, cat:'Below threshold', resp:'No response category', key:'k0',
    surface:'Carriageway', scoredBy:'inspector', type:'Pothole', note:'' })
    .then(()=>allEntries()).then(r=>{ S.items=r; render(); });
});
const dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bJson');
const j = JSON.parse((await import('fs')).readFileSync(await (await dl).path(),'utf8'));
ok(j.model.roboflow && j.model.roboflow.modelType === 'yolov11n',
   'the export carries what Roboflow says the model is');
ok(j.model.roboflow.decoder === 'YOLOv11', 'and which decoder that picks');
ok(j.lastUnusableOutput.model && j.lastUnusableOutput.model.modelType === 'yolov11n',
   'the unusable-output record carries it too');
ok(metaHits === 1, 'still asked only once — the answer is cached');

// --- and the app is pointed at a model the library can decode ---
const shipped = await page.evaluate(() => ({ id: RF_MODEL_ID, decoder: null }));
const type = (shipped.id.match(/-(yolo[a-z0-9]+)-t\d+$/) || [])[1] || '';
ok(/^yolov8/.test(type),
   'the shipped model id names a yolov8: ' + shipped.id.split('/').pop());
ok(await page.evaluate(t => decoderFor(t), type.replace(/n$/, 'n')) === 'YOLOv8',
   'which is the one architecture whose input and output the decoder agrees on');

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
