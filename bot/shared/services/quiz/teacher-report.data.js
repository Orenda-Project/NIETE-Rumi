'use strict';
/**
 * The teacher's quiz report — the data behind the web page, its PDF, and the
 * post-completion PDF's "not played yet" section. One module, so the page and
 * the PDFs cannot disagree about who played.
 *
 *   quizReport(teacherId, quizId, { listId })  one quiz: who played, who has
 *       not, every question's difficulty, the stored reteach guidance, and the
 *       reminder for the class group.
 *   classReport(teacherId, { days })           every quiz of the teacher's last
 *       `days`, by grade × subject and by week.
 *
 * COUNTING is the class report's own rule (video-quiz-report buildAndSend): the
 * class codes of the quiz (never an invited friend's code), the teacher's own
 * test runs removed, invited friends removed, then ONE attempt per child chosen
 * per code by attemptRuleFor (a web class keeps each child's first finish).
 * "Played" = that attempt is completed.
 *
 * NOT PLAYED is shown only when the quiz's ONE class is known (`roster.state`):
 *   known      the list the teacher picked on the page or the quiz's own list_id,
 *              else the single list whose grade the quiz's grade or BAND ("3-5")
 *              covers, else (a quiz with no grade) the teacher's only list;
 *   ambiguous  none or several lists fit — the page asks the teacher;
 *   none       the teacher keeps no class list.
 * The teacher's roster is read here whatever the child page's roll-number
 * switch says: the teacher is looking at their own class list.
 *
 * Every read filters on the teacher. Children's names leave this module only
 * as first names with roll numbers, for the teacher's own page.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const Roster = require('./web-quiz-roster');
const { oneAttemptPerChild, attemptRuleFor } = require('./one-attempt-per-child');
const { excludeSelfTests } = require('./teacher-self-test');

const QUIZ_COLS = 'id, teacher_id, topic, subject, grade, language, quiz_source, status, list_id, meta, created_at';
const SESSION_COLS = 'id, quiz_id, share_code_id, student_id, student_name, user_id, status, correct_answers, '
  + 'total_questions_answered, completed_at, created_at, invited_by_student_id, device_ref';
const QUESTION_COLS = 'id, external_id, sort_order, question_text, option_a, option_b, option_c, option_d, correct_option';
const OPTIONS = ['A', 'B', 'C', 'D'];
const WEEKS = 8;
const PKT_OFFSET_MS = 5 * 3600 * 1000;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const gradeNum = (v) => (String(v == null ? '' : v).match(/\d+/) || [''])[0];
// A mirrored list is already named "Grade 4 - A" with section 'A' (82% of prod lists): never "Grade 4 - A-A".
const listLabel = (l) => {
  const name = String(l.class_name || '').trim();
  const section = String(l.section || '').trim();
  if (!section || new RegExp(`(^|[\\s\\-–])${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(name)) return name;
  return [name, section].filter(Boolean).join('-');
};
const pct = (correct, total) => (total > 0 ? Math.round((100 * correct) / total) : 0);
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const LINK_RX = /https?:\/\/\S+/;

/** The teacher's active class lists and children, in web-quiz-roster's shape; null when none. */
async function readRoster(teacherId) {
  const { data: lists, error } = await supabase.from('student_lists')
    .select('id, class_name, section').eq('user_id', teacherId).eq('is_active', true);
  if (error) throw new Error(error.message);
  if (!lists || !lists.length) return null;
  const { data: kids, error: kErr } = await supabase.from('students')
    .select('id, list_id, roll_number, student_name, student_name_urdu')
    .in('list_id', lists.map((l) => l.id)).eq('is_active', true);
  if (kErr) throw new Error(kErr.message);
  return {
    lists: lists.map((l) => ({ id: l.id, label: listLabel(l), grade: gradeNum(l.class_name) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    kids: kids || [],
  };
}

/**
 * The grades a quiz's grade covers: "3" → [3], "3-5" / "3 – 5" → [3,4,5] (38% of
 * quizzes carry a band), "" → []. Band-aware on purpose: the first digit alone
 * would read "3-5" as grade 3.
 */
function gradesOf(v) {
  const nums = (String(v == null ? '' : v).match(/\d+/g) || []).map(Number);
  if (!nums.length) return [];
  if (nums.length >= 2 && /\d\s*[-–—]\s*\d/.test(String(v)) && nums[1] >= nums[0] && nums[1] - nums[0] <= 12) {
    return Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i);
  }
  return [nums[0]];
}

/**
 * The ONE class of this quiz, as `roster` for the page. In order: the list the
 * teacher picked on the page or the quiz's own list_id (when it is theirs); else
 * the single list whose grade the quiz's grade (or band) covers; else, for a quiz
 * with no grade, the teacher's only list. Anything else is `ambiguous` and the
 * teacher picks — never "the teacher's only list" when its grade contradicts the
 * quiz's (a grade-5 quiz is not the grade-3 class).
 */
function classOf(roster, quiz, listId) {
  if (!roster) return { roster: { state: 'none', className: null, of: null, lists: [] }, one: null };
  const lists = roster.lists.map((l) => ({ id: l.id, label: l.label }));
  const mine = (id) => (id ? roster.lists.find((l) => l.id === id) || null : null);
  const grades = gradesOf(quiz.grade);
  let list = mine(listId) || mine(quiz.list_id);
  if (!list) {
    if (grades.length) {
      const fit = roster.lists.filter((l) => l.grade && grades.includes(Number(l.grade)));
      list = fit.length === 1 ? fit[0] : null;
    } else if (roster.lists.length === 1) {
      list = roster.lists[0];
    }
  }
  if (!list) return { roster: { state: 'ambiguous', className: null, of: null, lists }, one: null };
  const one = Roster.onlyList(roster, list);
  return { roster: { state: 'known', className: list.label, of: one.kids.length, lists }, one };
}

/** The sessions that count, per class code (the class report's rule). */
function countedSessions(rows, teacherId) {
  const byCode = new Map();
  excludeSelfTests(rows, teacherId)
    .filter((s) => !s.invited_by_student_id)
    .forEach((s) => { const k = s.share_code_id; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(s); });
  const out = [];
  byCode.forEach((list) => out.push(...oneAttemptPerChild(list, { rule: attemptRuleFor(list) })));
  return out.filter((s) => s.status === 'completed');
}

/** One counted session per child across a quiz's codes: the earliest finish. Rows without a student pass through. */
function onePerChildAcrossCodes(sessions) {
  const seen = new Set();
  return sessions.slice().sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')))
    .filter((s) => {
      if (!s.student_id) return true;
      if (seen.has(s.student_id)) return false;
      seen.add(s.student_id);
      return true;
    });
}

async function classCodes(teacherId, quizIds) {
  if (!quizIds.length) return [];
  const { data, error } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, created_at')
    .in('quiz_id', quizIds).eq('teacher_user_id', teacherId).is('invited_by_student_id', null);
  if (error) throw new Error(error.message);
  return data || [];
}

async function sessionsFor(codeIds) {
  if (!codeIds.length) return [];
  const { data, error } = await supabase.from('quiz_sessions').select(SESSION_COLS).in('share_code_id', codeIds);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * The message the teacher forwards into the class group: the quiz is still
 * open, here is the link. It names no child. Gender-neutral in both languages.
 */
function reminderText({ topic, link, language, played = null, of = null, className = null }) {
  const t = String(topic || '').trim();
  const lang = clampLanguage(language);
  // Social proof when the class is known: "12 of 31 in 5-A have played" — a count, never a name.
  if (t && className && Number.isFinite(of) && of > 0 && Number.isFinite(played)) {
    return resolveUx('trReminderCount', { language: lang, params: { topic: t, link, played, of, cls: className } });
  }
  return resolveUx(t ? 'trReminder' : 'trReminderNoTopic', { language: lang, params: { topic: t, link } });
}

/** Every question with how many counted children got it right, and the most-chosen wrong answer. */
async function questionStats(quizId, counted) {
  const { data: qs, error } = await supabase.from('quiz_questions').select(QUESTION_COLS)
    .eq('quiz_id', quizId).order('external_id', { ascending: true }).order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const ids = counted.map((s) => s.id);
  let answers = [];
  if (ids.length) {
    const { data, error: aErr } = await supabase.from('quiz_answers')
      .select('session_id, question_id, is_correct, selected_option').in('session_id', ids);
    if (aErr) throw new Error(aErr.message);
    answers = data || [];
  }
  return (qs || []).map((q, i) => {
    const mine = answers.filter((a) => a.question_id === q.id);
    const right = mine.filter((a) => a.is_correct === true).length;
    const wrongs = new Map();
    mine.filter((a) => a.is_correct === false && a.selected_option).forEach((a) => {
      const o = String(a.selected_option).toUpperCase();
      wrongs.set(o, (wrongs.get(o) || 0) + 1);
    });
    const wrongN = mine.length - right;
    const top = [...wrongs.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      n: i + 1,
      text: q.question_text || '',
      answered: mine.length,
      correctPct: mine.length ? pct(right, mine.length) : null,
      wrongTop: top && OPTIONS.includes(top[0])
        ? { option: top[0], text: q[`option_${top[0].toLowerCase()}`] || '', pct: pct(top[1], wrongN) }
        : null,
    };
  });
}

/**
 * WHO is in this quiz's class, from identity v2 (web-quiz-identity-roster
 * nonAttempters): the hand-out's bound class, its deduplicated roster with list
 * numbers, typed children who are not on it (provisional), and the opaque class
 * keys /who/class takes. Null when v2 cannot answer (no class tables, no class
 * for this teacher, a read error) — the teacher's class lists answer instead.
 */
async function fromIdentity(code, quizId) {
  if (!code) return null;
  let na = null;
  try {
    na = await require('./web-quiz-identity-roster').nonAttempters({ shareCodeId: code.id });
  } catch (err) {
    logToFile('⚠️ teacher report: identity v2 unavailable — class lists instead', { quizId, error: err.message });
    return null;
  }
  if (!na || !na.class || na.class.state === 'none') return null;
  const known = na.class.state === 'known';
  const bySession = new Map((na.played || []).filter((p) => p.onList).map((p) => [p.sessionId, p]));
  const byStudent = new Map((na.played || []).filter((p) => p.onList).map((p) => [p.studentId, p]));
  return {
    roster: {
      state: known ? 'known' : 'ambiguous',
      className: known ? na.class.label || null : null,
      of: known ? na.class.of : null,
      lists: (na.class.classes || []).map((c) => ({ key: c.key, label: c.label })),
    },
    listed: (s) => bySession.get(s.id) || (s.student_id ? byStudent.get(s.student_id) : null) || null,
    notPlayed: known && na.notPlayed
      ? na.notPlayed.map((k) => ({ studentId: k.studentId, first: k.first, roll: k.number != null ? Number(k.number) : null }))
      : null,
    provisional: known ? groupProvisional(na.provisional || []) : [],
  };
}

/** A typed name's grouping key: identity v2's canonical form (case, spaces, script folded). */
function typedKey(name) {
  try { return require('./web-quiz-identity').canon(name || '') || ''; } catch { return String(name || '').trim().toLowerCase(); }
}

/** Provisional rows of one typed name collapse to the FIRST finish, with how many times it was typed. */
function groupProvisional(rows) {
  const byName = new Map();
  rows.slice().sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || ''))).forEach((r) => {
    const k = typedKey(r.typed) || r.sessionId;
    const first = byName.get(k);
    if (first) first.repeats += 1;
    else byName.set(k, { ...r, repeats: 1 });
  });
  return [...byName.values()];
}

