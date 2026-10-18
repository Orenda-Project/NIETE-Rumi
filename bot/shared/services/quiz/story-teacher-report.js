'use strict';
/**
 * The class report of a storybook a teacher sent (story-teacher.service.js): per child, the pages listened to, the pages
 * read aloud and the questions, from story_events; the class's totals per question kind and its most-skipped words.
 * Called by video-quiz-report.buildAndSend for a quizzes row with quiz_source 'story' (same trigger, same teacher, same
 * stamp). Never the questions table or the guidance writer: a story has neither. No switch: a story send already made
 * keeps its report.
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');

/** The book a story send carries (`meta.story.book_id`), or null. */
function bookOf(quizRow) {
  const st = quizRow && quizRow.meta && quizRow.meta.story;
  return st && st.book_id ? String(st.book_id) : null;
}

/** Per child: the pages listened to, the pages read aloud, the questions (the last try) and whether the book was finished. */
function tally(events) {
  const by = new Map();
  for (const e of events || []) {
    if (!e || !e.child_id) continue;
    const t = by.get(e.child_id) || { listened: new Set(), read: new Set(), questions: null, done: false, qAt: '' };
    // A page with no voice yet is logged as a listen with `miss` (the reader's voicing backlog): nothing was heard.
    if (e.event === 'story_page_listened' && e.page_n != null && !(e.data && e.data.miss)) t.listened.add(Number(e.page_n));
    if (e.event === 'story_page_read' && e.page_n != null) t.read.add(Number(e.page_n));
    if (e.event === 'story_questions_done' && e.data && String(e.at || '') >= t.qAt) {
      t.qAt = String(e.at || '');
      t.questions = { correct: Number(e.data.correct) || 0, total: Number(e.data.total) || 0 };
      t.byKind = e.data.by_kind && typeof e.data.by_kind === 'object' ? e.data.by_kind : null;
    }
    // The words the child skipped on a page read aloud (the live reader's matcher; words only, never audio or a transcript).
    if (e.event === 'story_page_read' && e.data && Array.isArray(e.data.skipped_words)) {
      t.skipped = t.skipped || new Map();
      e.data.skipped_words.slice(0, 50).forEach((w) => {
        const k = String(w || '').trim().slice(0, 40);
        if (k) t.skipped.set(k, (t.skipped.get(k) || 0) + 1);
      });
    }
    if (e.event === 'story_done') t.done = true;
    by.set(e.child_id, t);
  }
  return by;
}

/** Each joined child's line: listened, read aloud, questions. `sessions` = the report's one-attempt-per-child rows. */
async function storyRows({ sessions, bookId, since }) {
  const ids = [...new Set((sessions || []).map((s) => s.student_id).filter(Boolean).map(String))];
  let canon = new Map(ids.map((id) => [id, id]));
  try { canon = await require('./web-quiz-identity-roster').canonicalStudentIds(ids); } catch (_) { /* the ids as typed */ }
  const childIds = [...new Set([...ids, ...canon.values()])];
  let events = [];
  if (childIds.length && bookId) {
    let q = supabase.from('story_events').select('child_id, book_id, page_n, event, data, at').eq('book_id', bookId).in('child_id', childIds);
    if (since) q = q.gte('at', since);
    const { data } = await q;
    events = data || [];
  }
  const t = tally(events);
  const empty = { listened: new Set(), read: new Set(), questions: null, done: false };
  return (sessions || []).map((s) => {
    const raw = s.student_id ? String(s.student_id) : null;
    const mine = (raw && (t.get(canon.get(raw)) || t.get(raw))) || empty;
    return { name: s.student_name || '', listened: mine.listened.size, read: mine.read.size, questions: mine.questions, done: mine.done,
      byKind: mine.byKind || null, skipped: mine.skipped ? [...mine.skipped.entries()] : [] };
  });
}

const KINDS = ['literal', 'inference', 'vocab'];
/** The class's right/total per question kind (`by_kind` on story_questions_done): what a teacher can act on next morning. */
function kindTotals(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.byKind) continue;
    for (const k of KINDS) {
      const v = r.byKind[k];
      if (!Array.isArray(v) || v.length < 2) continue;
      out[k] = out[k] || [0, 0];
      out[k][0] += Number(v[0]) || 0;
      out[k][1] += Number(v[1]) || 0;
    }
  }
  return out;
}

