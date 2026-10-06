'use strict';
/**
 * The web child quiz's brand, as configuration.
 *
 * One object per brand: its name, its mark (inline SVG, so the page needs no
 * extra request), its colour tokens (served as CSS variables), the mascot's
 * name, the link-preview image and the few words of copy that name the product.
 * Which brand a deployment shows is decided by what it already has, never by a
 * code path and never by a new environment variable:
 *
 *   1. the app_settings row `web_quiz_brand` ("niete" | "rumi"), if present;
 *   2. else ORG_NAME, then BOT_NAME (the existing settings read by config/branding.js; a name
 *      that carries a brand key as a word counts, so the open platform's "Rumi Education" is Rumi);
 *   3. else DEFAULT_BRAND — this fork's brand.
 *
 * Both services read this file: the bot names the brand key in the quiz
 * payload, and the portal edge turns the key into the page shell (CSS
 * variables, link-preview tags, favicon) and the boot JSON. The edge never
 * trusts anything but the key, so an unknown value falls back to the default.
 *
 * No requires: the portal service loads this file from the bot folder without
 * the bot's node_modules.
 *
 * The marks are vectorised from the official raster marks (potrace, one path
 * per colour layer), never redrawn; their colours come from --mk1/--mk2 so one
 * path set serves every ground the brand book allows.
 */

const DEFAULT_BRAND = 'niete';
const SETTING_KEY = 'web_quiz_brand';
const CACHE_MS = 5 * 60 * 1000;

