import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openMenu, settled } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});

async function screenFor(precision) {
  const ctx=await browser.newContext({permissions:['camera'],viewport:{width:915,height:412}});
  const page=await ctx.newPage();
  await ctx.route('https://api.roboflow.com/tfjs/**', route => {
    if (/[?&]u=/.test(route.request().url())) return route.abort();
    route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({tfjs:{modelType:'yolov8n',classes:['manhole','pothole'],size:640,model:{}}})});
  });
  await page.goto(B,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
  await settled(page);
  const chip = await page.evaluate(async p => {
    window.engine = { infer: () => Promise.resolve(
      [{class:'pothole',confidence:0.8,bbox:{x:1,y:1,width:2,height:2}},
       {__diag:true,outputs:1,rawShape:[1,6,8400],afterTranspose:[1,8400,6],
        readAs:{boxes:8400,classes:2},firstEight:[13.78,18.28,24.19,30.31,0.02,0.9],
        imageDims:[640,640],layoutUsed:'native',layoutNative:'NCHW',
        layoutProbe:{native:{layout:'NCHW',min:0,max:637.64},
                     other:{layout:'NHWC',error:'must be [1,3,640,640]'}},
        precision:p}]) };
    window.worker = 1; window.selfTest = null;
    const t = await runSelfTest();
    if (t.allInRange === false || layoutsBothBad(t.diag)) modelChip('Nonsense','bad');
    else if (layoutOverridden(t.diag)) modelChip('Layout fixed','ready');
    else if (precisionForced(t.diag)) modelChip('Precision forced','ready');
    else modelChip('Ready','ready');
    return document.getElementById('modelChip').textContent;
  }, precision);
  await openMenu(page); await page.click('#mDiag');
  await page.waitForTimeout(400);
  const text = await page.textContent('#diagText');
  await ctx.close();
  return { text, chip };
}

// --- the phone needed talking down from half precision ---
{
  const { text, chip } = await screenFor({ using:'webgl', ok:true, tried:[
    { how:'as loaded', backend:'webgl', min:-877140, max:2161938688, ok:false },
    { how:'full precision forced', backend:'webgl', min:0, max:637.6417, ok:true } ]});
  console.log('--- forced ---\n' +
    text.slice(text.indexOf('PRECISION')).split('\n').slice(0,5).join('\n') + '\n---');
  ok(/as loaded: min -877140, max 2161938688 on webgl/.test(text), 'what it did first, and what came back');
  ok(/full precision forced: min 0, max 637\.6417 on webgl {2}← usable/.test(text),
     'what it did next, and that this one is a reading');
  ok(/running on webgl$/m.test(text), 'and what it settled on');
  ok(/Precision forced/i.test(chip), 'the chip says so once: ' + chip);
}

// --- it worked first time; nothing is announced ---
{
  const { text, chip } = await screenFor({ using:'webgl', ok:true, tried:[
    { how:'as loaded', backend:'webgl', min:0, max:637.6417, ok:true } ]});
  ok(/as loaded: min 0, max 637\.6417 on webgl {2}← usable/.test(text), 'the one attempt is shown');
  ok(!/Precision forced/i.test(chip), 'and nothing is announced: ' + chip);
}

// --- it had to go all the way to the cpu ---
{
  const { text } = await screenFor({ using:'cpu', ok:true, tried:[
    { how:'as loaded', backend:'webgl', min:-877140, max:2161938688, ok:false },
    { how:'full precision forced', error:'EXT_color_buffer_float not supported' },
    { how:'cpu', backend:'cpu', min:0, max:637.6417, ok:true } ]});
  ok(/full precision forced: failed — EXT_color_buffer_float/.test(text),
     'a refusal on the way is reported, not skipped');
  ok(/running on cpu$/m.test(text), 'and it says it is on the cpu now');
}

// --- nothing worked ---
{
  const { text } = await screenFor({ using:'cpu', ok:false, tried:[
    { how:'as loaded', backend:'webgl', min:-877140, max:2161938688, ok:false },
    { how:'cpu', backend:'cpu', min:-877140, max:2161938688, ok:false } ]});
  ok(/running on cpu — and still not usable/.test(text),
     'and when nothing works it says that too');
}

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