/** The same answer from the teacher's legacy class lists (student_lists), for a teacher identity v2 cannot place. */
async function fromLists(teacherId, quiz, listId, counted, lang) {
  let roster = null;
  try { roster = await readRoster(teacherId); } catch (err) {
    logToFile('⚠️ teacher report: class list read failed — no not-played list', { quizId: quiz.id, error: err.message });
  }
  const { roster: view, one } = classOf(roster, quiz, listId);
  const kidOf = new Map(((roster && roster.kids) || []).map((k) => [k.id, k]));
  const inClass = (k) => Boolean(one && one.kids.some((x) => x.id === k.id));
  const done = new Set(counted.map((s) => s.student_id).filter(Boolean));
  return {
    roster: view,
    listed: (s) => {
      const k = s.student_id ? kidOf.get(s.student_id) : null;
      return k && inClass(k) ? { first: firstName(Roster.displayName(k, lang)), number: k.roll_number } : null;
    },
    notPlayed: one
      ? one.kids.filter((k) => !done.has(k.id))
        .map((k) => ({ studentId: k.id, first: firstName(Roster.displayName(k, lang)), roll: k.roll_number != null ? Number(k.roll_number) : null }))
        .sort((a, b) => ((a.roll || 999) - (b.roll || 999)) || a.first.localeCompare(b.first))
      : null,
    provisional: [],
  };
}

