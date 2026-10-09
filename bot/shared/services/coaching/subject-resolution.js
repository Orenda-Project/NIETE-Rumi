'use strict';
/**
 * Which subject was this lesson? — one owner, and it reports a CONFIDENCE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * FICO's Section F tags three of its indicators by subject (F5 MATHEMATICS,
 * F6 SCIENCE, F7 LITERACY/LANGUAGE) and at most one applies to any lesson. Until
 * now nothing on the pipeline ever told the analyser which — the metadata object
 * carried `lessonPlanSubject`, the framework destructured `subject`, and the two
 * were never the same key, so the `- Subject:` prompt line never emitted and the
 * subject-conditional rule ran on the model's own reading of the transcript.
 *
 * The measured reality is that the model reads it correctly most of the time. What
 * it cannot do is know the difference between "this lesson's content is the solar
 * system" and "this lesson is Urdu chapter 8, whose text is about the solar system".
 * A Grade-1 Urdu lesson was told, in writing, that it was not a literacy lesson.
 *
 * So this module does NOT claim certainty it does not have. It returns one of three
 * confidences, and the caller behaves differently for each:
 *
 *   high    — the class the teacher picked when she sent the recording (bd-fmf24g.9, tier 0:
 *             wins over everything below), or her own lesson plan, extracted, names the subject.
 *   medium  — the corpus key of the plan she selected for this lesson, or exactly
 *             one distinct subject downloaded in the hours before the recording.
 *             Both are good signals about the PLAN; neither is proof about the lesson.
 *   none    — no signal, an ambiguous one, or the grader told us the linked plan is
 *             not this lesson. The safe default: no subject is passed, all three
 *             subject-tagged rows stay out, AND the report says the subject was not
 *             confirmed rather than implying a subject the lesson lacked.
 *
 * It is PURE and SYNCHRONOUS on purpose. It sits on the critical coaching path, so
 * it takes any recent downloads as an argument rather than querying for them, and it
 * has no clock of its own — `now` is injected.
 */

/**
 * Mirror of the DB `subjects` registry (the V1.1.3 seed plus V1.2.6's islamiat),
 * plus the spellings measured on real `lesson_plan_structured.subject` values that
 * the table does not yet hold — the Urdu-script names and the two "English
 * Language…" variants. A drift test pins every seeded code and alias against this
 * map, so the two cannot disagree silently.
 *
 * Kept static rather than queried because a per-session read of a seven-row
 * reference table on the analysis hot path buys nothing and adds a failure mode.
 */
const SUBJECT_ALIASES = {
  urdu: ['urdu', 'reading hour urdu', 'اردو', 'ادب و زبان اردو', 'urdu language'],
  english: ['english', 'reading hour english', 'english language', 'english language arts', 'انگریزی'],
  maths: ['maths', 'math', 'mathematics', 'numeracy', 'ریاضی', 'mathematic'],
  science: ['science', 'general science', 'general_science', 'gk-science', 'سائنس', 'generalscience'],
  social_studies: ['social_studies', 'social studies', 'social studies / pak st.', 'معاشرتی علوم'],
  general_knowledge: ['general_knowledge', 'general knowledge', 'gk', 'عمومی معلومات'],
  islamiat: ['islamiat', 'islamiyat', 'islamic studies', 'اسلامیات'],
};

/**
 * Which SUBJECT GROUP a subject belongs to — the group the rubric tags its
 * subject-specific indicators with, never a row id.
 *
 * This deliberately stops one level short of naming an indicator. The rubric's own
 * row numbering is a version detail and it has already moved: the revision live on
 * staging tags F5 math / F6 science / F7 literacy, while the revision on the unstable
 * branch tags F4-F5 math / F6-F7 science / F8-F10 literacy. A table here saying
 * "urdu → F7" is correct against one and, against the other, points an Urdu lesson at
 * a SCIENCE indicator — a worse error than the one this module exists to fix. The
 * framework derives its own rows from its own rubric (fico-framework.subjectTaggedRows).
 *
 * Three of the seven subject codes belong to no group at all — the rubric has no
 * subject-specific indicator for Islamiat, Social Studies or General Knowledge. That is
 * a rubric gap, reported as one; guessing a row for those lessons is how four of ten
 * Islamiat sessions were scored on a subject nobody was teaching.
 */
const SUBJECT_GROUP = {
  maths: 'math',
  science: 'science',
  urdu: 'literacy',
  english: 'literacy',
};

/** Reverse index, built once. */
const ALIAS_INDEX = (() => {
  const index = new Map();
  for (const [code, aliases] of Object.entries(SUBJECT_ALIASES)) {
    index.set(code, code);
    for (const alias of aliases) index.set(alias, code);
  }
  return index;
})();

