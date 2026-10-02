/**
 * Child-test stimulus — embedded fonts (bd-s1oo0.2).
 *
 * The Railway Chromium has no system fonts, so every face is base64-embedded as an @font-face
 * data: URI (see the playwrite-reports skill, §1). Two faces:
 *   - CTAndika: SIL Andika, built for early readers — single-storey a and g, capital I with
 *     serifs so it is not a bare bar like lower-case l (design review §2e). Subset to Latin-1 +
 *     general punctuation + the maths signs (− ×) and the progress dots (● ○); OFL licence in
 *     shared/fonts/Andika-OFL.txt.
 *   - CTNastaliq: Noto Nastaliq Urdu, already used by every Urdu report in this repo.
 */

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', '..', '..', 'fonts');
const FILES = {
  andika: 'Andika-Latin-Regular.ttf',
  andikaBold: 'Andika-Latin-Bold.ttf',
  nastaliq: 'NotoNastaliqUrdu-Regular.ttf',
  nastaliqBold: 'NotoNastaliqUrdu-Bold.ttf',
};

const _cache = {};
function b64(name) {
  if (!_cache[name]) {
    const abs = path.join(FONT_DIR, FILES[name]);
    // A missing face is a broken card (tofu boxes or a fallback face), never a quiet default.
    if (!fs.existsSync(abs)) throw new Error(`child-test render: font file missing: ${FILES[name]}`);
    _cache[name] = fs.readFileSync(abs).toString('base64');
  }
  return _cache[name];
}

function face(family, name, weight) {
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64(name)}) format('truetype');font-weight:${weight};font-style:normal}`;
}

/**
 * @param {{latin?: boolean, urdu?: boolean, bold?: boolean}} need
 * @returns {string} CSS @font-face rules
 */
function fontFaceCss({ latin = true, urdu = false, bold = false } = {}) {
  const out = [];
  if (latin) { out.push(face('CTAndika', 'andika', 400)); if (bold) out.push(face('CTAndika', 'andikaBold', 700)); }
  if (urdu) { out.push(face('CTNastaliq', 'nastaliq', 400)); if (bold) out.push(face('CTNastaliq', 'nastaliqBold', 700)); }
  return out.join('');
}

const LATIN_STACK = "'CTAndika',sans-serif";
const URDU_STACK = "'CTNastaliq',serif";

module.exports = { fontFaceCss, LATIN_STACK, URDU_STACK, FILES };