/**
 * @param {string} teacherId  from the verified token, never from the request
 * @param {string} quizId
 * @param {{listId?: string|null}} [opts] the class the teacher picked on the page
 * @returns {Promise<object|null>} null when the quiz is not this teacher's
 */
async function quizReport(teacherId, quizId, { listId = null } = {}) {
  if (!teacherId || !quizId) return null;
  const { data: quiz, error } = await supabase.from('quizzes').select(QUIZ_COLS)
    .eq('id', quizId).eq('teacher_id', teacherId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!quiz) return null;
  const meta = quiz.meta || {};

  const codes = await classCodes(teacherId, [quiz.id]);
  // Per class code first (the class report's rule), then ONE row per child across the
  // quiz's codes: this page is one quiz, so a child who played on two hand-outs is
  // one child — the earlier finish counts.
  const counted = onePerChildAcrossCodes(countedSessions(await sessionsFor(codes.map((c) => c.id)), teacherId));

  const lang = clampLanguage(quiz.language);
  const primary = codes.find((c) => c.id === meta.share_code_id) || codes[0] || null;
  // Identity v2 answers first. A legacy class list the teacher picked on the page,
  // or the quiz's own list_id, still decides when v2 does not KNOW the class
  // (a list with no class behind it: legacy-only teachers).
  let who = await fromIdentity(primary, quizId);
  if (!who || (who.roster.state !== 'known' && (listId || quiz.list_id))) {
    who = await fromLists(teacherId, quiz, listId, counted, lang);
  }

  // A child not on the list who typed the same name on this quiz more than once (a fresh
  // phone, "I don't know" twice) is ONE child: the first finish counts, like any child.
  const sameTyped = new Map();
  const counting = counted.slice().sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')))
    .filter((s) => {
      if (who.listed(s)) return true;
      const k = typedKey(s.student_name);
      if (!k) return true;
      if (sameTyped.has(k)) return false;
      sameTyped.set(k, s.id);
      return true;
    });
  const played = counting.map((s) => {
    const listed = who.listed(s);
    const correct = s.correct_answers || 0;
    const total = s.total_questions_answered || 0;
    return {
      first: listed ? listed.first : firstName(s.student_name),
      roll: listed && listed.number != null ? Number(listed.number) : null,
      onList: Boolean(listed),
      correct, total, pct: pct(correct, total),
    };
  }).sort((a, b) => (b.pct - a.pct) || ((a.roll || 999) - (b.roll || 999)) || a.first.localeCompare(b.first));
  const { roster: rosterView, notPlayed, provisional } = who;

  const questions = await questionStats(quiz.id, counting);
  const hardest = questions.filter((q) => q.answered > 1 && q.correctPct < 100)
    .sort((a, b) => a.correctPct - b.correctPct || a.n - b.n)[0];
  const code = (codes.find((c) => c.id === meta.share_code_id) || codes[0] || {}).code || null;
  // The children's link: the one the hand-out forwarded; else (a hand-out whose message
  // carries none) the quiz's own class code on the web page, when the web quiz is on.
  let link = ((meta.student_message || '').match(LINK_RX) || [null])[0];
  if (!link && code) {
    try {
      const WQL = require('./web-quiz-link');
      if (await WQL.webQuizOn(teacherId)) link = `${WQL.webBaseUrl()}/q/${code}`;
    } catch (err) {
      logToFile('⚠️ teacher report: no fallback quiz link', { quizId, error: err.message });
    }
  }

  return {
    quiz: {
      id: quiz.id, topic: quiz.topic || '', subject: quiz.subject || null, grade: quiz.grade || null,
      source: quiz.quiz_source, language: lang, date: meta.lesson_date || quiz.created_at, code, link,
    },
    roster: rosterView,
    summary: {
      played: played.length,
      // The class tile pairs the children ON the class list with the class size; typed
      // children who are not on it are counted apart (never "76 of 10 played").
      onList: rosterView.state === 'known' ? played.filter((p) => p.onList).length : null,
      of: rosterView.of,
      avg: mean(played.map((p) => p.pct)),
      total: questions.length || Math.max(0, ...played.map((p) => p.total)),
      hardestN: hardest ? hardest.n : null,
    },
    played,
    notPlayed,
    provisional,
    questions,
    guidance: meta.report_guidance && typeof meta.report_guidance === 'object' ? meta.report_guidance : null,
    reminder: link ? {
      language: lang,
      text: reminderText({
        topic: quiz.topic, link, language: lang,
        ...(rosterView.state === 'known' ? { played: played.filter((p) => p.onList).length, of: rosterView.of, className: rosterView.className } : {}),
      }),
    } : null,
  };
}