/** How far back a lesson-plan download still says something about this lesson. */
const DOWNLOAD_WINDOW_HOURS = Number(process.env.SUBJECT_DOWNLOAD_WINDOW_HOURS) || 6;

/**
 * Any spelling → the canonical subject code, or null.
 *
 * Total: junk, non-strings and unknown spellings return null rather than throwing.
 * An unknown subject is a real state (Physics, Woodwork) and the honest answer is
 * "not one the rubric knows", never a nearest match.
 *
 * @param {*} raw
 * @returns {string|null}
 */
function canonicalSubject(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  return ALIAS_INDEX.get(key) || null;
}

/**
 * The corpus key encodes both facts we want: `grade_<n>_<subject>_ch<m>_seg<k>`,
 * where the subject token may itself contain underscores (`general_science`).
 *
 * @param {*} lessonId
 * @returns {{subject: string, grade: string}|null} null unless BOTH parse — a
 *          half-parsed key is not a signal.
 */
function parseCorpusLessonId(lessonId) {
  if (typeof lessonId !== 'string') return null;
  const m = /^grade_(\d+)_(.+?)_ch\d+_seg\d+b?$/i.exec(lessonId.trim());
  if (!m) return null;
  const subject = canonicalSubject(m[2].replace(/_/g, ' '));
  if (!subject) return null;
  return { subject, grade: m[1] };
}

/**
 * @param {string|null} code canonical subject code
 * @returns {string|null} 'math' | 'science' | 'literacy', or null when the rubric
 *          carries no subject-specific indicator for this subject.
 */
function subjectGroupFor(code) {
  if (typeof code !== 'string') return null;
  return SUBJECT_GROUP[code] || null;
}

/** Did the fidelity grader say the linked plan is not the lesson we recorded? */
function graderSaysLessonMismatch(session) {
  const note = session
    && session.analysis_data
    && session.analysis_data.lp_fidelity
    && session.analysis_data.lp_fidelity.moderators
    && session.analysis_data.lp_fidelity.moderators.note;
  return typeof note === 'string' && note.trim() === 'lesson_mismatch';
}

/**
 * bd-fmf24g.9 — the class the teacher picked in the v2 app when she sent the recording,
 * stored by portal-coaching.service at conversation_state.teacher_class
 * ({ grade, subject, subject_key?, picked_at }).
 *
 * PRECEDENCE: her pick is TIER 0 — it wins over her uploaded plan, the corpus plan she
 * linked, recent downloads and the grader's lesson_mismatch note (that note is about a
 * PLAN; her pick is not one). It is her statement about her own lesson. What is NOT done
 * is silence about disagreement: see subjectDisagreement().
 *
 * A pick whose subject the registry cannot name (Physics, Woodwork) yields no code and
 * the chain falls through to the other tiers — never a nearest match. A grade outside
 * 1-12 makes the whole pick unusable.
 *
 * @param {object} session coaching_sessions row
 * @returns {{code: string, grade: string}|null}
 */
function teacherPickOf(session) {
  const tc = session && session.conversation_state && session.conversation_state.teacher_class;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return null;
  const grade = typeof tc.grade === 'string' && /^\d{1,2}$/.test(tc.grade.trim()) ? Number(tc.grade) : tc.grade;
  if (!Number.isInteger(grade) || grade < 1 || grade > 12) return null;
  const code = canonicalSubject(tc.subject_key) || canonicalSubject(tc.subject);
  if (!code) return null;
  return { code, grade: String(grade) };
}

/** The row as it was before she picked — what the other tiers see. */
function withoutTeacherPick(session) {
  const cs = (session && session.conversation_state) || {};
  const { teacher_class: _dropped, ...rest } = cs;
  return { ...session, conversation_state: rest };
}

const NO_SUBJECT = (source) => ({
  code: null, grade: null, confidence: 'none', source, group: null,
});

const resolved = (code, grade, confidence, source) => ({
  code,
  grade: grade == null || grade === '' ? null : String(grade),
  confidence,
  source,
  group: subjectGroupFor(code),
});

/**
 * Resolve the lesson's subject from whatever the row carries.
 *
 * @param {object} session a coaching_sessions row
 * @param {object} [opts]
 * @param {Date}   [opts.now] the reference instant (defaults to real now)
 * @param {Array}  [opts.downloads] recent niete_lp_downloads rows for this teacher
 *                 ({subject, grade, created_at}); omit to skip that tier entirely.
 * @returns {{code: string|null, grade: string|null,
 *            confidence: 'high'|'medium'|'none', source: string,
 *            group: string|null}}
 */
