'use strict';
/**
 * The teacher's Jugnu tab — /r/<token>?tab=jugnu, drawn inside the teacher report's own chrome
 * (teacher-report.page renderPage hands it the shell). Switch web_quiz_teacher_jugnu.
 *
 *   renderJugnu(tab, { lang, tokens, queue, notice })  → { header, main, css, title, needUrdu }
 *   forwardText(title, lang)                            → the "Forward to the class group" prefill
 *   queueReady(lang)                                    → the confirm queue's copy keys exist
 *
 * NO JAVASCRIPT, like the report: the forward is a link the server answers with a 302 to wa.me, the
 * queue's taps are forms the server answers with a 303 back here.
 *
 * Copy: copy.v2.json keys only (jg.t.* → T.<lang>.t*, jg.rung.* → T.<lang>.rung*, wa.t.fwd_text → FWD).
 * The confirm queue's words are jg.t.q_head, q_same, q_diff, q_unsure, q_undo, q_link, q_sub (tQ*); a
 * language missing any of them draws no queue section (queueReady).
 *
 * L11: "N of M have started" is drawn on this tab only. The forward carries the story title and the
 * deck's words — no number of any kind, no name (forwardText refuses a title with a digit or a name).
 */
const { parts } = require('./teacher-report.page');

const { kit, topBar, qs, esc, urduDigits } = parts;

const T = {
  en: {
    tTab: 'Jugnu',
    tEyebrow: 'Class at a glance',
    tMonth: 'Jugnu: this month',
    tCoverage: '{n} of {total} have started this month',
    tColName: 'Name',
    tColGames: 'Games this month',
    tColStickers: 'Stickers',
    tStopped: 'Stopped early',
    tMic: 'Waiting for a microphone',
    tSaved: 'Saved on WhatsApp ✓',
    tUndo: 'Undo',
    tSort: 'Sorted by name. No scores, no positions.',
    tPractice: "Practice: nothing counts on a teacher's phone.",
    tFwdBtn: 'Forward to the class group',
    tQHead: 'Is {name} the same child as {name2}?',
    tQSame: 'Same child',
    tQDiff: 'Different',
    tQUnsure: 'Not sure',
    tQUndo: 'Undo',
    tQLink: "Link this class's quiz codes to the class list",
    tQSub: 'Nothing is ever deleted, and Undo is always here.',
    rungR1: 'Starting a story',
    rungR2: 'Reading a short story',
    rungR3: 'Understanding a short story',
    rungR4: 'Reading a longer story',
    rungR5: 'Understanding a longer story',
    rungN1: 'Finding numbers',
    rungN2: 'Comparing numbers',
    rungN3: 'Filling number gaps',
    rungN4: 'Counting past 100',
    rungN5: 'Filling every number gap',
  },
  ur: {
    tTab: 'جگنو',
    tEyebrow: 'کلاس کی جھلک',
    tMonth: 'جگنو: اس مہینے',
    tCoverage: 'اس مہینے {total} میں سے {n} بچوں نے شروع کیا',
    tColName: 'نام',
    tColGames: 'اس مہینے کے کھیل',
    tColStickers: 'اسٹیکر',
    tStopped: 'ایک کھیل ادھورا',
    tMic: 'مائیک والا کھیل باقی',
    tSaved: 'واٹس ایپ پر محفوظ ✓',
    tUndo: 'واپس لیں',
    tSort: 'ترتیب نام کے حساب سے۔ کوئی اسکور نہیں، کوئی پوزیشن نہیں۔',
    tPractice: 'مشق: ٹیچر کے فون پر کچھ بھی شمار نہیں ہوتا۔',
    tFwdBtn: 'کلاس گروپ میں فارورڈ کریں',
    tQHead: 'کیا ⁨{name}⁩ اور ⁨{name2}⁩ ایک ہی بچہ ہیں؟',
    tQSame: 'ایک ہی بچہ',
    tQDiff: 'الگ الگ ہیں',
    tQUnsure: 'یقین نہیں',
    tQUndo: 'واپس لیں',
    tQLink: 'اس کلاس کے کوئز کوڈ کلاس کی فہرست سے جوڑیں',
    tQSub: 'اس سے کبھی کچھ نہیں مٹتا، اور «واپس لیں» ہمیشہ یہیں ہے۔',
    rungR1: 'کہانی شروع کرنا',
    rungR2: 'چھوٹی کہانی پڑھنا',
    rungR3: 'چھوٹی کہانی سمجھنا',
    rungR4: 'لمبی کہانی پڑھنا',
    rungR5: 'لمبی کہانی سمجھنا',
    rungN1: 'نمبر ڈھونڈنا',
    rungN2: 'بڑا چھوٹا نمبر پہچاننا',
    rungN3: 'غائب نمبر بھرنا',
    rungN4: 'سو سے آگے گننا',
    rungN5: 'سارے غائب نمبر بھرنا',
  },
};

