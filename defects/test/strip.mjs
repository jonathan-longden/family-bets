import { chromium } from 'playwright';
import { CHROME } from './browser.mjs';
import { openMenu, settled, toCamera } from './shellhelp.mjs';
const B='http://127.0.0.1:8777/defects/';
const fails=[]; const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails.push(m);};
const browser=await chromium.launch({executablePath:CHROME,
  args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const ctx=await browser.newContext({permissions:['camera','geolocation'],
  geolocation:{latitude:53.001,longitude:-1.1,accuracy:6},viewport:{width:915,height:412},
  acceptDownloads:true});
const page=await ctx.newPage();
page.on('dialog',d=>d.accept());
await page.goto(B,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});

const q = id => page.getAttribute('#'+id,'data-q');

// --- the readouts say what they are worth, not just what they are ---
await page.waitForFunction(()=>document.getElementById('recTxt').textContent!=='No fix',
  null,{timeout:15000});
ok(await q('rec')==='good', 'a 6 m fix reads good: ' + await page.textContent('#recTxt'));
await page.evaluate(()=>{ S.gps={lat:53,lon:-1.1,acc:40,at:Date.now()}; paintFix(); });
ok(await q('rec')==='fair', 'a 40 m fix reads fair, not good');
await page.evaluate(()=>{ S.gps={lat:53,lon:-1.1,acc:6,at:Date.now()-120000}; paintFix(); });
ok(await q('rec')==='poor', 'and a two-minute-old fix reads poor however tight it is');
ok(/old/.test(await page.textContent('#recTxt')),
   'saying so in words too: ' + await page.textContent('#recTxt'));

ok(await q('gRec')==='good', 'the camera being live reads good');
await page.evaluate(()=>{ modelChip('Nonsense','bad'); });
ok(await q('gModel')==='none', 'a model answering nonsense reads as bad as it is');
await page.evaluate(()=>{ modelChip('Ready','ready'); });
ok(await q('gModel')==='good', 'and a working one reads good');
ok(/finds|—/.test(await page.textContent('#spaceTxt')),
   'space left is counted in finds, not megabytes: ' + await page.textContent('#spaceTxt'));

// --- the tag belongs to the run ---
await page.fill('#pTag','A38 NORTHBOUND');
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.getElementById('badge').textContent==='Live',null,{timeout:20000});
ok(await page.inputValue('#pTag')==='A38 NORTHBOUND', 'it survives a reload — a run outlasts a tab');

await settled(page);
await page.evaluate(() => {
  window.__hits=[{class:'pothole',confidence:0.9,bbox:{x:260,y:240,width:300,height:260}}];
  window.engine={infer:()=>Promise.resolve(window.__hits)};
  window.worker=1; window.loadModel=()=>Promise.resolve({});
});
await page.waitForFunction(()=>document.getElementById('vid').videoWidth>0);
await page.click('#bRec');
await page.waitForFunction(()=>S.items.length>0,null,{timeout:20000});
await page.evaluate(()=>{window.__hits=[];});
await page.click('#bRec');
ok(await page.evaluate(()=>S.items[0].tag)==='A38 NORTHBOUND',
   'and rides along on what the survey logs');

// --- the rail ---
ok(await page.textContent('#railCount')==='1', 'the rail badge counts the log');
await page.click('#bLogQuick');
ok(await page.isVisible('#p-log'), 'and opens it in one tap, without the menu');
ok(/A38 NORTHBOUND/.test(await page.textContent('.item .det')), 'the entry shows its tag');

// --- and reaches both exports ---
let dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bCsv');
const csv = (await import('fs')).readFileSync(await (await dl).path(),'utf8');
ok(csv.split('\r\n')[0].includes('tag'), 'the CSV has a tag column');
ok(/A38 NORTHBOUND/.test(csv), 'carrying it');
dl = page.waitForEvent('download');
await openMenu(page); await page.click('#bGeo');
const geo = JSON.parse((await import('fs')).readFileSync(await (await dl).path(),'utf8'));
ok(geo.features[0].properties.tag === 'A38 NORTHBOUND', 'and the GeoJSON carries it as a property');

console.log(fails.length?('\n'+fails.length+' FAILED'):'\nall passed');
await browser.close();
process.exit(fails.length?1:0);