/* The bilingual N / nun monogram: --mk1 = the N, --mk2 = the nun hook and diamond nuqta. */
const NIETE_MARK = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" viewBox="0 0 560 568"><g transform="translate(0,568) scale(0.1,-0.1)"><path fill="var(--mk1)" d="M4510 3851 c0 -960 -4 -1712 -9 -1715 -4 -3 -18 2 -29 12 -11 9 -64 51 -117 92 -53 41 -134 104 -179 140 -46 36 -98 76 -116 90 -19 14 -45 34 -59 46 -14 11 -89 70 -166 130 -192 150 -549 431 -666 523 -53 42 -111 87 -129 101 -18 14 -56 43 -84 66 -28 22 -94 74 -146 114 -52 41 -156 122 -230 180 -74 58 -178 139 -230 180 -52 41 -158 124 -235 184 -190 149 -343 269 -436 341 -43 33 -137 107 -211 165 -327 257 -424 332 -588 460 -96 75 -238 186 -315 246 -77 60 -171 134 -210 164 -38 29 -100 78 -137 107 -37 29 -72 53 -77 53 -8 0 -11 -670 -11 -2215 l0 -2215 481 2 482 3 -2 180 -2 180 -374 370 c-206 204 -375 375 -375 380 0 6 169 179 376 386 l375 375 -1 276 c-1 264 5 317 29 281 3 -5 38 -34 76 -63 39 -30 111 -86 160 -125 91 -72 245 -193 345 -272 30 -24 123 -95 205 -159 83 -65 162 -126 176 -138 14 -12 40 -32 59 -46 18 -14 70 -54 116 -90 45 -36 140 -110 210 -165 70 -55 196 -154 280 -220 84 -66 207 -163 274 -215 67 -52 170 -133 230 -180 59 -47 163 -128 230 -180 68 -52 177 -138 244 -191 109 -86 420 -329 694 -543 57 -45 141 -110 186 -146 46 -36 98 -76 116 -90 19 -14 45 -34 59 -46 25 -20 214 -167 420 -327 51 -39 128 -100 172 -134 43 -35 83 -63 89 -63 7 0 10 823 10 2703 l0 2704 -97 6 c-54 4 -270 7 -480 7 l-383 0 0 -1709z"/><path fill="var(--mk2)" d="M790 2518 l-295 -298 293 -293 292 -292 190 190 c105 105 194 190 198 190 4 0 6 4 4 9 -3 9 39 42 50 39 10 -4 33 28 33 46 0 9 8 16 17 16 10 0 23 6 30 13 7 7 13 20 13 30 0 9 8 17 17 17 10 0 25 8 35 18 17 16 3 32 -277 316 -162 164 -297 298 -300 298 -3 0 -138 -134 -300 -299z M1986 1873 c-3 -4 -6 -128 -6 -276 1 -192 -2 -272 -11 -283 -6 -7 -9 -20 -6 -29 4 -8 2 -17 -3 -20 -6 -4 -19 -26 -31 -51 -11 -25 -27 -48 -35 -51 -8 -3 -13 -11 -10 -18 2 -7 -11 -28 -30 -46 -19 -18 -34 -29 -34 -24 0 5 -10 -1 -22 -12 -13 -11 -40 -27 -60 -37 -20 -9 -39 -20 -42 -25 -3 -5 -17 -6 -31 -3 -14 2 -31 -1 -39 -7 -10 -8 -217 -12 -747 -14 l-734 -2 0 -412 0 -412 793 -2 c551 -2 796 1 803 8 6 6 27 9 48 6 26 -4 41 0 50 11 8 10 22 13 40 10 18 -4 32 0 40 10 7 9 17 13 23 10 10 -7 74 21 83 36 4 6 11 8 16 4 14 -8 77 23 91 46 6 10 17 16 24 13 6 -2 15 0 19 6 3 6 14 11 23 11 10 0 23 9 30 20 7 11 19 20 27 20 9 0 29 16 46 35 17 19 34 33 39 30 10 -6 161 146 154 156 -3 5 11 23 30 39 19 17 33 37 31 43 -3 7 11 23 30 37 19 14 35 30 35 37 0 7 9 29 20 48 11 20 18 40 15 46 -4 5 -2 9 4 9 12 0 66 109 57 117 -3 4 1 14 10 24 9 10 14 25 11 33 -3 8 1 20 9 27 11 9 14 22 10 45 -5 24 -2 33 10 38 12 4 15 15 12 36 -3 17 0 35 7 40 8 6 10 104 7 342 l-3 333 -398 3 c-218 1 -401 -1 -405 -5z"/></g></svg>';
/* Two dots and a smile ("Rumi connects the dots"); wide, never boxed into a square. */
const RUMI_MARK = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" viewBox="0 0 691 285"><g transform="translate(0,285) scale(0.1,-0.1)"><path fill="var(--mk1)" d="M725 2678 c-135 -32 -221 -69 -309 -132 -34 -25 -75 -62 -91 -83 -16 -21 -32 -40 -35 -43 -19 -16 -50 -75 -77 -145 -63 -165 -67 -230 -23 -355 16 -47 30 -91 30 -98 0 -19 113 -183 151 -218 54 -51 154 -111 240 -144 93 -36 163 -39 315 -13 85 14 106 15 132 4 36 -15 139 -121 162 -166 8 -17 32 -48 52 -70 20 -22 50 -58 66 -81 33 -46 286 -297 305 -303 7 -2 26 -16 42 -31 17 -15 55 -45 86 -66 31 -22 71 -51 90 -66 85 -66 511 -298 548 -298 6 0 29 -9 50 -19 80 -41 298 -108 431 -133 30 -5 75 -14 100 -19 221 -44 710 -44 970 0 173 29 430 108 561 172 44 21 84 39 90 39 16 0 178 84 267 139 46 28 87 51 92 51 4 0 13 7 20 15 7 9 27 22 44 30 17 8 54 33 81 55 28 21 72 56 99 77 27 21 129 117 228 213 161 157 225 229 300 339 13 18 40 52 60 75 l37 41 78 -2 c359 -11 378 -8 521 74 35 21 73 43 85 50 24 14 86 80 106 114 94 155 114 225 115 384 0 86 -4 142 -13 165 -121 314 -401 496 -681 442 -155 -30 -249 -81 -362 -198 -114 -119 -148 -218 -148 -427 l0 -157 36 -73 c20 -39 57 -98 81 -131 75 -98 71 -120 -54 -313 -65 -100 -331 -372 -467 -477 -44 -34 -104 -80 -135 -104 -31 -24 -72 -52 -91 -63 -19 -10 -64 -38 -100 -60 -71 -45 -353 -189 -370 -189 -6 0 -29 -9 -53 -19 -52 -24 -218 -81 -272 -93 -194 -45 -265 -51 -635 -51 -338 0 -446 6 -560 33 -25 6 -67 14 -95 19 -137 23 -529 184 -690 283 -226 139 -337 230 -569 466 -279 283 -336 360 -336 455 0 34 32 108 55 127 49 41 110 211 121 335 16 194 -121 461 -279 541 -17 9 -42 24 -53 33 -19 15 -83 38 -200 72 -37 11 -95 10 -149 -3z"/></g></svg>';