/** The class's three most-skipped words, most children first. */
function topSkipped(rows, n = 3) {
  const by = new Map();
  for (const r of rows) for (const [w] of r.skipped || []) by.set(w, (by.get(w) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map((x) => x[0]);
}

function reportText({ title, rows, lang }) {
  const ux = (key, params) => resolveUx(key, { language: lang, params });
  const n = (k) => rows.filter((r) => (k === 'questions' ? r.questions : r[k] > 0)).length;
  const pages = (k) => ux(k === 1 ? 'storyPage1' : 'storyPagesN', { n: k });
  const lines = rows.map((r) => ux('storyReportLine', {
    name: r.name || ux('storyReportNoName'), listened: pages(r.listened), read: pages(r.read),
    questions: r.questions ? `${r.questions.correct}/${r.questions.total}` : '–',
  }));
  const kinds = kindTotals(rows);
  const kindLines = KINDS.filter((k) => kinds[k] && kinds[k][1] > 0)
    .map((k) => ux(`storyReportKind_${k}`, { right: kinds[k][0], total: kinds[k][1] }));
  const words = topSkipped(rows);
  return ux('storyReportHead', { title, joined: rows.length, listened: n('listened'), read: n('read'), questions: n('questions') })
    + (kindLines.length ? `\n\n${kindLines.join('\n')}` : '')
    + (words.length ? `\n\n${ux('storyReportWords', { words: words.join(lang === 'ur' ? '، ' : ', ') })}` : '')
    + (lines.length ? `\n\n${lines.join('\n')}` : '');
}

/**
 * The story send's report, from video-quiz-report.buildAndSend (same trigger, same teacher, same stamp). Never the
 * questions table or the guidance writer: a story has neither. Nobody joined: a story-worded "nobody opened it yet".
 * `live()` = the report's own web-report section (its link), `funnel` = the report's funnel.
 * `sendChecked(fn)` (report-send-check send): false only when quiz_report_send_checked is on and WhatsApp did not
 * take it; then `notAccepted()` (counts, logs, retries) is the answer and nothing is stamped. Off, or none given:
 * today's send, stamp and order.
 */
async function sendReport({ shareCodeId, sc, teacher, sessions, quizRow, reason, stamp, send, markSent, live, funnel, sendChecked = null, notAccepted = async () => false }) {
  const lang = clampLanguage((quizRow && quizRow.meta && quizRow.meta.story && quizRow.meta.story.lang) || (quizRow && quizRow.language) || (teacher && teacher.preferred_language));
  const title = (sc && sc.topic) || (quizRow && quizRow.topic) || '';
  const all = sessions || [];
  let text;
  let rows = [];
  if (!all.length) {
    text = resolveUx('storyReportNoOne', { language: lang, params: { title } });
  } else {
    rows = await storyRows({ sessions: all, bookId: bookOf(quizRow), since: (quizRow && quizRow.meta && quizRow.meta.first_sent_at) || null });
    const body = reportText({ title, rows, lang });
    // The web report's link, as every report carries it when the teacher's web report is on.
    const extras = live ? await live() : null;
    const url = extras && extras.links ? extras.links.live : null;
    text = url ? `${body}\n\n${resolveUx('vqReportLiveLink', { language: lang, params: { url } })}` : body;
  }
  if (sendChecked) {
    if (!(await sendChecked(() => send(teacher.phone_number, text)))) return notAccepted();
  } else {
    await send(teacher.phone_number, text);
  }
  stamp.stamped = await markSent(shareCodeId, sc.quiz_id);
  logEvent('story_report_sent', { share_code_id: shareCodeId, n: rows.length, read: rows.filter((r) => r.read > 0).length });
  if (funnel) funnel.emit('report_sent', { quiz_id: sc.quiz_id, share_code_id: shareCodeId, source: 'story', kind: all.length ? 'story' : 'no_one', reason, n: all.length });
  return true;
}

// ── the web report (/r/<token>) of a story send ─────────────────────────────────────────────────────────────

const urN = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const PAGE_COPY = {
  en: {
    opened: 'opened it', listened: 'listened', read: 'read aloud', questions: 'answered the questions', children: 'Each child',
    pages: (n) => `${n} ${n === 1 ? 'page' : 'pages'}`, none: 'No child has opened the story yet.', skills: 'What the class can do',
    words: 'Words the class skipped most', kind: { literal: 'Finds facts in the story', inference: 'Works out why', vocab: 'Word meanings' },
  },
  ur: {
    opened: 'بچوں نے کہانی کھولی', listened: 'نے سنی', read: 'نے اونچی آواز میں پڑھی', questions: 'نے سوالوں کے جواب دیے', children: 'ہر بچے کا کام',
    pages: (n) => `${urN(n)} ${n === 1 ? 'صفحہ' : 'صفحے'}`, none: 'ابھی کسی بچے نے کہانی نہیں کھولی۔', skills: 'کلاس کیا کر سکتی ہے',
    words: 'کلاس نے یہ لفظ سب سے زیادہ چھوڑے', kind: { literal: 'کہانی میں لکھی بات ڈھونڈنا', inference: 'وجہ سمجھنا', vocab: 'لفظوں کے معنی' },
  },
};

/**
 * quizReport's answer for a story send: the story part added, no average (a story has no score), and the reminder is
 * the class message itself (the same link and words the class already has), never the quiz reminder.
 */
async function forQuizReport(report, { quiz, sessions, firstOf }) {
  const story = await reportData({ quiz, sessions, firstOf });
  const message = quiz && quiz.meta && typeof quiz.meta.student_message === 'string' ? quiz.meta.student_message : null;
  return {
    ...report, story,
    summary: { ...(report.summary || {}), avg: null, hardestN: null },
    reminder: message ? { language: (report.reminder && report.reminder.language) || clampLanguage(quiz.language), text: message } : report.reminder,
  };
}

/**
 * classReport's counted sessions: a story send's children count once they joined (a story has no finish). Replaces the
 * story sends' rows in `counted` in place; nothing changes when the teacher has no story send.
 */
function countStoryJoins(counted, { quizzes, sessions, quizOfCode, count }) {
  const storyIds = new Set((quizzes || []).filter((q) => q.quiz_source === 'story').map((q) => q.id));
  if (!storyIds.size) return counted;
  const isStory = (s) => storyIds.has(quizOfCode.get(s.share_code_id));
  counted.splice(0, counted.length, ...counted.filter((s) => !isStory(s)), ...count((sessions || []).filter(isStory)));
  return counted;
}

/** The story part of quizReport's answer: per child (first names, as the page shows them), the class's kinds and words. */
async function reportData({ quiz, sessions, firstOf = (s) => String((s && s.student_name) || '').trim().split(/\s+/)[0] || '' }) {
  const rows = await storyRows({ sessions, bookId: bookOf(quiz), since: (quiz && quiz.meta && quiz.meta.first_sent_at) || null });
  const kinds = kindTotals(rows);
  return {
    children: rows.map((r, i) => ({ first: firstOf((sessions || [])[i]), listened: r.listened, read: r.read, questions: r.questions, done: r.done })),
    counts: {
      opened: rows.length, listened: rows.filter((r) => r.listened > 0).length,
      read: rows.filter((r) => r.read > 0).length, questions: rows.filter((r) => r.questions).length,
    },
    kinds: KINDS.filter((k) => kinds[k] && kinds[k][1] > 0).map((k) => ({ kind: k, right: kinds[k][0], total: kinds[k][1] })),
    words: topSkipped(rows),
  };
}

/** The story sections of the teacher's report page (the page's own kit: L wraps chrome, K wraps content). */
function pageSections(story, { lang, L, K, esc }) {
  const ur = clampLanguage(lang) === 'ur';
  const C = PAGE_COPY[ur ? 'ur' : 'en'];
  const d = (n) => (ur ? urN(n) : String(n));
  const sep = ur ? '، ' : ' · ';
  const c = story.counts || {};
  const tile = (n, k) => `<div class="tile"><div class="v num">${d(Number(n) || 0)}</div><div class="k">${L(esc(k))}</div></div>`;
  const tiles = `<div class="tiles tiles-4">${tile(c.opened, C.opened)}${tile(c.listened, C.listened)}${tile(c.read, C.read)}${tile(c.questions, C.questions)}</div>`;
  const q = (r) => (r.questions ? `${d(r.questions.correct)}/${d(r.questions.total)}` : '–');
  const kids = (story.children || []).map((r) => `<li><span class="nm">${K(r.first)}</span><span class="s">🎧 ${L(esc(C.pages(r.listened)))}${sep}🗣️ ${L(esc(C.pages(r.read)))}${sep}⭐ <bdi class="num">${q(r)}</bdi></span></li>`).join('');
  const children = `<section class="card" id="story-children"><h2>${L(esc(C.children))}</h2>${kids ? `<ul class="sc">${kids}</ul>` : `<p class="muted">${L(esc(C.none))}</p>`}</section>`;
  const kinds = (story.kinds || []).map((k) => `<div class="g"><div class="gk">${L(esc(C.kind[k.kind]))}</div><div class="num">${d(k.right)}/${d(k.total)}</div></div>`).join('');
  const words = (story.words || []).length ? `<div class="g"><div class="gk">${L(esc(C.words))}</div>${K(story.words.join(ur ? '، ' : ', '), 'div')}</div>` : '';
  const skills = kinds || words ? `<section class="card" id="story-skills"><h2>${L(esc(C.skills))}</h2>${kinds}${words}</section>` : '';
  return `${tiles}${children}${skills}`;
}

module.exports = { bookOf, tally, storyRows, kindTotals, topSkipped, reportText, sendReport, forQuizReport, countStoryJoins, reportData, pageSections, PAGE_COPY };