/** Monday 00:00 PKT of the week `iso` falls in, as YYYY-MM-DD. */
function weekStart(iso) {
  const d = new Date(new Date(iso).getTime() + PKT_OFFSET_MS);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} teacherId
 * @param {{days?: number, now?: number}} [opts]
 */
async function classReport(teacherId, { days = 60, now = Date.now() } = {}) {
  if (!teacherId) return null;
  const since = new Date(now - days * 86400000).toISOString();
  const { data: quizzes, error } = await supabase.from('quizzes').select(QUIZ_COLS)
    .eq('teacher_id', teacherId).in('status', ['sent', 'report_sent']).gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const qs = quizzes || [];
  const codes = await classCodes(teacherId, qs.map((q) => q.id));
  const quizOfCode = new Map(codes.map((c) => [c.id, c.quiz_id]));
  const counted = countedSessions(await sessionsFor(codes.map((c) => c.id)), teacherId);
  const byQuiz = new Map();
  counted.forEach((s) => {
    const q = quizOfCode.get(s.share_code_id);
    if (!byQuiz.has(q)) byQuiz.set(q, []);
    byQuiz.get(q).push(pct(s.correct_answers || 0, s.total_questions_answered || 0));
  });

  let roster = null;
  try { roster = await readRoster(teacherId); } catch (err) {
    logToFile('⚠️ teacher report: class list read failed — no class sizes', { error: err.message });
  }
  const rows = qs.map((q) => {
    const scores = byQuiz.get(q.id) || [];
    return {
      of: classOf(roster, q, null).roster.of,
      id: q.id, date: (q.meta && q.meta.lesson_date) || q.created_at, topic: q.topic || '', grade: gradeNum(q.grade) || null,
      subject: q.subject || null, source: q.quiz_source, played: scores.length, avg: mean(scores), scores,
    };
  });

  const cellMap = new Map();
  const weekMap = new Map();
  rows.forEach((r) => {
    const ck = `${r.grade || ''}|${r.subject || ''}`;
    if (!cellMap.has(ck)) cellMap.set(ck, { grade: r.grade, subject: r.subject, quizzes: 0, played: 0, scores: [] });
    const c = cellMap.get(ck);
    c.quizzes += 1; c.played += r.played; c.scores.push(...r.scores);
    const wk = weekStart(r.date);
    if (!weekMap.has(wk)) weekMap.set(wk, { weekStart: wk, quizzes: 0, played: 0, scores: [] });
    const w = weekMap.get(wk);
    w.quizzes += 1; w.played += r.played; w.scores.push(...r.scores);
  });
  const strip = ({ scores, ...rest }) => ({ ...rest, avg: mean(scores) });
  return {
    cells: [...cellMap.values()].map(strip)
      .sort((a, b) => String(a.grade).localeCompare(String(b.grade), undefined, { numeric: true }) || String(a.subject).localeCompare(String(b.subject))),
    weeks: [...weekMap.values()].map(strip).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-WEEKS),
    quizzes: rows.map(({ scores, ...rest }) => rest),
  };
}

module.exports = { quizReport, classReport, reminderText, weekStart, gradesOf, listLabel };
