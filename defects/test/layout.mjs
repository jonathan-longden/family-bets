import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openMenu, settled } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});

async function screenFor(diagExtra) {
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:915,height:412}});
  const page=await ctx.newPage();
  await ctx.route('https://api.roboflow.com/tfjs/**', route => {
    if (/[?&]u=/.test(route.request().url())) return route.abort();
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640,
        model:{weightsManifest:[{paths:['https://storage.googleapis.com/rf/g1.bin'],
                                 weights:[{name:'a',dtype:'float32'}]}]}}})});
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await settled(page);
  const chip = await page.evaluate(async d => {
    window.engine = { infer: () => Promise.resolve(
      [{class:'pothole',confidence:0.8,bbox:{x:1,y:1,width:2,height:2}},
       Object.assign({__diag:true,outputs:1,rawShape:[1,6,8400],afterTranspose:[1,8400,6],
        readAs:{boxes:8400,classes:2},firstEight:[12,30,40,50,0.02,0.9],
        imageDims:[640,640]}, d)]) };
    window.worker = 1; window.selfTest = null;
    const t = await runSelfTest();
    if (t.allInRange === false || layoutsBothBad(t.diag)) modelChip('Nonsense','bad');
    else if (layoutOverridden(t.diag)) modelChip('Layout fixed','ready');
    else modelChip('Ready','ready');
    return document.getElementById('modelChip').textContent;
  }, diagExtra);
  await openMenu(page); await page.click('#mDiag');
  await page.waitForTimeout(400);
  const text = await page.textContent('#diagText');
  await ctx.close();
  return { text, chip };
}

const sane   = { min: 0.0009, max: 0.94, shape:[1,6,8400], layout:'NHWC' };
const insane = { min: -7180, max: 104000000, shape:[1,6,8400], layout:'NCHW' };

// --- the library's assumption is wrong, and the app corrects for it ---
{
  const { text, chip } = await screenFor({ layoutUsed:'other', layoutNative:'NCHW',
    layoutProbe:{ native: insane, other: sane } });
  console.log('--- corrected ---\n' +
    text.slice(text.indexOf('INPUT LAYOUT')).split('\n').slice(0,5).join('\n') + '\n---');
  ok(/NCHW \(what the library assumes\): min -7180, max 104000000/.test(text),
     'it shows what the library assumed, and what that returned');
  ok(/NHWC \(the other way round\): min 0\.0009, max 0\.94/.test(text),
     'and the other way round');
  ok(/using NHWC — the library's assumption was wrong here/.test(text),
     'and says which it settled on, and that it had to');
  ok(/Layout fixed/i.test(chip), 'the chip says so once: ' + chip);
}

// --- the library was right; nothing is announced ---
{
  const { text, chip } = await screenFor({ layoutUsed:'native', layoutNative:'NCHW',
    layoutProbe:{ native: Object.assign({}, sane, {layout:'NCHW'}),
                  other: { layout:'NHWC', error:'Input 0 expected shape [1,3,640,640]' } } });
  ok(/using NCHW$/m.test(text), 'the chosen layout is stated without complaint');
  ok(/NHWC \(the other way round\): refused — Input 0/.test(text),
     'and a refusal is reported as a refusal');
  ok(!/Layout fixed/i.test(chip), 'and nothing is announced: ' + chip);
}

// --- both ways round are nonsense: the graph is broken, and it says so ---
{
  const { text, chip } = await screenFor({ layoutUsed:'native', layoutNative:'NCHW',
    layoutProbe:{ native: insane, other: Object.assign({}, insane, {layout:'NHWC'}) } });
  ok(/using NCHW$/m.test(text), 'it falls back to what the library assumes');
  ok(/nonsense/i.test(chip), 'and the chip still calls the model out: ' + chip);
}

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
