'use strict';
/**
 * The clip on the report IMAGE — bd-gzfdu9 (VIDREC), SPEC v1.2.1 §4.9 (the operator: "embedded in the teachers'
 * existing report", most of whom get it as a WhatsApp image).
 *
 * stripFor(): at the hero render, wait for the engine's pick for at most 20 s (the LLM's own timeout); a 'shown' row
 * becomes { thumbPath, title, durationS, levelLabel } for the templates, anything else (off, shadow, none, slower
 * than the cap, an error) is null and the image renders exactly as today. The flag is read at call time; `row` is
 * the engine's promise when the caller has it, else the session's stored row (merge-order safety, as send.js).
 *
 * stripHtml(): ONE block for both templates (hero 794 px, slim 480 px), right under "Try one thing tomorrow": a
 * 16:9 thumbnail with a play badge, "▶ Watch next: {title}" and "{n} min · tap ▶ Watch in the next message". It
 * carries its own <style>, so a report without a strip keeps its stylesheet byte for byte. The thumbnail is
 * inlined (data: URI): nothing is fetched at render time. The image is not tappable; the cta_url message is.
 */
const fs = require('fs');
const path = require('path');
const { logToFile } = require('../../../utils/logger');
const copy = require('./copy');

const CAP_MS = 20000;
const ASSETS = path.join(__dirname, '..', '..', '..', '..', 'assets');

function enabledByDefault() {
  try {
    return require('./flags').videoRecoEnabled() === true;
  } catch (_) {
    return false;
  }
}

async function stripFor({ coachingSessionId, language, row: given, capMs = CAP_MS, deps = {} } = {}) {
  try {
    const on = typeof deps.enabled === 'function' ? deps.enabled() : enabledByDefault();
    if (!on || !coachingSessionId) return null;
    const pending = given !== undefined ? Promise.resolve(given) : (deps.store || require('./store')).readForSession(coachingSessionId);
    let timer;
    const row = await Promise.race([pending, new Promise((r) => { timer = setTimeout(() => r(null), capMs); })]);
    clearTimeout(timer);
    if (!row || row.status !== 'shown') return null;
    const catalog = deps.catalog || require('./catalog');
    let hit = null;
    try { hit = catalog.segment(row.seg_id); } catch (_) { hit = null; }
    const mod = (hit && hit.module) || {};
    const seg = (hit && hit.segment) || {};
    const l = copy.lang(language);
    const start = Number(row.start_s) || 0;
    const end = Number(row.end_s) || 0;
    return {
      thumbPath: path.join(ASSETS, mod.thumb || `video-thumbs/${row.module_id}.jpg`),
      title: copy.localized(seg, 'title', l) || mod.title || '',
      durationS: end > start ? end - start : Number(mod.duration_s) || 60,
      levelLabel: copy.levelLabel(mod.cpd_level, l),
    };
  } catch (err) {
    logToFile('[video-reco] image strip skipped (non-fatal)', { coachingSessionId, error: err.message }, 'warn');
    return null;
  }
}

function thumbData(p) {
  try {
    return p && fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : '';
  } catch (_) {
    return '';
  }
}

/** The block for a template. `T` is the template's own text writer (escape + Latin-run isolation in Urdu). */
function stripHtml(vs, { language, T, width = 794 }) {
  if (!vs) return '';
  const l = copy.lang(language);
  const ur = copy.dirOf(l) === 'rtl';
  const n = copy.minutesOf(vs.durationS);
  const title = copy.word('videoRecoStripTitle', l, { title: vs.title || '' });
  const hint = copy.word('videoRecoStripHint', l, { n: copy.num(n, l) });
  const b64 = thumbData(vs.thumbPath);
  const side = width >= 700 ? '42px' : '0';
  const cover = b64 ? `background:#1f2433 url(data:image/jpeg;base64,${b64}) center/cover no-repeat` : 'background:linear-gradient(135deg,#333748,#47BA7D)';
  return `<div class="vstrip"><style>.vstrip{margin:12px ${side} 0;background:#fff;border:2px solid #47BA7D;border-radius:16px;padding:12px;display:flex;gap:12px;align-items:center;min-width:0;max-width:100%}`
    + `.vstrip .vth{position:relative;flex:none;width:96px;height:54px;border-radius:8px;${cover}}`
    + '.vstrip .vth:before{content:"";position:absolute;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}'
    + '.vstrip .vth:after{content:"";position:absolute;left:50%;top:50%;margin:-6px 0 0 -3px;border-left:10px solid #1f2433;border-top:6px solid transparent;border-bottom:6px solid transparent}'
    + `.vstrip .vtx{min-width:0;flex:1}.vstrip .vt1{font-size:15px;font-weight:700;color:#1f2433;line-height:${ur ? '2' : '1.35'};display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}`
    + `.vstrip .vt2{font-size:13px;color:#5f6677;line-height:${ur ? '2' : '1.4'}}</style>`
    + `<div class="vth"></div><div class="vtx"><div class="vt1">${T(title)}</div><div class="vt2">${T(hint)}</div></div></div>`;
}

module.exports = { stripFor, stripHtml, CAP_MS };