// wa.t.fwd_text (the Urdu keeps its U+2068/U+2069 isolate around the title).
const FWD = {
  en: "This week in Jugnu's Challenge: {title}. A new story every Monday. Open the pinned link.",
  ur: 'جگنو کے چیلنج میں اس ہفتے: ⁨{title}⁩۔ ہر پیر کو نئی کہانی۔ پِن کیا ہوا لنک کھولیں۔',
};

const QUEUE_KEYS = ['tQHead', 'tQSame', 'tQDiff', 'tQUnsure', 'tQUndo', 'tQLink', 'tQSub'];
const queueReady = (lang) => QUEUE_KEYS.every((k) => typeof (T[lang] || {})[k] === 'string' && T[lang][k].length > 0);

const ANY_DIGIT = /[0-9٠-٩۰-۹]/;
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

/**
 * The forward's text, or null when it cannot be sent clean: no title, a title with a digit, or a
 * title that carries a first name from the class list (`names`).
 */
function forwardText(title, lang, names = []) {
  const t = String(title || '').trim();
  if (!t || ANY_DIGIT.test(t)) return null;
  const folded = t.toLowerCase();
  if (names.some((n) => n && folded.includes(String(n).toLowerCase()))) return null;
  const out = fill(FWD[lang] || FWD.en, { title: t });
  return ANY_DIGIT.test(out) ? null : out;
}

const CSS = `
.jg-eb{font-size:.8rem;color:#D7DAE2;letter-spacing:.02em;margin-bottom:2px}
.jcov{margin-top:6px;font-weight:700;color:#fff}
.jl{list-style:none;margin:0;padding:0}
.jk{padding:12px 0;border-bottom:1px solid var(--line)}
.jk:last-child{border-bottom:0}
.jh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.jn{font-size:1.05rem}
.jf{font-size:.8rem;color:var(--muted)}
.jr{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:6px;font-size:.85rem;line-height:var(--lead-ui)}
.jr .k{color:var(--muted)}
.st{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid var(--line);margin-inline-end:3px;vertical-align:middle}
.st.on{background:var(--green);border-color:var(--green)}
.st.read,.st.listen{border-radius:3px}
.jw{color:#8A5A00;background:#FFF4DE;border-radius:999px;padding:1px 10px}
.lamp{color:var(--amber);letter-spacing:1px}
.dd{display:inline-flex;gap:3px}
.dd i{width:8px;height:8px;border-radius:50%;background:var(--grey-bg)}
.dd i.on{background:var(--green)}
.jsv{color:var(--green-deep);font-weight:700}
.jub{display:inline;margin:0}
.jub button{font:inherit;font-size:.85rem;cursor:pointer;border:0;background:none;color:var(--muted);text-decoration:underline;padding:0 4px}
.jq-r{padding:10px 0;border-bottom:1px solid var(--line)}
.jq-r:last-of-type{border-bottom:0}
.jq-r form{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.jq-r button,.jq-l button{font:inherit;font-size:.9rem;cursor:pointer;border-radius:10px;border:1.5px solid var(--line);background:var(--card);padding:6px 14px;color:var(--ink)}
.jq-r button.same{border-color:var(--green);color:var(--green-deep);font-weight:700}
.jq-l{margin-top:12px}
.jq-w{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:6px}
.jq-n{display:inline-flex;flex-direction:column}
.jqf{font-size:.8rem;color:var(--muted)}
`;

/**
 * @param {object} tab teacher-jugnu.data jugnuTab()
 * @param {{lang: 'en'|'ur', tokens: {self: string}, queue?: object[]|null, notice?: string|null, scope?: 'quiz'|'all'}} opts
 */
