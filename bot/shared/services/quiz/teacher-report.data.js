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
 *
 * A quiz the teacher SENT but did not make (switch `quiz_teacher_home`): a
 * library quiz from the teacher home — the video bank's, or another teacher's —
 * whose class code is this teacher's while `quizzes.teacher_id` is not. Its
 * report is the sender's: their own class codes only (never the author's
 * class), their own code's link and send date, and none of the author's
 * per-class guidance. The author's report is unchanged (it reads only the
 * author's codes). Off: such a quiz is "not this teacher's", as today.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const Roster = require('./web-quiz-roster');
const { oneAttemptPerChild, attemptRuleFor } = require('./one-attempt-per-child');
const { excludeSelfTests } = require('./teacher-self-test');
const { v21On } = require('./quiz-v21-flag');
const V21 = require('./teacher-report-v21');
const SloCode = require('./quiz-slo-code');
const FoldFlag = require('./report-fold-flag');
const { inChunks } = require('./web-quiz-in-chunks');

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
// `opened`: a storybook send's sessions count once the child has joined (a story has no finish to wait for).
function countedSessions(rows, teacherId, { opened = false } = {}) {
  const byCode = new Map();
  excludeSelfTests(rows, teacherId)
    .filter((s) => !s.invited_by_student_id)
    .forEach((s) => { const k = s.share_code_id; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(s); });
  const out = [];
  byCode.forEach((list) => out.push(...oneAttemptPerChild(list, { rule: attemptRuleFor(list) })));
  return out.filter((s) => s.status === 'completed' || (opened && s.status === 'in_progress'));
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

// The watch root (app_settings VALUE web_quiz_watch_root): the code a class-less child's video codes hang under. Those
// codes copy the root's teacher but are not that teacher's class; a class child's own lesson code (parent = the class's
// code) is. → the root's id, or null (absent, not an id, or unreadable: nothing is left out). 30 s cache.
const WATCH_ROOT_KEY = 'web_quiz_watch_root';
const ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let watchRootCache = null; // { at, id }
async function watchRootId(now = Date.now()) {
  if (watchRootCache && now - watchRootCache.at < 30 * 1000) return watchRootCache.id;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', WATCH_ROOT_KEY).maybeSingle();
    if (error) throw new Error(error.message);
    let v = data && data.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
    if (typeof v === 'string') v = v.trim().toLowerCase();   // one spelling, as the other watch-root readers parse it
    watchRootCache = { at: now, id: typeof v === 'string' && ID_RX.test(v) ? v : null };
    return watchRootCache.id;
  } catch (err) {
    logToFile('⚠️ teacher report: watch root unreadable — no code left out', { error: err.message });
    return null;
  }
}
// a code query without the watch root's children (a NULL parent is kept: `neq` alone would drop it)
const notUnderWatchRoot = (q, root) => (root ? q.or(`parent_share_code_id.is.null,parent_share_code_id.neq.${root}`) : q);

