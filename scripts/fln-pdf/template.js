'use strict';
/**
 * bd-s0ccn5.2.1 — the FLN plan as one printable HTML page, for the downloadable PDF.
 *
 * Pure: no file, network or clock. The caller passes the font CSS (base64 @font-face) and may re-address picture
 * URLs (imageSrc). Text and pictures only — a PDF cannot play sound, so audio and video are left out rather than
 * drawn as dead players. The plan's markdown subset matches portal/src/portal/fln/plan/text.tsx: `**bold**`,
 * `*italic*`, `\n` line breaks; everything else is escaped literal text. Labels mirror portal/src/portal/fln/strings.ts.
 */

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const num = (n, lang) => (lang === 'ur' ? String(n).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]) : String(n));

const LABELS = {
  en: {
    subject: { 'rh-en': 'Reading Hour · English', 'rh-ur': 'Reading Hour · Urdu', num: 'Numeracy' },
    kicker: (l, p, c) => `Level ${l} · Lesson ${p}/${c}`,
    kickerLevel: (l) => `Level ${l}`,
    minutes: (n) => `${n} min`,
    slo: 'Learning outcomes',
    bring: 'Bring',
    before: 'Before class',
    homework: 'Homework',
    section: { opening: 'Opening', explain: 'Explain', practice: 'Practice', independent_practice: 'Independent practice', conclusion: 'Conclusion' },
    itemKind: { say: 'Say:', ask: 'Ask:', answer: 'Answer:' },
    groupLevel: { beginner: 'Beginner', intermediate: 'Intermediate', advance: 'Advanced' },
    footer: (id) => `FDE FLN programme · ID ${id}`,
  },
  ur: {
    subject: { 'rh-en': 'ریڈنگ آور — انگریزی', 'rh-ur': 'ریڈنگ آور — اردو', num: 'بنیادی حساب' },
    kicker: (l, p, c) => `سطح ${num(l, 'ur')} — سبق ${num(p, 'ur')} (کل ${num(c, 'ur')})`,
    kickerLevel: (l) => `سطح ${num(l, 'ur')}`,
    minutes: (n) => `${num(n, 'ur')} منٹ`,
    slo: 'سیکھنے کے نتائج',
    bring: 'ساتھ لائیں',
    before: 'کلاس سے پہلے',
    homework: 'گھر کا کام',
    section: { opening: 'آغاز', explain: 'وضاحت', practice: 'مشق', independent_practice: 'انفرادی مشق', conclusion: 'اختتام' },
    itemKind: { say: 'کہیں:', ask: 'پوچھیں:', answer: 'جواب:' },
    groupLevel: { beginner: 'ابتدائی گروپ', intermediate: 'درمیانی گروپ', advance: 'اعلیٰ گروپ' },
    footer: (id) => `FDE FLN پروگرام — آئی ڈی ${id}`,
  },
};

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INLINE = /\*\*(.+?)\*\*|\*(?=\S)(.+?)(?<=\S)\*/g;

/** Escape first, then the markdown subset; `*` and `<b>` cannot appear in escaped output, so no markup leaks in. */
function inline(text) {
  return esc(text).replace(INLINE, (_, bold, ital) => (bold != null ? `<b>${inline(bold)}</b>` : `<i>${ital}</i>`));
}

const planText = (text) => String(text || '').split('\n').map(inline).join('<br>');

/** http(s), or a picture already inlined at render time (raster only: an SVG can carry script). */
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) || DATA_IMAGE.test(s) ? s : '';
}