function renderJugnu(tab, { lang = 'en', tokens = {}, queue = null, notice = null, scope = 'quiz' } = {}) {
  const { rtl, C, T: Tx, L } = kit(lang);
  const S = T[lang] || T.en;
  const n = (v) => (lang === 'ur' ? urduDigits(v) : String(v));
  const self = encodeURIComponent(tokens.self || '');
  const base = `/r/${self}`;
  const listId = tab && tab.list ? tab.list.id : null;
  const here = (extra) => `${base}${qs([['tab', 'jugnu'], ['class', listId], ...extra])}`;
  const cov = tab && tab.coverage
    ? `<div class="jcov">${L(fill(S.tCoverage, { n: n(tab.coverage.n), total: n(tab.coverage.total) }))}</div>` : '';
  const header = `<header class="top"><div class="in">
${topBar({ C, L, langHref: here([['lang', C.switchLang]]), print: false })}
<div class="jg-eb">${L(S.tEyebrow)}</div><h1>${L(S.tMonth)}</h1>${cov}
</div></header>`;

  const kids = (tab && tab.kids) || [];
  const rows = kids.map((k) => {
    const stops = k.stops.map((s) => `<i class="st ${s.key}${s.done ? ' on' : ''}" aria-hidden="true"></i>`).join('');
    const words = [k.stopped ? `<span class="jw">${L(S.tStopped)}</span>` : '', k.mic ? `<span class="jw">${L(S.tMic)}</span>` : ''].join('');
    const lampOf = (key, rung) => (rung > 0 && S[`rung${key.toUpperCase()}${rung}`]
      ? `<span><span class="lamp" aria-hidden="true">${'●'.repeat(rung)}</span> ${L(S[`rung${key.toUpperCase()}${rung}`])}</span>` : '');
    const lamps = k.lamps ? ['r', 'n'].map((key) => lampOf(key, k.lamps[key] || 0)).join('') : '';
    const days = k.days ? `<span class="dd" aria-hidden="true">${k.days.map((d) => `<i${d ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
    const stickers = k.stickers != null ? `<span><span class="k">${L(S.tColStickers)}</span> <span class="num">${n(k.stickers)}</span></span>` : '';
    return `<li class="jk"><div class="jh"><b class="jn">${Tx(k.first)}</b>${k.homonym && k.father ? `<span class="jf">${Tx(k.father)}</span>` : ''}</div>`
      + `<div class="jr"><span><span class="k">${L(S.tColGames)}</span> ${stops}</span>${words}${stickers}</div>`
      + `${lamps || days || k.saved ? `<div class="jr">${lamps}${days}${k.saved ? `<span class="jsv">${L(S.tSaved)}</span>${k.undo && listId ? `<form class="jub" method="post" action="${base}/unbind"><input type="hidden" name="binding" value="${esc(k.bindingIds[0])}"><input type="hidden" name="class" value="${esc(listId)}"><button type="submit">${L(S.tUndo)}</button></form>` : ''}` : ''}</div>` : ''}</li>`;
  }).join('');

  const fwd = tab && tab.forwardable
    ? `<a class="btn btn-primary" href="${base}/fwd${qs([['class', listId], ['lang', lang]])}">${L(S.tFwdBtn)}</a>` : '';
  const failed = notice === 'failed' ? `<div class="notice" role="status">${L(C.noticeFailed)}</div>` : '';

  let queueHtml = '';
  if (Array.isArray(queue) && queueReady(lang) && listId) {
    const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
    const qrows = queue.map((r) => {
      const head = fill(esc(S.tQHead), { name: Tx(r.first), name2: Tx(r.candidateFirst) });
      const ids = `${hidden('loose_id', r.looseId)}${hidden('candidate_id', r.candidateId)}${hidden('class', listId)}`;
      const buttons = r.decided
        ? `<button type="submit" name="decision" value="undo">${L(S.tQUndo)}</button>`
        : `<button type="submit" class="same" name="decision" value="same">${L(S.tQSame)}</button>`
          + `<button type="submit" name="decision" value="no">${L(S.tQDiff)}</button>`
          + `<button type="submit" name="decision" value="unsure">${L(S.tQUnsure)}</button>`;
      // Under each name, the father's first name ("—" when the record has none): teacher view only, never a surname.
      const who = (first, father) => `<span class="jq-n"><b>${Tx(first)}</b><span class="jqf">${father ? Tx(father) : '—'}</span></span>`;
      return `<div class="jq-r"><div>${L(head)}</div><div class="jq-w">${who(r.first, r.father)}${who(r.candidateFirst, r.candidateFather)}</div>`
        + `<div class="muted small">${L(C.className(esc(r.grade || '')))}</div>`
        + `<form method="post" action="${base}/queue">${ids}${buttons}</form></div>`;
    }).join('');
    const link = `<form class="jq-l" method="post" action="${base}/queue">${hidden('class', listId)}<button type="submit" name="decision" value="link">${L(S.tQLink)}</button></form>`;
    queueHtml = `<section class="card" id="jq"><p class="muted small">${L(S.tQSub)}</p>${qrows}${link}</section>`;
  }

  const main = `<div style="height:16px"></div>${failed}<section class="card"><p class="muted small">${L(S.tSort)}</p><ul class="jl">${rows}</ul></section>
${queueHtml}<section class="card"><p class="muted small">${L(S.tPractice)}</p>${fwd}
<a class="btn btn-ghost" href="${base}${qs([['lang', lang]])}">${L(scope === 'quiz' ? C.backToQuiz : C.allClasses)}</a></section>`;
  return { header, main, css: CSS, title: lang === 'ur' ? `${S.tTab}، ${C.title}` : `${S.tTab} · ${C.title}`, needUrdu: rtl || kids.some((k) => /[؀-ۿ]/.test(k.first)) };
}

/** The tab bar's link to this tab (from the quiz and class tabs), switch on only. */
function tabLink(token, lang, listId = null) {
  return { href: `/r/${encodeURIComponent(token || '')}${qs([['tab', 'jugnu'], ['class', listId], ['lang', lang]])}`, label: (T[lang] || T.en).tTab };
}

module.exports = { T, FWD, renderJugnu, forwardText, queueReady, tabLink, QUEUE_KEYS };
