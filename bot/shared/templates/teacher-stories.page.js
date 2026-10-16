'use strict';
/**
 * The teacher's Stories page (/quiz/teacher/<th>/stories; app_settings web_quiz_stories_teacher), rendered by the bot and
 * forwarded by the portal like the teacher report. No framework and no script it cannot do without: the grade and
 * language chips are links, a book opens its preview (?book=<id>) whose render readies the send, and "Send to class" is a
 * plain link (same origin → the bot marks it sent → wa.me with the message). One small inline script copies the message
 * and turns the home's `#book/<id>` into `?book=<id>`.
 */
const urDigits = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const COPY = {
  en: {
    title: 'Stories for your class', grade: (g) => `Grade ${g}`, picked: 'Picked for you',
    min: (m) => `about ${m} min`, pages: (p) => `${p} ${p === 1 ? 'page' : 'pages'}`,
    send: 'Send to class', back: 'All stories', none: 'No stories here — pick another grade or language.',
    msgHead: 'Your class will get this message:', copy: 'Copy the message', copied: 'Copied', longPress: 'Long-press the message to copy it',
    firstPage: 'First page', oops: 'This story cannot be sent right now. Please try again in a little while.',
    hear: 'Hear page 1', home: 'Home', sep: ' · ',
  },
  ur: {
    title: 'آپ کی کلاس کے لیے کہانیاں', grade: (g) => `جماعت ${urDigits(g)}`, picked: 'آپ کے لیے چنی گئی',
    min: (m) => `تقریباً ${urDigits(m)} منٹ`, pages: (p) => `${urDigits(p)} ${p === 1 ? 'صفحہ' : 'صفحے'}`,
    send: 'کلاس کو بھیجیں', back: 'سب کہانیاں', none: 'یہاں کوئی کہانی نہیں — کوئی اور جماعت یا زبان چنیں۔',
    msgHead: 'آپ کی کلاس کو یہ پیغام ملے گا:', copy: 'پیغام کاپی کریں', copied: 'کاپی ہو گیا', longPress: 'پیغام کو دیر تک دبا کر کاپی کریں',
    firstPage: 'پہلا صفحہ', oops: 'یہ کہانی ابھی نہیں بھیجی جا سکتی۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',
    hear: 'پہلا صفحہ سنیں', home: 'ہوم', sep: '، ',
  },
};
const LANG_NAMES = { ur: 'اردو', en: 'English' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `:root{--bg:#fffaf0;--ink:#1d2433;--soft:#5b6475;--go:#1f8a4c;--line:#e3dccb}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
:lang(ur){font-family:"WQ Nastaliq",system-ui,sans-serif;font-size:18px;line-height:1.9}
main{max-width:560px;margin:0 auto;padding:16px 16px 40px}h1{font-size:22px;margin:6px 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.chip{display:inline-flex;align-items:center;min-height:44px;padding:6px 14px;border:1.5px solid var(--line);border-radius:22px;background:#fff;color:var(--ink);text-decoration:none}
.chip.on{border-color:var(--go);background:#e8f5ee;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:8px}
.tile{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--line);border-radius:14px;background:#fff;color:inherit;text-decoration:none}
.cover{width:100%;height:auto;aspect-ratio:2/3;object-fit:cover;border-radius:10px;background:#f1ecdf;display:block}
.t{font-weight:600;font-size:15px;line-height:1.35}.m{color:var(--soft);font-size:14px}
.pick{color:#8a6400;background:#fff3c4;border-radius:8px;padding:1px 6px;font-weight:600}
.back{display:inline-flex;align-items:center;min-height:44px;color:var(--soft);text-decoration:none}
.pics{display:flex;gap:10px;max-height:140px}.big{height:140px;width:auto;max-width:48%;object-fit:cover;border-radius:12px;background:#f1ecdf}
.msg{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:6px 0 0;font:inherit;width:100%;color:inherit;resize:none}
.msg:lang(en){font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.45}
:lang(ur) .btn{font-weight:400}
.btn{display:block;width:100%;min-height:56px;margin:14px 0 0;padding:15px;border:0;border-radius:14px;font:inherit;font-size:18px;font-weight:600;text-align:center;text-decoration:none}
.go{background:var(--go);color:#fff}.soft{background:#fff;color:var(--ink);border:1.5px solid var(--line)}
.note{color:var(--soft);font-size:15px;margin:12px 0 0}.hear{display:flex;align-items:center;gap:8px;margin:6px 0 0}.hear audio{flex:1;min-width:0;height:40px}.oops{background:#fff1f0;border-radius:12px;padding:12px}`;

// The copy button (clipboard → execCommand → "long-press"); the home's #book/<id> becomes ?book=<id>.
const JS = `(function(){var m=location.hash.match(/^#book\\/([0-9a-f-]{36})$/i);if(m&&!/[?&]book=/.test(location.search)){location.replace(location.pathname+(location.search?location.search+'&':'?')+'book='+m[1]);return;}
var b=document.getElementById('copy'),t=document.getElementById('msg');if(!b||!t)return;b.hidden=false;
function ok(){b.textContent=b.getAttribute('data-done');}function no(){b.textContent=b.getAttribute('data-long');}
b.addEventListener('click',function(){var v=t.value;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(ok,function(){fb();});}else fb();
function fb(){try{t.removeAttribute('readonly');t.select();var r=document.execCommand('copy');t.setAttribute('readonly','');r?ok():no();}catch(e){no();}}});})();`;

function head({ lang, title }) {
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
${lang === 'ur' ? '<link rel="preload" href="/wq/fonts/wq-nastaliq-3.woff2" as="font" type="font/woff2" crossorigin>\n<style>@font-face{font-family:"WQ Nastaliq";src:url(/wq/fonts/wq-nastaliq-3.woff2) format("woff2");font-display:swap}</style>\n' : ''}<style>${CSS}</style>
</head>`;
}

function home(th) { return `/quiz/teacher/${encodeURIComponent(th)}`; }
function base(th) { return `${home(th)}/stories`; }
function shelfHref(th, grade, lang) { return `${base(th)}?grade=${grade}&lang=${lang}`; }
function minutesOf(b) { return b.minutes ? Math.max(1, Math.round(Number(b.minutes))) : Math.max(1, Math.round((b.pages || 1) * 0.4)); }

/** The shelf: grade chips, language chips, the books (featured first). */
function renderShelf({ th, shelf, ui }) {
  const T = COPY[ui];
  const g = Number(shelf.grade) || 2;
  const l = shelf.lang === 'en' ? 'en' : 'ur';
  const grades = [1, 2, 3, 4, 5].map((n) => `<a class="chip${n === g ? ' on' : ''}" data-tap="grade" href="${esc(shelfHref(th, n, l))}"${n === g ? ' aria-current="true"' : ''}>${esc(T.grade(n))}</a>`).join('');
  const langs = ['ur', 'en'].map((x) => `<a class="chip${x === l ? ' on' : ''}" data-tap="lang" lang="${x}" dir="${x === 'ur' ? 'rtl' : 'ltr'}" href="${esc(shelfHref(th, g, x))}"${x === l ? ' aria-current="true"' : ''}>${esc(LANG_NAMES[x])}</a>`).join('');
  const books = shelf.books || [];
  // The first book (the featured one when there is one) is the screen's one primary.
  const tiles = books.map((b, i) => `<a class="tile"${i === 0 ? ' data-primary="1"' : ''} data-tap="book" href="${esc(`${shelfHref(th, g, l)}&book=${b.id}`)}" lang="${esc(b.lang)}" dir="${esc(b.dir)}">`
    + (b.cover ? `<img class="cover" src="${esc(b.cover)}" alt="" width="160" height="240" loading="${i < 4 ? 'eager' : 'lazy'}">` : '<span class="cover"></span>')
    + `<span class="t">${esc(b.title)}</span><span class="m" lang="${ui}" dir="${ui === 'ur' ? 'rtl' : 'ltr'}">${b.featured ? `<b class="pick">${esc(T.picked)}</b> ` : ''}${esc(T.min(minutesOf(b)))}</span></a>`).join('');
  return `${head({ lang: ui, title: T.title })}
<body>
<main data-screen="teacher-stories">
<a class="back" data-home="1" href="${esc(home(th))}">‹ ${esc(T.home)}</a>
<h1>${esc(T.title)}</h1>
<nav class="chips" aria-label="grade">${grades}</nav>
<nav class="chips" aria-label="language">${langs}</nav>
${books.length ? `<div class="grid">${tiles}</div>` : `<p class="note">${esc(T.none)}</p>`}
</main>
<script>${JS}</script>
</body>
</html>`;
}

/** The preview: cover + first page, about how long, the exact class message, ONE "Send to class", the report line. */
function renderPreview({ th, shelf, ui, p, firstPage, error }) {
  const T = COPY[ui];
  const g = Number(shelf.grade) || 2;
  const l = shelf.lang === 'en' ? 'en' : 'ur';
  const b = (p && p.book) || {};
  const backHref = shelfHref(th, g, l);
  if (error || !p) {
    return `${head({ lang: ui, title: T.title })}
<body>
<main data-screen="teacher-story-preview"><a class="back" data-back="1" href="${esc(backHref)}">‹ ${esc(T.back)}</a>
<p class="oops">${esc(T.oops)}</p></main>
</body>
</html>`;
  }
  return `${head({ lang: ui, title: b.title || T.title })}
<body>
<main data-screen="teacher-story-preview">
<a class="back" data-back="1" href="${esc(backHref)}">‹ ${esc(T.back)}</a>
<div class="pics" lang="${esc(b.lang)}" dir="${esc(b.dir)}">${b.cover ? `<img class="big" src="${esc(b.cover)}" alt="" width="160" height="240">` : ''}${(firstPage || b.first_page) ? `<img class="big page" src="${esc(firstPage || b.first_page)}" alt="${esc(T.firstPage)}">` : ''}</div>
<h1 lang="${esc(b.lang)}" dir="${esc(b.dir)}">${esc(b.title)}</h1>
<p class="m">${esc(T.min(minutesOf(b)))}${T.sep}${esc(T.pages(b.pages || 0))}</p>
${b.sample_audio ? `<p class="hear"><span>${esc(T.hear)}</span><audio controls preload="none" src="${esc(b.sample_audio)}"></audio></p>` : ''}
<p class="note">${esc(T.msgHead)}</p>
<textarea class="msg" id="msg" readonly rows="5" lang="${esc(b.lang)}" dir="${esc(b.dir)}">${esc(p.class_message)}</textarea>
<button type="button" class="btn soft" id="copy" data-tap="copy" data-done="${esc(T.copied)}" data-long="${esc(T.longPress)}" hidden>${esc(T.copy)}</button>
<form method="post" action="/api/teacher/story/send"><input type="hidden" name="th" value="${esc(th)}"><input type="hidden" name="story_id" value="${esc(b.id)}"><button type="submit" class="btn go" data-primary="1" data-tap="send">${esc(T.send)}</button></form>
<p class="note">${esc(p.back_line)}</p>
<p class="note">${esc(p.report_line)}</p>
</main>
<script>${JS}</script>
</body>
</html>`;
}

module.exports = { renderShelf, renderPreview, COPY };