function picture(m, lang, imageSrc) {
  const src = safeUrl(imageSrc(m));
  if (!src) return '';
  const cap = lang === 'ur' ? (m.caption_ur || m.caption_en) : (m.caption_en || m.caption_ur);
  const dims = m.w && m.h ? ` width="${Number(m.w) || ''}" height="${Number(m.h) || ''}"` : '';
  return `<figure><img src="${esc(src)}"${dims} alt="${esc(cap || '')}">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
}

function move(item, L, lang, imageSrc) {
  const label = L.itemKind[item.kind];
  const cls = item.kind === 'answer' ? 'mv ans' : 'mv';
  const pics = (item.media || []).filter((m) => m && m.kind === 'image').map((m) => picture(m, lang, imageSrc)).join('');
  return `<div class="${cls}"><p>${label ? `<span class="k">${esc(label)}</span> ` : ''}${planText(item.text)}</p>${pics}</div>`;
}

function group(g, L, lang, imageSrc) {
  const lvl = g.level && L.groupLevel[g.level];
  const head = g.header || lvl
    ? `<h3>${esc(g.header || '')}${g.header && lvl ? ' · ' : ''}${lvl ? `<span class="lvl">${esc(lvl)}</span>` : ''}</h3>`
    : '';
  return `<div class="grp">${head}${(g.items || []).map((it) => move(it, L, lang, imageSrc)).join('')}</div>`;
}

function section(s, L, lang, imageSrc) {
  const name = L.section[s.kind] || s.kind || '';
  const mins = s.minutes ? `<span class="min">${esc(L.minutes(s.minutes))}</span>` : '';
  return `<section><h2>${esc(name)}${mins}</h2>${(s.groups || []).map((g) => group(g, L, lang, imageSrc)).join('')}</section>`;
}

const list = (title, items) => (items && items.length
  ? `<div class="box"><h4>${esc(title)}</h4><ul>${items.map((t) => `<li>${planText(t)}</li>`).join('')}</ul></div>`
  : '');

/** setup / homework: a list of {kind,text,media} moves in corpus v2 (a bare string in older bundles). */
function moveBox(title, v, L, lang, imageSrc) {
  const items = (Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== '');
  if (!items.length) return '';
  const body = items.map((it) => (typeof it === 'object'
    ? move(it, L, lang, imageSrc)
    : `<div class="mv"><p>${planText(it)}</p></div>`)).join('');
  return `<div class="box"><h4>${esc(title)}</h4>${body}</div>`;
}

const CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Lexend', 'Inter', Arial, sans-serif; color: #1f2937; font-size: 11.5pt; line-height: 1.5; }
  [dir=rtl] body, html[dir=rtl] body { font-family: 'Noto Nastaliq Urdu', 'Lexend', serif; line-height: 2.1; }
  .kick { color: #2f855a; font-weight: 700; font-size: 10pt; }
  h1 { margin: 2px 0 4px; font-size: 18pt; color: #333748; }
  .meta { color: #6b7280; font-size: 10pt; margin-bottom: 10px; }
  .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; margin: 8px 0; }
  .box h4 { margin: 0 0 2px; font-size: 10.5pt; color: #333748; }
  .box ul { margin: 0; padding-inline-start: 18px; }
  section { margin-top: 12px; }
  h2 { font-size: 13pt; color: #fff; background: #47BA7D; padding: 3px 10px; border-radius: 4px; margin: 0 0 6px; break-after: avoid; }
  h2 .min { float: inline-end; font-weight: 400; font-size: 10pt; }
  h3 { font-size: 11pt; margin: 8px 0 2px; color: #333748; break-after: avoid; }
  h3 .lvl { color: #2f855a; }
  .mv { margin: 3px 0; break-inside: avoid; }
  .mv p { margin: 0; }
  .mv .k { font-weight: 700; color: #333748; }
  .mv.ans p { color: #2f855a; }
  figure { margin: 4px 0 6px; break-inside: avoid; }
  figure img { max-width: 70%; max-height: 70mm; width: auto; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
  figcaption { font-size: 9pt; color: #6b7280; }
  footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 8.5pt; }
`;

/**
 * @param {object} plan     FlnPlan (contracts/plan-json.md v2)
 * @param {object} [opts]
 * @param {{level:number,pos?:number,count?:number}} [opts.placement]
 * @param {string} [opts.fontCss]   @font-face rules, embedded as given
 * @param {(m:object)=>string} [opts.imageSrc]  picture URL for a media entry (default m.src)
 */
function renderFlnPlanHtml(plan, opts = {}) {
  const lang = plan.lang === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const L = LABELS[lang];
  const imageSrc = typeof opts.imageSrc === 'function' ? opts.imageSrc : (m) => m.src;
  const pl = opts.placement;
  const subject = L.subject[plan.subject] || '';
  let kicker = subject;
  if (pl && pl.level) {
    const where = pl.pos && pl.count ? L.kicker(pl.level, pl.pos, pl.count) : L.kickerLevel(pl.level);
    kicker = `${subject}${lang === 'ur' ? ' — ' : ' · '}${where}`;
  }
  const total = plan.minutes && plan.minutes.total;
  const body = [
    `<div class="kick">${esc(kicker)}</div>`,
    `<h1>${esc(plan.title)}</h1>`,
    total ? `<div class="meta">${esc(L.minutes(total))}</div>` : '',
    list(L.slo, plan.slo),
    list(L.bring, plan.resources),
    moveBox(L.before, plan.setup, L, lang, imageSrc),
    (plan.sections || []).map((s) => section(s, L, lang, imageSrc)).join(''),
    moveBox(L.homework, plan.homework, L, lang, imageSrc),
    `<footer>${esc(L.footer(plan.id))}</footer>`,
  ].join('\n');
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${esc(plan.title)}</title>
<style>${opts.fontCss || ''}${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

module.exports = { renderFlnPlanHtml };