// sends: a sender's list — without the watch root's children (they copy its teacher)
async function classCodes(teacherId, quizIds, { sends = false } = {}) {
  if (!quizIds.length) return [];
  let q = supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, created_at')
    .in('quiz_id', quizIds).eq('teacher_user_id', teacherId).is('invited_by_student_id', null);
  if (sends) q = notUnderWatchRoot(q, await watchRootId());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function sessionsFor(codeIds) {
  if (!codeIds.length) return [];
  const { data, error } = await supabase.from('quiz_sessions').select(SESSION_COLS).in('share_code_id', codeIds);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Is a library quiz's report its sender's (quiz_teacher_home)? Off, absent or unreadable: no. */
async function sentQuizzesOn() {
  try {
    return await require('../first-touch/teacher-home.flags').on();
  } catch (err) {
    logToFile('⚠️ teacher report: teacher home switch unreadable — sent quizzes off', { error: err.message });
    return false;
  }
}

const newestFirst = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
const CODES_MAX = 1000; // PostgREST's default row cap, made explicit
const IN_CHUNK = 300; // well under the ~390 ids where a PostgREST .in() overflows its header cap

/**
 * A quiz this teacher sent but did not make, as its row plus `sent_at` (their newest class code's
 * creation); null when the switch is off, the quiz is the teacher's own, or they hold no class code on it.
 */
async function sentQuiz(teacherId, quizId) {
  if (!teacherId || !quizId || !(await sentQuizzesOn())) return null;
  const codes = await classCodes(teacherId, [quizId], { sends: true });
  if (!codes.length) return null;
  const { data, error } = await supabase.from('quizzes').select(QUIZ_COLS).eq('id', quizId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.teacher_id === teacherId) return null;
  return { ...data, list_id: null, sent_at: codes.slice().sort(newestFirst)[0].created_at };
}

/**
 * Every quiz this teacher sent but did not make (class codes created since `since`), each with `sent_at`
 * (the newest of those codes), newest send first. A code the teacher home minted only to SHOW its message
 * (teacher-home.sent "prepared", cleared by the send tap) is not a send. [] when the switch is off.
 */
async function sentQuizzes(teacherId, { since = null } = {}) {
  if (!teacherId || !(await sentQuizzesOn())) return [];
  let q = notUnderWatchRoot(supabase.from('quiz_share_codes').select('id, quiz_id, created_at')
    .eq('teacher_user_id', teacherId).is('invited_by_student_id', null), await watchRootId());
  if (since) q = q.gte('created_at', since);
  // Newest first and bounded: a capped read drops only the oldest codes, never a random few.
  const { data: codes, error } = await q.order('created_at', { ascending: false }).limit(CODES_MAX);
  if (error) throw new Error(error.message);
  const ids = [...new Set((codes || []).map((c) => c.quiz_id))];
  // Who made each quiz first (two columns); the full rows only for the ones the teacher did not make.
  const notMine = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error: qErr } = await supabase.from('quizzes').select('id, teacher_id').in('id', ids.slice(i, i + IN_CHUNK));
    if (qErr) throw new Error(qErr.message);
    // The teacher's own quizzes are read by teacher_id as always; a NULL author (the bank) is not theirs.
    notMine.push(...(data || []).filter((r) => r.teacher_id !== teacherId).map((r) => r.id));
  }
  if (!notMine.length) return [];
  const theirs = [];
  for (let i = 0; i < notMine.length; i += IN_CHUNK) {
    const { data, error: qErr } = await supabase.from('quizzes').select(QUIZ_COLS).in('id', notMine.slice(i, i + IN_CHUNK));
    if (qErr) throw new Error(qErr.message);
    theirs.push(...(data || []).filter((r) => r.teacher_id !== teacherId));
  }
  if (!theirs.length) return [];
  const sentCodes = await notPrepared((codes || []).filter((c) => theirs.some((r) => r.id === c.quiz_id)));
  const sentAt = new Map();
  sentCodes.forEach((c) => {
    if (!sentAt.has(c.quiz_id) || String(c.created_at || '') > String(sentAt.get(c.quiz_id) || '')) sentAt.set(c.quiz_id, c.created_at);
  });
  return theirs.filter((r) => sentAt.has(r.id)).map((r) => ({ ...r, list_id: null, sent_at: sentAt.get(r.id) }))
    .sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')));
}

/** The codes the teacher really sent: without the home's "prepared" ones (none known → all of them). */
async function notPrepared(codes) {
  if (!codes.length) return codes;
  let Sent = null;
  try { Sent = require('../first-touch/teacher-home.sent'); } catch (_) { return codes; }
  const prepared = await Sent.prepared(codes.map((c) => c.id));
  return codes.filter((c) => !prepared.has(c.id));
}

/** A sent-quiz read that fails is today's answer (not found / none), never a failed report page. */
async function softly(read, fallback, ctx = {}) {
  try {
    return await read();
  } catch (err) {
    logToFile('⚠️ teacher report: sent-quiz read failed — today\'s report', { ...ctx, error: err.message });
    return fallback;
  }
}

/** The children's link for the sender's own code: the web page when it is on for them, else today's chat join link. */
async function sentLink(teacherId, code) {
  try {
    const WQL = require('./web-quiz-link');
    if (await WQL.webQuizOn(teacherId)) return `${WQL.webBaseUrl()}/q/${code}`;
    // The chat join link exactly as video-quiz-share sendClassLink builds it (its botNumber: the same env, no
    // fallback number). Read here, not required: that module reaches back to this one through the report job.
    const bot = String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
    return bot ? `https://wa.me/${bot}?text=QUIZ-${code}` : null;
  } catch (err) {
    logToFile('⚠️ teacher report: no link for a sent quiz', { error: err.message });
    return null;
  }
}