// The NIETE diamond lattice (brand book "Patterns"): thin outline diamonds, never filled,
// one line colour on a flat ground, whisper-quiet behind content.
const NIETE_LATTICE = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="#47BA7D" stroke-width="1.2">'
  + '<path d="M48 4 92 48 48 92 4 48Z"/><path d="M48 30 66 48 48 66 30 48Z"/>'
  + '<path d="M0 -8 8 0 0 8 -8 0Z"/><path d="M96 -8 104 0 96 8 88 0Z"/><path d="M0 88 8 96 0 104 -8 96Z"/><path d="M96 88 104 96 96 104 88 96Z"/>'
  + '<path d="M14 6 19 11 14 16 9 11Z"/><path d="M82 80 87 85 82 90 77 85Z"/></svg>';
// The Rumi motif: a quiet constellation of small dots joined by thin smile curves.
const RUMI_MOTIF = '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="150" viewBox="0 0 260 150" fill="#0E2058" stroke="#0E2058" stroke-width="1.2">'
  + '<circle cx="24" cy="40" r="3"/><circle cx="56" cy="40" r="3"/><path d="M24 40Q40 60 56 40" fill="none"/>'
  + '<circle cx="170" cy="112" r="2.4"/><circle cx="196" cy="112" r="2.4"/><path d="M170 112Q183 128 196 112" fill="none"/>'
  + '<circle cx="120" cy="22" r="1.6"/><circle cx="232" cy="58" r="1.6"/></svg>';

const BRANDS = {
  niete: {
    key: 'niete',
    name: 'NIETE',
    orgNames: ['niete', 'niete teaching assistant'],
    // The book's product-offering lockup: the name over "FOR STUDENTS".
    label: { en: 'NIETE', ur: 'NIETE' },
    sub: { en: 'FOR STUDENTS', ur: 'FOR STUDENTS' },
    // The teacher's own pages (the preview link): the book's teacher lockup.
    subTeacher: { en: 'FOR TEACHERS', ur: 'FOR TEACHERS' },
    mascot: { en: 'Jugnu', ur: 'جگنو' },
    place: { en: 'Islamabad', ur: 'اسلام آباد' },
    og: { image: '/wq/og.jpg', site: 'NIETE' },
    // The book's app icon: a navy-slate tile, green N, white nun and diamond.
    mark: { svg: NIETE_MARK, tile: true, ratio: 560 / 568, onLight: ['#47BA7D', '#333748'], onTile: ['#47BA7D', '#FFFFFF'] },
    deco: NIETE_LATTICE,
    tokens: {
      brand: '#47BA7D', 'brand-d': '#23794D', 'brand-l': '#E3F5EA',
      'brand-ink': '#333748', 'brand-ink-d': '#1F2230', 'brand-on': '#333748',
      ground: '#F5F8F6', card: '#FFFFFF', line: '#DCE5DF', tint: '#ECF4EF', muted: '#5F6374', ink: '#2A2D3A',
      theme: '#333748',
    },
  },
  rumi: {
    key: 'rumi',
    name: 'Rumi',
    orgNames: ['rumi', 'rumi global'],
    label: { en: 'Rumi', ur: 'Rumi' },
    // The lockup is part of the logo: Latin in both languages (a 9px Nastaliq line is unreadable).
    sub: { en: 'QUIZ', ur: 'QUIZ' },
    mascot: { en: 'Jugnu', ur: 'جگنو' },
    place: null,
    og: { image: '/wq/og-rumi.jpg', site: 'Rumi' },
    mark: { svg: RUMI_MARK, tile: false, ratio: 691 / 285, onLight: ['#0E2058', '#0E2058'], onTile: ['#FFFFFF', '#FFFFFF'] },
    deco: RUMI_MOTIF,
    // The product system: navy + ONE warm accent (coral).
    tokens: {
      brand: '#F06E42', 'brand-d': '#B5461F', 'brand-l': '#FDEBE4',
      'brand-ink': '#0E2058', 'brand-ink-d': '#060F33', 'brand-on': '#0E2058',
      ground: '#F9FAFB', card: '#FFFFFF', line: '#E5E7EB', tint: '#F1F3F8', muted: '#5B6275', ink: '#1D2025',
      theme: '#0E2058',
    },
  },
};

