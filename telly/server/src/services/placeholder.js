import { createHash } from 'node:crypto';

/**
 * A poster for a title that has not got one.
 *
 * The web app already draws its own generated artwork, and it is nicer than
 * anything served as a file — it is part of the page, it animates, and it is
 * free. This is for everything else: the Android app, a television's browser
 * that has turned off inline SVG, a client somebody writes later. It wants an
 * image URL, so there is an image URL.
 *
 * Deliberately plain and deliberately small — about a kilobyte, generated per
 * request, nothing stored. Poster-shaped (2:3), so a grid does not jump when
 * one card has no artwork.
 *
 * The colour comes from the title, so two films do not look like the same
 * missing poster, and the same film looks the same every time. Where no title
 * is given it falls back to the kind, which still differs between Movies and
 * Series.
 */

const KIND = {
  movie: {
    label: 'No poster',
    /* A film reel, drawn rather than fetched: no icon font, no sprite, no
       dependency on the page it lands in. */
    glyph: 'M4 6h16v12H4z M7 6v12 M12 6v12 M17 6v12'
  },
  series: {
    label: 'No artwork',
    glyph: 'M3 7h18v11H3z M8 3l4 4 M16 3l-4 4'
  }
};

const hueOf = (seed) => {
  const h = createHash('sha256').update(String(seed || 'telly')).digest();
  return h[0] * 360 / 256;
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Two or three initials from a title, for the middle of the card. */
export function initialsOf(title) {
  const words = String(title || '').trim().split(/\s+/)
    .filter(w => /[a-z0-9]/i.test(w) && !/^(the|a|an|of|and|in|on)$/i.test(w));
  const letters = words.slice(0, 3).map(w => w[0].toUpperCase()).join('');
  return letters || '';
}

/**
 * The SVG. `title` is optional and is only used for the colour and the
 * initials — it is escaped, and it is never rendered as markup.
 */
export function placeholderSvg(kind = 'movie', title = '') {
  const k = KIND[kind] ? kind : 'movie';
  const spec = KIND[k];
  const hue = hueOf(title || k);
  const a = `hsl(${hue.toFixed(0)} 24% 14%)`;
  const b = `hsl(${((hue + 42) % 360).toFixed(0)} 28% 8%)`;
  const ink = `hsl(${hue.toFixed(0)} 30% 62%)`;
  const initials = initialsOf(title);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600" role="img" aria-label="${esc(spec.label)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="400" height="600" fill="url(#g)"/>
  <rect x="8" y="8" width="384" height="584" fill="none" stroke="${ink}" stroke-opacity=".22" stroke-width="2" rx="10"/>
  ${initials
    ? `<text x="200" y="310" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="110" font-weight="600" fill="${ink}" fill-opacity=".55">${esc(initials)}</text>`
    : `<g transform="translate(200 290) scale(7) translate(-12 -12)" fill="none" stroke="${ink}" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"><path d="${spec.glyph}"/></g>`}
  <text x="200" y="408" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" letter-spacing="1.5" fill="${ink}" fill-opacity=".62">${esc(spec.label.toUpperCase())}</text>
</svg>
`;
}