/**
 * The message the teacher forwards into the class group: the quiz is still
 * open, here is the link. It names no child. Gender-neutral in both languages.
 */
function reminderText({ topic, link, language, played = null, of = null, className = null }) {
  const t = String(topic || '').trim();
  const lang = clampLanguage(language);
  // Social proof when the class is known and someone on it has played: "12 of 31 in 5-A have
  // played" — a count, never a name. At zero it would be an anti-signal: the plain reminder.
  if (t && className && Number.isFinite(of) && of > 0 && Number.isFinite(played) && played > 0) {
    return resolveUx('trReminderCount', { language: lang, params: { topic: t, link, played, of, cls: className } });
  }
  return resolveUx(t ? 'trReminder' : 'trReminderNoTopic', { language: lang, params: { topic: t, link } });
}

/** Every question with how many counted children got it right, and the most-chosen wrong answer. */
async function questionStats(quizId, counted, { codeOf = null } = {}) {
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
    const code = codeOf ? codeOf(q.external_id) : null;
    return {
      n: i + 1,
      text: q.question_text || '',
      ...(code ? { code } : {}),
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
async function fromIdentity(code, quizId, { foldOn = false } = {}) {
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
    // with quiz_report_fold_by_child on, quizReport folds these with the played rows' facts (one read for both)
    provisional: known ? (foldOn ? null : groupProvisional(na.provisional || [])) : [],
    provisionalRaw: known && foldOn ? na.provisional || [] : [],
  };
}

/** The provisional list by child (quiz_report_fold_by_child on, facts read), else by typed name (today). */
function provisionalRows(rows, facts) {
  if (!facts) return groupProvisional(rows);
  const sorted = rows.slice().sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || '')));
  return foldByChild(sorted, { idOf: (r) => r.studentId, nameOf: (r) => r.typed, facts })
    .map((c) => ({ ...c.first, repeats: c.n }));
}

/**
 * quiz_report_fold_by_child: for off-list records, who each one is (`merged_into ?? id`) and the phones it is bound
 * to (child_phone_bindings.phone_tomb, revoked or not: a phone the child used) — its own and its merged-into record's.
 * → Map id → { who, phones }, or null when either read fails (the caller then folds by typed name, as today).
 * `merged_into` is followed ONE step (A → B); a chain A → B → C is not resolved further (the merge path writes the
 * surviving record directly, so a chain is not expected).
 */
async function childFacts(ids, quizId) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map();
  if (!uniq.length) return out;
  try {
    const kids = await inChunks(() => supabase.from('students').select('id, merged_into'), 'id', uniq);
    const whoOf = new Map(uniq.map((id) => [id, id]));
    kids.forEach((k) => { if (whoOf.has(String(k.id)) && k.merged_into) whoOf.set(String(k.id), String(k.merged_into)); });
    const lookup = [...new Set([...uniq, ...whoOf.values()])];
    const binds = await inChunks(() => supabase.from('child_phone_bindings').select('canonical_id, phone_tomb'), 'canonical_id', lookup);
    const phonesOf = new Map();
    binds.forEach((b) => {
      if (!b.phone_tomb) return;
      const k = String(b.canonical_id);
      if (!phonesOf.has(k)) phonesOf.set(k, new Set());
      phonesOf.get(k).add(String(b.phone_tomb));
    });
    uniq.forEach((id) => {
      const who = whoOf.get(id);
      out.set(id, { who, phones: new Set([...(phonesOf.get(id) || []), ...(phonesOf.get(who) || [])]) });
    });
    return out;
  } catch (err) {
    logToFile('⚠️ teacher report: child facts unreadable — same-name rows fold as before', { quizId, error: err.message });
    return null;
  }
}

/**
 * Off-list records (earliest finish first) → one cluster per child: { first, n }. A record joins the first cluster
 * that is the same child (`who`), or has its typed name and shares a phone with it, or where either side has no
 * binding (a fresh browser cannot be told apart). The same typed name on two different phones starts a new cluster.
 */
