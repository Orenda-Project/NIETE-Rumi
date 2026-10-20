'use strict';
/**
 * The header picture of the "watch this clip" message — bd-gzfdu9 (VIDREC), SPEC §4.3.
 *
 * A 480×270 (16:9) video card: the module's thumbnail as cover, a white play circle in the middle, the clip's
 * length as an m:ss pill (bottom right), and a bottom band with the title (at most two lines: a one-line cut
 * landed inside the English run of an Urdu title) (no level badge: it read as "you are a beginner" to teachers who finished the ladder).
 * Drawn with the hero report's renderer (htmlToImage) and its embedded fonts (Lexend; Nastaliq for Urdu), the
 * thumbnail inlined as a data: URI: nothing is fetched at render time. A missing thumbnail draws a plain
 * gradient; a failed render returns null and the sender sends the button without a picture.
 */
const fs = require('fs');
const { logToFile } = require('../../../utils/logger');
const { wrapLatinRuns } = require('../../../templates/latin-runs');
const { fontFaces, esc } = require('../report-v2/hero-report.template');
const copy = require('./copy');
const { clock } = copy;

const W = 480;
const H = 270;

function thumbData(p) {
  try {
    return p && fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : '';
  } catch (_) {
    return '';
  }
}

/** vm = { thumbPath, title, durationS, language } → HTML for htmlToImage (selector '.vcard'). No level badge: to a teacher who finished the ladder it read as "you are a beginner". */
function buildVideoCardHtml(vm = {}) {
  const ur = copy.dirOf(vm.language) === 'rtl';
  const T = (s) => (ur ? wrapLatinRuns(esc(s), { token: "[A-Za-z0-9'’.\\-]", requireLetter: true }) : esc(s));
  const b64 = thumbData(vm.thumbPath);
  const cover = b64
    ? `background:#1f2433 url(data:image/jpeg;base64,${b64}) center/cover no-repeat`
    : 'background:linear-gradient(135deg,#333748 0%,#2f5d4f 60%,#47BA7D 100%)';
  const body = ur ? `'NastaliqUrdu','Lexend',serif` : `'Lexend','NastaliqUrdu',sans-serif`;
  return `<!doctype html><html lang="${copy.lang(vm.language)}" dir="${copy.dirOf(vm.language)}"><head><meta charset="utf-8"><style>
  ${fontFaces()}
  *{box-sizing:border-box;margin:0}
  body{background:#14161c;font-family:${body}}
  .vcard{position:relative;width:${W}px;height:${H}px;overflow:hidden;border-radius:0;${cover}}
  .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.8) 100%)}
  .play{position:absolute;left:50%;top:44%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35)}
  .play:after{content:'';position:absolute;left:26px;top:20px;border-left:18px solid #1f2433;border-top:12px solid transparent;border-bottom:12px solid transparent}
  .band{position:absolute;left:0;right:0;bottom:0;padding:0 16px 14px;display:grid;gap:6px}
  .title{color:#fff;font-size:${ur ? '19px' : '21px'};font-weight:700;line-height:${ur ? '1.8' : '1.3'};display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;text-overflow:ellipsis;max-width:${W - 32 - 70}px;text-shadow:0 1px 3px rgba(0,0,0,.6)}
  .pill{position:absolute;bottom:14px;${ur ? 'left' : 'right'}:14px;direction:ltr;unicode-bidi:isolate;font-family:'Lexend',sans-serif;color:#fff;font-size:15px;font-weight:700;background:rgba(0,0,0,.75);border-radius:8px;padding:3px 9px}
  .ltr{direction:ltr;unicode-bidi:isolate;font-family:'Lexend',sans-serif}
</style></head><body><div class="vcard"><div class="shade"></div><div class="play"></div>`
    + `<div class="band"><div class="title">${T(vm.title || '')}</div></div>`
    + `<span class="pill">${esc(clock(vm.durationS))}</span></div></body></html>`;
}

/** The PNG (CSS 480×270 at device scale 2), or null when it cannot be drawn. Never throws. */
async function renderVideoCard(vm) {
  try {
    const { htmlToImage } = require('../../../utils/html-to-pdf');
    return await htmlToImage(buildVideoCardHtml(vm), { selector: '.vcard', width: W, deviceScaleFactor: 2 });
  } catch (err) {
    logToFile('[video-reco] card image failed (the button goes without a picture)', { error: err.message }, 'warn');
    return null;
  }
}

module.exports = { buildVideoCardHtml, renderVideoCard, W, H };
