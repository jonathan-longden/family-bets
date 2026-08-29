/* The app's face, drawn once.

   A cheeky sun with a cloud pulled across it like a duvet. It is the same
   drawing on the App Store, on the home screen, on the Android launcher and on
   the splash — built here as vector geometry so every one of those is rendered
   at its own size rather than a small bitmap stretched to fit.

   It has to survive being 40 pixels across on a crowded home screen, so the
   whole design is four shapes and a face: a disc, some rays, a cloud, two eyes
   and a smirk. Detail that disappears at that size is detail that is only
   making the file bigger.

   Coordinates are a 1024-square. The character sits inside roughly x 145–810,
   y 90–810, which leaves room for the rounded corners iOS crops and for the
   safe zone Android's adaptive icons insist on. */

const SUN = { x: 455, y: 400, r: 195 };

/* Where the drawing actually reaches, used to fit it into Android's safe
   circle. Measured from the geometry below rather than guessed. */
export const BOUNDS = { x: 145, y: 90, w: 665, h: 720 };

export const COLOURS = {
  deep: '#0d1b3e',
  deeper: '#070f26',
  lift: '#17346f',
  sun: '#ffcb3d',
  sunLow: '#ffa722',
  ink: '#3a2405',
  cloud: '#ffffff',
  cloudLow: '#c8dbfb',
  text: '#ffe6a8',
  dim: '#aebbdc'
};

/* One ray, pointing straight up from the middle of the sun, then rotated. The
   gap under it is deliberate: rays touching the disc read as a blob. */
function rays() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(
      `<path d="M -26,-224 L 0,-330 L 26,-224 Z" transform="rotate(${i * 45})" ` +
      `fill="url(#rayFill)" stroke="url(#rayFill)" stroke-width="16" stroke-linejoin="round"/>`
    );
  }
  return `<g transform="translate(${SUN.x},${SUN.y})">${out.join('')}</g>`;
}

/* The face. Both eyes look the same way and one eyebrow is up — that, and the
   lopsided mouth, is the whole of the cheek. */
function face() {
  return `
    <g fill="${COLOURS.ink}">
      <ellipse cx="404" cy="378" rx="27" ry="35"/>
      <ellipse cx="519" cy="378" rx="27" ry="35"/>
    </g>
    <g fill="#ffffff" opacity="0.92">
      <circle cx="413" cy="366" r="9"/>
      <circle cx="528" cy="366" r="9"/>
    </g>
    <path d="M 367,314 Q 405,292 443,314" fill="none" stroke="${COLOURS.ink}"
          stroke-width="17" stroke-linecap="round"/>
    <path d="M 481,292 Q 522,262 563,292" fill="none" stroke="${COLOURS.ink}"
          stroke-width="17" stroke-linecap="round"/>
    <path d="M 384,468 Q 456,514 552,446" fill="none" stroke="${COLOURS.ink}"
          stroke-width="22" stroke-linecap="round"/>
    <g fill="#ff7a2f" opacity="0.30">
      <ellipse cx="345" cy="446" rx="34" ry="22"/>
      <ellipse cx="574" cy="440" rx="34" ry="22"/>
    </g>`;
}

/* Circles and a rounded slab, drawn as one shape so the joins vanish. */
function cloud() {
  return `
    <g fill="url(#cloudFill)">
      <circle cx="372" cy="690" r="102"/>
      <circle cx="520" cy="652" r="132"/>
      <circle cx="683" cy="694" r="97"/>
      <rect x="258" y="700" width="546" height="110" rx="55"/>
    </g>
    <path d="M 318,752 Q 400,730 486,742" fill="none" stroke="${COLOURS.cloudLow}"
          stroke-width="13" stroke-linecap="round" opacity="0.42"/>`;
}

/* Everything except the background, so the same drawing can sit on a gradient
   for iOS or on nothing at all for an Android adaptive foreground. */
export function character() {
  return `
    ${rays()}
    <circle cx="${SUN.x}" cy="${SUN.y}" r="${SUN.r}" fill="url(#sunFill)"/>
    ${face()}
    ${cloud()}`;
}

export function defs() {
  return `
    <defs>
      <radialGradient id="sunFill" cx="0.38" cy="0.32" r="0.78">
        <stop offset="0" stop-color="#ffe27a"/>
        <stop offset="0.55" stop-color="${COLOURS.sun}"/>
        <stop offset="1" stop-color="${COLOURS.sunLow}"/>
      </radialGradient>
      <linearGradient id="rayFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe27a"/>
        <stop offset="1" stop-color="${COLOURS.sun}"/>
      </linearGradient>
      <linearGradient id="cloudFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${COLOURS.cloud}"/>
        <stop offset="1" stop-color="${COLOURS.cloudLow}"/>
      </linearGradient>
      <linearGradient id="skyFill" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="${COLOURS.lift}"/>
        <stop offset="1" stop-color="${COLOURS.deeper}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.44" cy="0.38" r="0.62">
        <stop offset="0" stop-color="#ffcb3d" stop-opacity="0.30"/>
        <stop offset="1" stop-color="#ffcb3d" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
}

/* ------------------------------------------------------------- the three uses */

/* The app icon: full bleed, because both platforms crop it to their own shape
   and a transparent margin would only make the artwork look small. */
export function icon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${defs()}
    <rect width="1024" height="1024" fill="url(#skyFill)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    ${character()}
  </svg>`;
}