function foldByChild(records, { idOf, nameOf, facts }) {
  const clusters = [];
  records.forEach((r) => {
    const id = idOf(r) ? String(idOf(r)) : null;
    const f = (id && facts.get(id)) || { who: id, phones: new Set() };
    const name = typedKey(nameOf(r));
    const sharesPhone = (c) => f.phones.size === 0 || c.phones.size === 0 || [...f.phones].some((ph) => c.phones.has(ph));
    const c = clusters.find((x) => (f.who && x.whos.has(f.who)) || (name && x.name === name && sharesPhone(x)));
    if (c) {
      c.n += 1;
      if (f.who) c.whos.add(f.who);
      f.phones.forEach((ph) => c.phones.add(ph));
    } else {
      clusters.push({ first: r, n: 1, name, whos: new Set(f.who ? [f.who] : []), phones: new Set(f.phones) });
    }
  });
  return clusters;
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
 * WHO is in this quiz's class. Identity v2 answers first. A legacy class list the teacher picked on the page,
 * or the quiz's own list_id, still decides when v2 does not KNOW the class (a list with no class behind it:
 * legacy-only teachers).
 */
async function whoFor(teacherId, quiz, primary, listId, counted, lang, { foldOn = false } = {}) {
  const who = await fromIdentity(primary, quiz.id, { foldOn });
  if (!who || (who.roster.state !== 'known' && (listId || quiz.list_id))) {
    return fromLists(teacherId, quiz, listId, counted, lang);
  }
  return who;
}

/**
 * A child not on the list who typed the same name on this quiz more than once (a fresh
 * phone, "I don't know" twice) is ONE child: the first finish counts, like any child.
 * With quiz_report_fold_by_child on, ONE child is the same child (merged_into ?? student_id) or the same typed name
 * on a shared phone / no binding; the same name on two different phones is two children.
 * → { counting, provisionalRaw, facts } (the last two feed the provisional list when the switch is on).
 */
async function onePerChildOffList(counted, who, quizId, foldOn) {
  const byFinish = counted.slice().sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')));
  const offList = foldOn ? byFinish.filter((s) => !who.listed(s)) : [];
  const provisionalRaw = foldOn ? who.provisionalRaw || [] : [];
  const facts = foldOn ? await childFacts([...offList.map((s) => s.student_id), ...provisionalRaw.map((r) => r.studentId)], quizId) : null;
  const kept = facts ? new Set(foldByChild(offList, { idOf: (s) => s.student_id, nameOf: (s) => s.student_name, facts }).map((c) => c.first)) : null;
  const sameTyped = new Map();
  const counting = byFinish
    .filter((s) => {
      if (kept) return who.listed(s) || kept.has(s);
      if (who.listed(s)) return true;
      const k = typedKey(s.student_name);
      if (!k) return true;
      if (sameTyped.has(k)) return false;
      sameTyped.set(k, s.id);
      return true;
    });
  return { counting, provisionalRaw, facts };
}

/**
 * The children of ONE storybook class code, counted as the web report's story section counts them (quizReport):
 * joined children, no teacher's own try, no invited friend, one attempt per child, one row per child off the
 * class list (by typed name, or by child with quiz_report_fold_by_child on). For the 12 h WhatsApp report of that
 * code, so both reports of one send name the same children.
 * `rawSessions` = the code's session rows, before any counting.
 */
async function storySendChildren(teacherId, quizId, shareCodeId, rawSessions) {
  const counted = onePerChildAcrossCodes(countedSessions(rawSessions, teacherId, { opened: true }));
  const { data: quiz, error } = await supabase.from('quizzes').select(QUIZ_COLS).eq('id', quizId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!quiz) return counted;
  const foldOn = await FoldFlag.on();
  const who = await whoFor(teacherId, quiz, { id: shareCodeId }, null, counted, clampLanguage(quiz.language), { foldOn });
  return (await onePerChildOffList(counted, who, quiz.id, foldOn)).counting;
}

/**
 * @param {string} teacherId  from the verified token, never from the request
 * @param {string} quizId
 * @param {{listId?: string|null}} [opts] the class the teacher picked on the page
 * @returns {Promise<object|null>} null when the quiz is not this teacher's
 */
