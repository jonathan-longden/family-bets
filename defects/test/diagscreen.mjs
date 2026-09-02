import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openMenu, settled, toCamera } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const ctx=await browser.newContext({permissions:['camera','clipboard-read','clipboard-write'],
  viewport:{width:915,height:412},acceptDownloads:true});
const page=await ctx.newPage();
await ctx.route('https://api.roboflow.com/tfjs/**', route => {
  if (/[?&]u=/.test(route.request().url())) return route.abort();
  route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640,
      model:{ format:'graph-model', generatedBy:'2.15.0', convertedBy:'TensorFlow.js Converter',
              modelTopology:{ node:new Array(431).fill({}) },
              weightsManifest:[{ paths:['https://storage.googleapis.com/rf/group1-shard1of3.bin?publishable_key=K',
                                        'https://storage.googleapis.com/rf/group1-shard2of3.bin?publishable_key=K'],
                                 weights:[{name:'a',shape:[3,3,3,16],dtype:'float32',
                                           quantization:{dtype:'uint8',scale:0.004,min:-0.5}},
                                          {name:'b',shape:[16],dtype:'float32'}] }] }}})});
});
await page.goto(B,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
await settled(page);

// --- reachable with nothing logged, which is the whole point ---
ok(await page.textContent('#cnt') === '0', 'the log is empty');
ok(!(await page.evaluate(() => { const e=document.getElementById('expRow');
     return e && !e.hidden; })), 'so the export block is hidden, as it was before');
await openMenu(page);
ok(await page.isVisible('#mDiag'), 'but Diagnostics is in the menu regardless');
await page.click('#mDiag');
ok(await page.isVisible('#p-diag'), 'and it opens');

// --- it carries what is needed to diagnose the model ---
await page.evaluate(() => {
  window.engine = { infer: () => Promise.resolve(
    [{class:'pothole',confidence:103205056,bbox:{x:1,y:1,width:2,height:2}},
     {__diag:true,outputs:1,rawShape:[1,6,8400],afterTranspose:[1,8400,6],
      readAs:{boxes:8400,classes:2},
      firstEight:[33.4147,-7177,33.4147,-7177,33.4147,-7177,33.4147,-7177],
      imageDims:[640,640]}]) };
  window.worker = 1; window.selfTest = null;
  return runSelfTest().then(() => paintDiag());
});
// the build comes out of app.js so this suite does not need editing on a bump
const wantBuild = (await (await fetch(B + 'app.js')).text())
  .match(/var BUILD = '([^']+)'/)[1];
const text = await page.textContent('#diagText');
console.log('--- diagnostics screen ---\n' + text + '\n---');
for (const [needle, what] of [
  [wantBuild, 'the build'],
  ['yolov8n', 'what Roboflow calls the model'],
  ['YOLOv8', 'the decoder that picks'],
  ['storage.googleapis.com/rf/group1-shard1of3.bin', 'where the weight shards are served from'],
  ['quantised  1 as uint8', 'whether the weights were stored quantised'],
  ['groups     1, tensors 2', 'how many tensors the manifest declares'],
  ['nodes      431', 'how big the graph is'],
  ['inline model.json', 'that the metadata embeds the model rather than linking it'],
  ['NO — the output does not depend on the picture', 'the self-test verdict, in words'],
  ['33.4147', 'the raw values'],
  ['1×6×8400', 'the tensor shape'],
]) ok(text.includes(needle), 'it carries ' + what);

// --- copy, and a text file for when copy is refused ---
await page.click('#bCopyDiag');
// the clipboard write is a promise; the note is set when it settles
await page.waitForFunction(() => /Copied|would not copy/.test(
  document.getElementById('copyNote').textContent), null, { timeout: 5000 });
ok(/Copied|would not copy/.test(await page.textContent('#copyNote')),
   'Copy says what happened either way');
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok(clip.includes('yolov8n'), 'and the clipboard has it');
const dl = page.waitForEvent('download');
await page.click('#bDiagFile');
const f = await dl;
ok(/\.txt$/.test(f.suggestedFilename()), 'the fallback is a .txt, not a .json: ' + f.suggestedFilename());
const onDisk = (await import('fs')).readFileSync(await f.path(),'utf8');
ok(onDisk.includes('SELF TEST'), 'and the file is the same text');

// --- back goes to the camera ---
await page.click('#xDiag');
ok(!(await page.isVisible('#p-diag')) && await page.isVisible('#vid'),
   'Back returns to the road');

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
