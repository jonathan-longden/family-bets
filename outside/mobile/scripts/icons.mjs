/* Render every icon and splash the two stores ask for.

   The drawing is vector (resources/artwork.mjs) and each output is rendered at
   its own size from that vector — a 48-pixel launcher icon is drawn at 48
   pixels, not squeezed down from 1024. At the sizes phones actually use, the
   difference between the two is the difference between a logo and a smudge.

   Chromium does the rasterising, through Playwright, because it is already
   here for the tests and it renders SVG exactly as the phones' own browsers
   will. Nothing else is installed for this.

   Run it with `npm run icons`. The output is committed, so this only needs
   running when the artwork or the app name changes. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { icon, foreground, splash, maskable, feature, COLOURS } from '../resources/artwork.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const web = join(mobile, '..');
const cfg = JSON.parse(readFileSync(join(web, 'app.config.json'), 'utf8'));

const ios = join(mobile, 'ios/App/App/Assets.xcassets');
const android = join(mobile, 'android/app/src/main/res');
const store = join(mobile, 'resources/store');

/* Android's five buckets, and what one launcher icon measures in each. */
const DENSITIES = [
  ['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]
];

/* Portrait splash sizes by density, the sizes Capacitor's template ships.
   Landscape is the same list turned on its side; the artwork is square and
   cropped, so both come out of one drawing. */
const SPLASH = [
  ['mdpi', 320, 480], ['hdpi', 480, 800], ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600], ['xxxhdpi', 1280, 1920]
];

const shared = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(shared) ? { executablePath: shared } : {});
const page = await browser.newPage();

let count = 0;

/* One SVG, one size, one PNG. The page is sized to the output and the SVG told
   to fill it, so Chromium rasterises at the target resolution rather than
   scaling a bitmap afterwards. */
async function render(svg, file, width, height) {
  const h = height || width;
  await page.setViewportSize({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(h)) });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;background:transparent;overflow:hidden}
       svg{display:block;width:100vw;height:100vh}
     </style>${svg}`,
    { waitUntil: 'load' }
  );
  /* Web fonts are not in play, but the splash draws text and Chromium can
     report the page loaded a beat before the glyphs are laid out. */
  await page.evaluate(() => document.fonts && document.fonts.ready);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true });
  count++;
}

const ICON = icon();
const FOREGROUND = foreground();
const SPLASH_ART = splash(cfg.store.name);

/* --------------------------------------------------------------------- web */

/* The PWA's own icons, so a phone that installs from the website gets the
   same face as one that installs from a store. */
await render(ICON, join(web, 'icon-192.png'), 192);
await render(ICON, join(web, 'icon-512.png'), 512);
/* Maskable: Android crops a PWA icon to its own shape too, and without a
   version drawn inside the safe zone it crops the sun's face off. */
await render(maskable(), join(web, 'icon-maskable-512.png'), 512);

/* --------------------------------------------------------------------- iOS */

/* Xcode has wanted a single 1024 icon since Xcode 14 and slices the rest
   itself, which is why there is one file here rather than eighteen. */
await render(ICON, join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024);

/* The launch screen image, in the three slots the asset catalogue defines for
   light, dark and tinted. The app is dark in all weathers, so they match. */
for (const name of ['splash-2732x2732', 'splash-2732x2732-1', 'splash-2732x2732-2']) {
  await render(SPLASH_ART, join(ios, `Splash.imageset/${name}.png`), 2732);
}

/* ----------------------------------------------------------------- Android */

for (const [bucket, factor] of DENSITIES) {
  await render(ICON, join(android, `mipmap-${bucket}/ic_launcher.png`), 48 * factor);
  await render(ICON, join(android, `mipmap-${bucket}/ic_launcher_round.png`), 48 * factor);
  /* The adaptive foreground is drawn on a 108dp canvas, not 48. */
  await render(FOREGROUND, join(android, `mipmap-${bucket}/ic_launcher_foreground.png`), 108 * factor);
}

for (const [bucket, w, h] of SPLASH) {
  await render(SPLASH_ART, join(android, `drawable-port-${bucket}/splash.png`), w, h);
  await render(SPLASH_ART, join(android, `drawable-land-${bucket}/splash.png`), h, w);
}
await render(SPLASH_ART, join(android, 'drawable/splash.png'), 480, 800);

/* The adaptive icon's back layer is a flat colour by design: it is what the
   launcher parallaxes the foreground against, and a busy one fights the sun. */
writeFileSync(join(android, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${COLOURS.deep}</color>
</resources>
`);

/* ------------------------------------------------------------ store listing */

/* Neither of these ships inside the app. They are uploaded by hand to App
   Store Connect and the Play Console; see mobile/STORE.md. */
await render(ICON, join(store, 'app-icon-1024.png'), 1024);
await render(ICON, join(store, 'play-icon-512.png'), 512);
await render(feature(cfg.store.name, cfg.store.subtitle),
  join(store, 'play-feature-graphic-1024x500.png'), 1024, 500);

await browser.close();
console.log(`\n${count} images rendered from one drawing.\n`);