async function quizReport(teacherId, quizId, { listId = null } = {}) {
  if (!teacherId || !quizId) return null;
  const { data: own, error } = await supabase.from('quizzes').select(QUIZ_COLS)
    .eq('id', quizId).eq('teacher_id', teacherId).maybeSingle();
  if (error) throw new Error(error.message);
  // A library quiz this teacher sent (quiz_teacher_home): their own codes, link and date; the author's
  // forwarded message, lesson date, class list and per-class guidance are not theirs.
  const sent = own ? null : await softly(() => sentQuiz(teacherId, quizId), null, { quizId });
  const quiz = own || sent;
  if (!quiz) return null;
  const meta = quiz.meta || {};
  const handout = sent ? {} : meta;

  const codes = await classCodes(teacherId, [quiz.id]);
  // Per class code first (the class report's rule), then ONE row per child across the
  // quiz's codes: this page is one quiz, so a child who played on two hand-outs is
  // one child — the earlier finish counts.
  const rawSessions = await sessionsFor(codes.map((c) => c.id));
  const counted = onePerChildAcrossCodes(countedSessions(rawSessions, teacherId, { opened: quiz.quiz_source === 'story' }));
  // bd-v0toag.9/.10, behind quiz_slo_retest_enabled: tries per child, completion, SLO codes.
  const v21 = await v21On();
  const tries = v21 ? V21.attemptCounts(rawSessions, teacherId) : null;

  const lang = clampLanguage(quiz.language);
  const primary = sent ? codes.slice().sort(newestFirst)[0] || null
    : codes.find((c) => c.id === meta.share_code_id) || codes[0] || null;
  const foldOn = await FoldFlag.on();
  const who = await whoFor(teacherId, quiz, primary, listId, counted, lang, { foldOn });
  const { counting, provisionalRaw, facts } = await onePerChildOffList(counted, who, quiz.id, foldOn);
  const played = counting.map((s) => {
    const listed = who.listed(s);
    const correct = s.correct_answers || 0;
    const total = s.total_questions_answered || 0;
    return {
      first: listed ? listed.first : firstName(s.student_name),
      roll: listed && listed.number != null ? Number(listed.number) : null,
      onList: Boolean(listed),
      correct, total, pct: pct(correct, total),
      ...(tries ? { attempts: tries.get(V21.childKey(s)) || 1 } : {}),
    };
  }).sort((a, b) => (b.pct - a.pct) || ((a.roll || 999) - (b.roll || 999)) || a.first.localeCompare(b.first));
  const { roster: rosterView, notPlayed } = who;
  const provisional = who.provisional !== null && who.provisional !== undefined ? who.provisional : provisionalRows(provisionalRaw, facts);

  const questions = await questionStats(quiz.id, counting, v21 ? { codeOf: (ext) => SloCode.codeOf(meta, ext) } : {});
  const hardest = questions.filter((q) => q.answered > 1 && q.correctPct < 100)
    .sort((a, b) => a.correctPct - b.correctPct || a.n - b.n)[0];
  const code = sent ? (primary && primary.code) || null
    : (codes.find((c) => c.id === meta.share_code_id) || codes[0] || {}).code || null;
  // The children's link: the one the hand-out forwarded; else (a hand-out whose message
  // carries none) the quiz's own class code on the web page, when the web quiz is on.
  let link = ((handout.student_message || '').match(LINK_RX) || [null])[0];
  if (sent && code) link = await sentLink(teacherId, code);
  if (!link && code && !sent) {
    try {
      const WQL = require('./web-quiz-link');
      if (await WQL.webQuizOn(teacherId)) link = `${WQL.webBaseUrl()}/q/${code}`;
    } catch (err) {
      logToFile('⚠️ teacher report: no fallback quiz link', { quizId, error: err.message });
    }
  }

  const report = {
    quiz: {
      id: quiz.id, topic: quiz.topic || '', subject: quiz.subject || null, grade: quiz.grade || null,
      source: quiz.quiz_source, language: lang, date: sent ? sent.sent_at : meta.lesson_date || quiz.created_at, code, link,
    },
    roster: rosterView,
    summary: {
      played: played.length,
      // The class tile pairs the children ON the class list with the class size; typed
      // children who are not on it are counted apart (never "76 of 10 played").
      onList: rosterView.state === 'known' ? played.filter((p) => p.onList).length : null,
      of: rosterView.of,
      // The average is over the SAME children as the count: the class list's when it is
      // known (typed children join both once the teacher adds them), else everyone's.
      avg: mean((rosterView.state === 'known' ? played.filter((p) => p.onList) : played).map((p) => p.pct)),
      total: questions.length || Math.max(0, ...played.map((p) => p.total)),
      hardestN: hardest ? hardest.n : null,
      ...(v21 ? { completion: V21.completion(rawSessions, teacherId, played.length) } : {}),
    },
    played,
    notPlayed,
    provisional,
    questions,
    guidance: handout.report_guidance && typeof handout.report_guidance === 'object' ? handout.report_guidance : null,
    reminder: link ? {
      language: lang,
      text: reminderText({
        topic: quiz.topic, link, language: lang,
        ...(rosterView.state === 'known' ? { played: played.filter((p) => p.onList).length, of: rosterView.of, className: rosterView.className } : {}),
      }),
    } : null,
  };
  // A storybook the teacher sent: listened / read aloud / questions per child instead of scores (story-teacher-report.js).
  if (quiz.quiz_source === 'story') return require('./story-teacher-report').forQuizReport(report, { quiz, sessions: counting, firstOf: (s) => { const l = who.listed(s); return l ? l.first : firstName(s.student_name); } });
  return report;
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
  // The library quizzes this teacher sent (quiz_teacher_home), by their send date, among their own.
  const sentList = await softly(() => sentQuizzes(teacherId, { since }), []);
  const qs = sentList.length
    ? [...(quizzes || []), ...sentList].sort((a, b) => String(b.sent_at || b.created_at || '').localeCompare(String(a.sent_at || a.created_at || '')))
    : quizzes || [];
  const codes = await classCodes(teacherId, qs.map((q) => q.id));
  const quizOfCode = new Map(codes.map((c) => [c.id, c.quiz_id]));
  const allSessions = await sessionsFor(codes.map((c) => c.id));
  const counted = countedSessions(allSessions, teacherId);
  // A storybook send's children count once they joined (story-teacher-report.js); a no-op when there is none.
  require('./story-teacher-report').countStoryJoins(counted, { quizzes: qs, sessions: allSessions, quizOfCode, count: (rows) => countedSessions(rows, teacherId, { opened: true }) });
  const sessionsOf = new Map();
  counted.forEach((s) => {
    const q = quizOfCode.get(s.share_code_id);
    if (!sessionsOf.has(q)) sessionsOf.set(q, []);
    sessionsOf.get(q).push(s);
  });

  let roster = null;
  try { roster = await readRoster(teacherId); } catch (err) {
    logToFile('⚠️ teacher report: class list read failed — no class sizes', { error: err.message });
  }
  const rows = qs.map((q) => {
    // One child per quiz across its codes (as the quiz page), and "N of M" counts the
    // class list only: a typed child who is not on it is never set against the class size.
    const mine = onePerChildAcrossCodes(sessionsOf.get(q.id) || []);
    const { roster: view, one } = classOf(roster, q, null);
    const ids = one ? new Set(one.kids.map((k) => k.id)) : null;
    // the same children for the average as for "N of M"
    // A storybook send has no questions: its children count as played, never as a 0 % score in an average.
    const scores = q.quiz_source === 'story' ? [] : (ids ? mine.filter((x) => x.student_id && ids.has(x.student_id)) : mine)
      .map((x) => pct(x.correct_answers || 0, x.total_questions_answered || 0));
    return {
      of: view.of,
      onList: ids ? mine.filter((x) => x.student_id && ids.has(x.student_id)).length : null,
      id: q.id, date: q.sent_at || (q.meta && q.meta.lesson_date) || q.created_at, topic: q.topic || '', grade: gradeNum(q.grade) || null,
      subject: q.subject || null, source: q.quiz_source, played: mine.length, avg: mean(scores), scores,
      // a library quiz this teacher SENT (sentQuizzes gives it sent_at); their own quizzes carry no key
      ...(q.sent_at ? { sent: true } : {}),
    };
  });

  const cellMap = new Map();
  const weekMap = new Map();
  rows.forEach((r) => {
    if (r.source === 'story') return;   // a story send is listed, never mixed into the class's quiz cells and weeks
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

module.exports = {
  quizReport, classReport, reminderText, weekStart, gradesOf, listLabel,
  // The counting pieces, for /quiz "My quiz reports" (teacher-report-list): its rows must
  // show the numbers the report page shows, so they count with this module, not a copy.
  readRoster, classOf, countedSessions, classCodes, sessionsFor, onePerChildAcrossCodes,
  // A library quiz's sender (quiz_teacher_home): the report list and the 12 h report's quiz-row guard read these.
  sentQuiz, sentQuizzes, sentQuizzesOn,
  // A storybook send's 12 h WhatsApp report counts the children its web report counts.
  storySendChildren,
  watchRootId, notUnderWatchRoot,   // the watch root's VALUE read and code rule, shared with the join queue
};