/* Android's adaptive foreground. The launcher may crop this to a circle, a
   squircle or a teardrop depending on the phone, and only the middle two
   thirds is guaranteed to survive — so the drawing is scaled to sit inside
   that and nothing important goes near an edge. */
export function foreground() {
  const safe = 1024 * 0.66;
  const scale = Math.min(safe / BOUNDS.w, safe / BOUNDS.h);
  const cx = BOUNDS.x + BOUNDS.w / 2;
  const cy = BOUNDS.y + BOUNDS.h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${defs()}
    <g transform="translate(512,512) scale(${scale.toFixed(4)}) translate(${-cx},${-cy})">
      ${character()}
    </g>
  </svg>`;
}

/* A maskable icon for the web app. Android crops a PWA icon to its own shape
   as well, and an icon drawn to the edges loses the sun's face to it. Same
   drawing, pulled in so a circular crop still contains all of it. */
export function maskable() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${defs()}
    <rect width="1024" height="1024" fill="url(#skyFill)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <g transform="translate(512,512) scale(0.72) translate(-512,-512)">
      ${character()}
    </g>
  </svg>`;
}

/* Google Play's feature graphic: 1024×500, across the top of the listing.
   Landscape, so the drawing sits beside the name rather than above it. */
export function feature(name, subtitle) {
  const lines = wordmark(String(name).toUpperCase());

  /* The text column runs from the logo to the right edge, less a margin.
     Google crops a little off every side of this image on some screens, so
     nothing is allowed to sit against an edge. */
  const left = 448;
  const room = 1024 - left - 44;
  const widest = lines.reduce((w, l) => Math.max(w, l.length), 0);
  const size = Math.min(78, Math.floor(room / (widest * 0.66)));

  const block = lines.length > 1 ? 2 * size + 14 : size;
  const first = 250 - block / 2 + size * 0.78;

  const text = lines.map((line, i) =>
    `<text x="${left}" y="${(first + i * (size + 14)).toFixed(0)}"
           font-family="DejaVu Sans, Liberation Sans, sans-serif" font-weight="bold"
           font-size="${size}" letter-spacing="1" fill="${COLOURS.text}">${line}</text>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500" width="1024" height="500">
    ${defs()}
    <rect width="1024" height="500" fill="url(#skyFill)"/>
    <rect width="1024" height="500" fill="url(#glow)"/>
    <g transform="translate(228,250) scale(0.40) translate(-${BOUNDS.x + BOUNDS.w / 2},-${BOUNDS.y + BOUNDS.h / 2})">
      ${character()}
    </g>
    ${text}
    <text x="${left + 2}" y="${(first + block + 26).toFixed(0)}"
          font-family="DejaVu Sans, Liberation Sans, sans-serif"
          font-size="31" fill="${COLOURS.dim}">${subtitle}</text>
  </svg>`;
}

/* The splash. Deliberately plain: a logo, a name, and no animation at all —
   it is on screen for as long as the first forecast takes to draw and not one
   frame longer, and anything moving on it would only be in the way.

   One square drawing covers every phone in both orientations, because it is
   centre-cropped to whatever shape the screen is. That crop is the whole
   difficulty: on a tall 320×480 screen only the middle 614 of the 1024 square
   survives, and on a wide one the same is true of the height. So everything
   that matters is kept inside a 614-wide box in the middle and the corners are
   left to be thrown away — which is why the name is stacked rather than run
   across, and why it is measured before it is drawn. */
const SAFE = 614;

export function splash(name) {
  const lines = wordmark(String(name).toUpperCase());

  /* Widest line decides the size, so a longer name shrinks to fit rather than
     running off the sides of a narrow phone. */
  const widest = lines.reduce((w, l) => Math.max(w, l.length), 0);
  const size = Math.min(70, Math.floor((SAFE - 40) / (widest * 0.66)));
  const top = lines.length > 1 ? 706 : 730;

  const text = lines.map((line, i) =>
    `<text x="512" y="${top + i * (size + 16)}" text-anchor="middle"
           font-family="DejaVu Sans, Liberation Sans, sans-serif" font-weight="bold"
           font-size="${size}" letter-spacing="3" fill="${COLOURS.text}">${line}</text>`
  ).join('');

  /* Flat ground, not the gradient the icon uses, and this is a deliberate
     trade rather than a shortcut. A smooth gradient across 2732 pixels is
     something PNG cannot compress: the same drawing costs about 3.4 MB with it
     and 40 KB without, three times over on iOS and ten more on Android, all of
     it inside the download the user pays for. It also matches exactly what
     Capacitor paints behind the WebView, so the splash gives way to the app
     without a seam — which the gradient never quite did. */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"
       preserveAspectRatio="xMidYMid slice">
    ${defs()}
    <rect width="1024" height="1024" fill="${COLOURS.deep}"/>
    <g transform="translate(512,420) scale(0.52) translate(-${BOUNDS.x + BOUNDS.w / 2},-${BOUNDS.y + BOUNDS.h / 2})">
      ${character()}
    </g>
    ${text}
  </svg>`;
}

/* Two words become two lines, which is both easier to fit and more like a
   logo than a single long one. Three or more are balanced across two lines;
   one is left alone. */
function wordmark(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return words;
  if (words.length === 2) return words;
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}