function normalise(v) {
  if (typeof v !== 'string') return '';
  let s = v.trim();
  try { const p = JSON.parse(s); if (typeof p === 'string') s = p.trim(); } catch (_) { /* a bare word */ }
  return s.toLowerCase();
}

// A deployment name names a brand when it IS one of the brand's names or carries the
// brand's key as a whole word ("Rumi Education", "NIETE Teaching Assistant").
function brandFromName(name) {
  const n = normalise(name);
  if (!n) return null;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  const hit = Object.values(BRANDS).find((b) => b.orgNames.includes(n) || words.includes(b.key));
  return hit ? hit.key : null;
}

/** Pure: which brand, from a stored setting, then ORG_NAME, then BOT_NAME, then the default. */
function brandKey({ setting, orgName, botName } = {}) {
  const s = normalise(setting);
  if (s && BRANDS[s]) return s;
  return brandFromName(orgName) || brandFromName(botName) || DEFAULT_BRAND;
}

let cache = null; // { at, setting }

/** Reads the app_settings row once per CACHE_MS; any failure means "no setting". */
async function resolveBrandKey({ db, orgName = process.env.ORG_NAME, botName = process.env.BOT_NAME } = {}) {
  if (cache && Date.now() - cache.at < CACHE_MS) return brandKey({ setting: cache.setting, orgName, botName });
  let setting = null;
  if (db && typeof db.from === 'function') {
    try {
      const { data, error } = await db.from('app_settings').select('key, value').eq('key', SETTING_KEY).maybeSingle();
      if (!error && data && data.key === SETTING_KEY) setting = data.value;
    } catch (_) { setting = null; }
  }
  cache = { at: Date.now(), setting };
  return brandKey({ setting, orgName, botName });
}

/** The brand as the page sees it (boot JSON). Unknown keys get the default brand. */
function publicBrand(key) {
  const b = BRANDS[key] || BRANDS[DEFAULT_BRAND];
  const { orgNames, ...pub } = b;
  return JSON.parse(JSON.stringify(pub));
}

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}")`;

/** One :root rule: the brand tokens, the mark colours and the background motif. */
function cssVars(brand) {
  const t = brand.tokens || {};
  const parts = Object.keys(t).filter((k) => k !== 'theme' && /^[a-z-]+$/.test(k) && /^#[0-9A-Fa-f]{6}$/.test(t[k]))
    .map((k) => `--${k}:${t[k]}`);
  const m = brand.mark || {};
  if (m.onLight) parts.push(`--mk1:${m.onLight[0]}`, `--mk2:${m.onLight[1]}`);
  if (m.onTile) parts.push(`--mk1-t:${m.onTile[0]}`, `--mk2-t:${m.onTile[1]}`);
  if (brand.deco) parts.push(`--deco:${svgUrl(brand.deco)}`);
  return `:root{${parts.join(';')}}`.replace(/[<>]/g, '');
}

/** The favicon as a data: SVG — the mark on its tile (or bare, for a wide mark). */
function faviconHref(brand) {
  const m = brand.mark;
  const [c1, c2] = m.tile ? m.onTile : m.onLight;
  const inner = m.svg.replace(/var\(--mk1\)/g, c1).replace(/var\(--mk2\)/g, c2)
    .replace('<svg ', '<svg x="14" y="14" width="68" height="68" ');
  const svg = m.tile
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="${brand.tokens['brand-ink']}"/>${inner}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#FFFFFF"/>${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function _resetCache() { cache = null; }

module.exports = { DEFAULT_BRAND, SETTING_KEY, BRANDS, brandKey, resolveBrandKey, publicBrand, cssVars, faviconHref, _resetCache };