function resolveLessonSubject(session, opts = {}) {
  const s = session || {};
  const structured = s.lesson_plan_structured || null;

  // Tier 0 — HIGH. The class she picked when she sent the recording (bd-fmf24g.9). Wins
  // over every tier below and is not demoted by lesson_mismatch (that is about a plan).
  const picked = teacherPickOf(s);
  if (picked) return resolved(picked.code, picked.grade, 'high', 'teacher');

  // The grader had the plan and the transcript side by side and said they are not
  // the same lesson. Anything derived from that plan is then worse than nothing:
  // it would promote a subject-tagged row on evidence we know to be wrong.
  const mismatch = graderSaysLessonMismatch(s);

  // Tier 1 — HIGH. Her own plan, extracted, names the subject.
  const uploaded = canonicalSubject(structured && structured.subject);
  if (uploaded) {
    if (mismatch) return NO_SUBJECT('lesson_mismatch');
    return resolved(uploaded, structured.grade_level || structured.grade, 'high', 'lesson_plan_structured');
  }

  // Tier 2 — MEDIUM. The corpus plan she selected for this lesson. The ref written
  // since the stub fix carries the subject; older refs carry only the key, which
  // encodes it — 3,437 sessions are in that older shape, so both paths must work.
  const ref = structured && structured._fidelity_ref;
  if (ref) {
    if (mismatch) return NO_SUBJECT('lesson_mismatch');
    const direct = canonicalSubject(ref.subject);
    if (direct) return resolved(direct, ref.grade, 'medium', 'corpus_fidelity_ref');
    const parsed = parseCorpusLessonId(ref.lesson_id);
    if (parsed) return resolved(parsed.subject, parsed.grade, 'medium', 'corpus_lesson_id');
  }

  // Tier 3 — MEDIUM, and only when it is unambiguous. Measured against each
  // session's own linked plan this signal agrees 91% of the time inside six hours,
  // so it says "probably this plan", not "this lesson". Two different subjects in
  // the window is not a weaker signal, it is no signal.
  const downloads = Array.isArray(opts.downloads) ? opts.downloads : null;
  if (downloads && downloads.length) {
    const now = opts.now instanceof Date ? opts.now.getTime() : Date.now();
    const cutoff = now - DOWNLOAD_WINDOW_HOURS * 3600 * 1000;
    const inWindow = downloads.filter((d) => {
      if (!d || !d.created_at) return false;
      const t = Date.parse(d.created_at);
      return Number.isFinite(t) && t >= cutoff && t <= now;
    });
    const codes = new Set();
    let pick = null;
    for (const d of inWindow) {
      const code = canonicalSubject(d.subject);
      if (!code) continue;
      codes.add(code);
      if (!pick) pick = d;
    }
    if (codes.size === 1) {
      return resolved([...codes][0], pick && pick.grade, 'medium', 'recent_download');
    }
    if (codes.size > 1) return NO_SUBJECT('ambiguous_downloads');
  }

  return NO_SUBJECT('no_signal');
}

/**
 * Does an INDEPENDENT signal strongly disagree with her pick? Pure; the caller logs it.
 * The pick stands either way — this only makes the disagreement visible.
 *
 * "Strongly" is deliberately narrow: her OWN uploaded plan (high confidence) names a
 * different subject, or the analysis itself inferred a different one. A corpus-ref or a
 * recent download is a statement about a plan she opened, not about this lesson, so it
 * is not a disagreement worth a warn.
 *
 * @param {object} session coaching_sessions row
 * @param {object} resolution what resolveLessonSubject returned for it
 * @param {{inferredSubject?: *}} [opts] inferredSubject: the analysis' own `subject`
 * @returns {null|{teacher:{code:string,grade:string}, against:Array<{code:string,source:string,confidence:string}>}}
 */
function subjectDisagreement(session, resolution, opts = {}) {
  if (!resolution || resolution.source !== 'teacher') return null;
  const against = [];
  const planOnly = resolveLessonSubject(withoutTeacherPick(session));
  if (planOnly.confidence === 'high' && planOnly.code && planOnly.code !== resolution.code) {
    against.push({ code: planOnly.code, source: planOnly.source, confidence: 'high' });
  }
  const inferred = canonicalSubject(opts.inferredSubject);
  if (inferred && inferred !== resolution.code) {
    against.push({ code: inferred, source: 'analysis_inferred', confidence: 'inferred' });
  }
  return against.length ? { teacher: { code: resolution.code, grade: resolution.grade }, against } : null;
}

module.exports = {
  SUBJECT_ALIASES,
  SUBJECT_GROUP,
  DOWNLOAD_WINDOW_HOURS,
  canonicalSubject,
  parseCorpusLessonId,
  subjectGroupFor,
  resolveLessonSubject,
  subjectDisagreement,
};
