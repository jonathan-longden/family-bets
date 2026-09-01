// The app has no tabs any more: the log and the map come up over the camera
// from the three-dot menu, and one round button starts and stops the survey.
export const toCamera = async p => {
  for (const x of ['#xScore', '#xLog', '#xMap', '#xDiag']) if (await p.isVisible(x)) await p.click(x);
  if (await p.isVisible('#menu')) await p.click('#bMenu');
};
export const openLog = async p => { await toCamera(p); await p.click('#bMenu'); await p.click('#mLog'); };
export const openMap = async p => { await toCamera(p); await p.click('#bMenu'); await p.click('#mMap'); };
export const rec = async p => { await toCamera(p); await p.click('#bRec'); };

// Export lives in the three-dot menu now, not under the log. The menu button
// sits under an open sheet, so reaching it means closing one — and putting it
// back afterwards, or the next assertion is looking at a screen that moved.
const openSheet = async p => {
  for (const [id, open] of [['#p-score','score'],['#p-log','log'],['#p-map','map'],['#p-diag','diag']])
    if (await p.isVisible(id)) return open;
  return null;
};
export const openMenu = async p => {
  if (await p.isVisible('#menu')) return null;
  const was = await openSheet(p);
  await toCamera(p);
  await p.click('#bMenu');
  return was;
};
export const closeMenu = async p => { if (await p.isVisible('#menu')) await p.click('#bMenu'); };
export const menuHas = async (p, sel) => {
  const was = await openMenu(p);
  const v = await p.isVisible(sel);
  await closeMenu(p);
  if (was === 'log') await openLog(p);
  if (was === 'map') await openMap(p);
  return v;
};

// The model is fetched the moment the app opens now, so a suite that swaps in
// its own engine has to wait for that to finish first — otherwise the real one
// lands on top of the stub half a second later and infers against a worker id
// that was never started.
export const settled = async p => {
  await p.waitForFunction(() => {
    const c = document.getElementById('modelChip');
    return /Ready|No model|No runtime|No weights|No backend|Offline|Nonsense|Layout fixed|Precision forced/.test(c.textContent);
  }, null, { timeout: 90000 });
};
