/**
 * bd-s1oo0.7 (L7) — the child test from the coach app (the portal, wrapped by
 * the NIETE Android app).
 *
 * On WhatsApp a coach cannot show the child an opened picture and record at the
 * same time. The app can: one screen with the card in large print, a 60-second
 * timer and a recorder. This service is everything the portal's child-test page
 * needs from the bot. The portal holds NO child-test logic — it relays here over
 * the internal API (dashboard/services/portal-child-test.client.js), the same
 * reason as portal-coaching.service: the draw, store and scoring code needs
 * bot/ dependencies that do not resolve on the portal service.
 *
 *   listVisits          today's observe2 visits by this coach (the school comes from the visit)
 *   todaysList          draw.todaysList for one visit, joined with any sessions already started
 *   markOutcome         present / absent / refused; present opens an app-channel session
 *   getCard             the child's card for a block — stimulus and coach prompts, NEVER a key
 *   presignBlockUpload  a direct-to-R2 PUT for a block's audio or the maths strip photo (CONTRACT §4)
 *   registerBlockMedia  the upload arrived: attach it to the block row and start scoring
 *   sessionStatus       per block: media in, AI status, and the check form's prefill
 *   submitCheck         the coach's confirmed marks, stored next to the AI's with every change listed
 *
 * IDENTITY. `userId` is the id the portal read from ITS session. Every visit and
 * session is checked against it; another coach's is `not_found`.
 *
 * NEVER THROWS. Each function answers { status: 'ok', ... } | { status: 'invalid'
 * | 'not_found' | 'not_ready' | 'disabled', reason? } | { status: 'error', reason }
 * for the route to map to HTTP. Children are referred to by id only in logs.
 */

const BLOCKS = ['urdu', 'english', 'maths'];
const PRESIGN_TTL_SECONDS = 15 * 60;
const MB = 1024 * 1024;

// What the WebView / a browser records (recordingSupport.ts CANDIDATES), and
// what the camera hands back. The key's extension follows the real container:
// a WebM saved as .ogg would mislead every tool that trusts the name.
const MEDIA = {
  audio: {
    types: { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3' },
    maxBytes: 25 * MB, // a 3-minute block at 32 kb/s is under 1 MB
  },
  photo: {
    types: { 'image/jpeg': '.jpg', 'image/png': '.png' },
    maxBytes: 15 * MB,
  },
};

// Pakistan has no daylight saving: a visit "today" is one created since local midnight.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isEnabled() {
  return process.env.CHILD_TEST_ENABLED === 'true';
}

function envSegment() {
  return process.env.CHILD_TEST_R2_ENV || 'local';
}

function loadItemBank() {
  // eslint-disable-next-line global-require
  return require('../../../data/child-test/item-bank.v1.json');
}

/**
 * L5 owns the per-field confidence bars (scoring/thresholds.js). Until that
 * module is on this branch one default bar is used, and the status says so.
 */
function loadThresholds() {
  try {
    // eslint-disable-next-line global-require
    const t = require('../scoring/thresholds');
    const table = t.THRESHOLDS || t.thresholds || t;
    if (table && typeof table === 'object') {
      return { default: typeof table.default === 'number' ? table.default : 0.7, ...table, source: 'scoring/thresholds' };
    }
  } catch (_) { /* not on this branch yet */ }
  return { default: 0.7, source: 'default' };
}

function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../../config/supabase'),
    r2: () => require('../../../storage/r2'),
    store: () => require('../store'),
    draw: () => require('../draw'),
    scoring: () => require('../scoring'),
    itemBank: () => loadItemBank(),
    thresholds: () => loadThresholds(),
    log: () => require('../../../utils/logger').logToFile,
    logError: () => require('../../../utils/logger').logError,
    now: () => () => new Date(),
    env: () => envSegment(),
    enabled: () => isEnabled,
    defer: () => (fn) => setImmediate(fn),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, {
      enumerable: true,
      get: () => (deps[name] !== undefined ? deps[name] : load()),
    });
  }
  return d;
}

/** Wrap a handler: the gate, and a catch that turns any throw into a logged error status. */
function guarded(name, fn) {
  return async (args = {}, deps) => {
    const d = withDefaults(deps);
    if (!d.enabled()) return { status: 'disabled' };
    if (!args.userId) return { status: 'invalid', reason: 'no_user' };
    try {
      return await fn(args, d);
    } catch (error) {
      try {
        d.logError(`child_test.app.${name} failed`, { userId: args.userId, sessionId: args.sessionId, error: error && error.message });
      } catch (_) { /* logging must not mask the answer */ }
      return { status: 'error', reason: 'internal' };
    }
  };
}

function startOfTodayPkt(now) {
  const local = now.getTime() + PKT_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - PKT_OFFSET_MS);
}

function gradeOf(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'query failed');
  return data || [];
}

async function ownVisit(d, userId, visitId) {
  if (!visitId) return null;
  const found = await rows(d.supabase.from('observation_field_forms')
    .select('id, observer_user_id, created_at, sealed_at, visit_context, answers')
    .eq('id', visitId)
    .eq('observer_user_id', userId)
    .limit(1));
  return found[0] || null;
}

async function ownSession(d, userId, sessionId) {
  if (!sessionId) return null;
  const out = await d.store.getSession(sessionId);
  if (!out || !out.ok) throw new Error((out && out.error) || 'getSession failed');
  const s = out.session;
  return s && s.coach_user_id === userId ? s : null;
}

// ─── visits and the list ──────────────────────────────────────────────────

const listVisits = guarded('list_visits', async ({ userId }, d) => {
  const since = startOfTodayPkt(d.now()).toISOString();
  const forms = await rows(d.supabase.from('observation_field_forms')
    .select('id, observer_user_id, created_at, sealed_at, visit_context, answers')
    .eq('observer_user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5));

  const visits = [];
  for (const f of forms) {
    // eslint-disable-next-line no-await-in-loop
    const school = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId: f.id });
    const schoolId = school && school.ok ? school.schoolId : null;
    let schoolName = null;
    if (schoolId) {
      // eslint-disable-next-line no-await-in-loop
      const s = await rows(d.supabase.from('schools').select('id, name').eq('id', schoolId).limit(1));
      schoolName = (s[0] && s[0].name) || null;
    }
    visits.push({
      visitId: f.id,
      startedAt: f.created_at,
      sealed: !!f.sealed_at,
      schoolId,
      schoolName,
      observedGrade: gradeOf(f.answers && f.answers.lp_ref && f.answers.lp_ref.grade),
    });
  }
  return { status: 'ok', visits };
});

function withSessions(list, sessions) {
  const byDraw = new Map((sessions || []).map((s) => [s.draw_id, s]));
  const join = (c) => {
    const s = byDraw.get(c.drawId);
    return s ? { ...c, sessionId: s.id, sessionStatus: s.status } : { ...c };
  };
  return { ...list, children: (list.children || []).map(join), alternates: (list.alternates || []).map(join) };
}

const todaysList = guarded('todays_list', async ({ userId, visitId }, d) => {
  const visit = await ownVisit(d, userId, visitId);
  if (!visit) return { status: 'not_found' };
  const school = await d.draw.resolveVisitSchool({ coachUserId: userId, visitId });
  if (!school || !school.ok) return { status: 'invalid', reason: (school && school.reason) || 'no_school' };

  const list = await d.draw.todaysList({
    coachUserId: userId,
    schoolId: school.schoolId,
    visitId,
    observedGrade: gradeOf(visit.answers && visit.answers.lp_ref && visit.answers.lp_ref.grade),
  });
  if (!list || !list.ok) {
    if (list && list.reason) return { status: 'invalid', reason: list.reason };
    throw new Error((list && list.error) || 'todaysList failed');
  }
  const sessions = await d.store.listSessionsForVisit(visitId);
  d.log('child_test.app.list_opened', { userId, visitId, reused: !!list.reused });
  return { status: 'ok', list: withSessions(list, sessions && sessions.ok ? sessions.sessions : []) };
});

const OUTCOMES = ['present', 'absent', 'refused'];

const markOutcome = guarded('mark_outcome', async ({ userId, visitId, drawId, outcome, note }, d) => {
  if (!OUTCOMES.includes(outcome)) return { status: 'invalid', reason: 'bad_outcome' };
  if (!drawId) return { status: 'invalid', reason: 'no_draw' };
  const visit = await ownVisit(d, userId, visitId);
  if (!visit) return { status: 'not_found' };

  const res = await d.draw.markOutcome({ drawId, outcome, note, visitId });
  if (!res || !res.ok) {
    // Marked present already (on WhatsApp, or a second tap here): carry on with that session.
    if (res && res.reason === 'already_marked' && outcome === 'present') {
      const existing = await d.store.getSessionByDraw(drawId);
      const s = existing && existing.ok ? existing.session : null;
      if (s && s.coach_user_id === userId) return { status: 'ok', sessionId: s.id, list: null };
    }
    if (res && res.reason) return { status: 'invalid', reason: res.reason };
    throw new Error((res && res.error) || 'markOutcome failed');
  }
  d.log('child_test.app.outcome', { userId, visitId, drawId, outcome });
  if (outcome !== 'present') return { status: 'ok', list: res.list || null };

  const bank = d.itemBank;
  const created = await d.store.createSession({
    drawId, coachUserId: userId, visitId, channel: 'app', itemBankVersion: bank && bank.version,
  });
  if (!created || !created.ok || !created.session) throw new Error((created && created.error) || 'createSession failed');
  await d.store.recordTiming(created.session.id, 'app.started', d.now());
  return { status: 'ok', sessionId: created.session.id, list: res.list || null };
});

// ─── the card ─────────────────────────────────────────────────────────────

function formOf(bank, grade, form) {
  const g = bank && bank.grades && bank.grades[String(grade)];
  return (g && g.forms && g.forms[form]) || null;
}

/**
 * The child-facing card and the coach's spoken prompts. Built by picking the
 * fields that are shown — never by deleting keys — so a field added to the bank
 * later (an answer, a rubric) cannot leak onto the screen.
 */
function buildCard(bank, grade, form, block) {
  const f = formOf(bank, grade, form);
  const b = f && f[block];
  if (!b) return null;
  const cue = (bank.cue && bank.cue[block]) || {};
  const base = { block, grade, form, cue: { start: cue.start || null, stop: cue.stop || null } };

  if (block === 'maths') {
    return {
      ...base,
      timedSeconds: Number(b.quick_sums_seconds) || 60,
      child: {
        numbers: (b.numbers || []).map((n) => n.value),
        quickSums: (b.quick_sums || []).map((q) => q.prompt),
        written: (b.written || []).map((w) => w.prompt),
      },
      coach: {
        numbersStopRule: b.numbers_stop_rule || null,
        numberIds: (b.numbers || []).map((n) => n.id),
        writtenIds: (b.written || []).map((w) => w.id),
        wordProblem: b.word_problem
          ? { id: b.word_problem.id, prompt_ur: b.word_problem.prompt_ur, prompt_en: b.word_problem.prompt_en }
          : null,
      },
    };
  }

  const story = b.story || {};
  return {
    ...base,
    timedSeconds: 60,
    child: {
      story: { id: story.id, title: story.title || null, text: story.text || '' },
      nonwords: (b.nonwords || []).map((n) => ({ id: n.id, text: n.text })),
      fallback: b.fallback
        ? { letters: [...(b.fallback.letters || [])], words: [...(b.fallback.words || [])] }
        : null,
    },
    coach: {
      questions: (b.questions || []).map((q) => ({ id: q.id, prompt: q.prompt })),
      firstSounds: (b.first_sounds || []).map((s) => ({ id: s.id, word: s.word })),
    },
  };
}

const getCard = guarded('get_card', async ({ userId, sessionId, block }, d) => {
  if (!BLOCKS.includes(block)) return { status: 'invalid', reason: 'bad_block' };
  const session = await ownSession(d, userId, sessionId);
  if (!session) return { status: 'not_found' };
  const card = buildCard(d.itemBank, session.grade, session.form, block);
  if (!card) {
    d.logError('child_test.app.card_missing', { sessionId, block, grade: session.grade, form: session.form });
    return { status: 'error', reason: 'card_missing' };
  }
  return { status: 'ok', card };
});

// ─── upload ───────────────────────────────────────────────────────────────

function baseType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function expectedKey(env, session, block, kind, ext) {
  const prefix = `child-test/${env}/${session.school_id}/${session.id}`;
  return kind === 'photo' ? `${prefix}/maths-strip${ext}` : `${prefix}/${block}${ext}`;
}

function isExpectedKey(env, session, block, kind, key) {
  const exts = Object.values(MEDIA[kind].types);
  return exts.some((ext) => expectedKey(env, session, block, kind, ext) === key);
}

const presignBlockUpload = guarded('presign', async ({ userId, sessionId, block, kind, contentType, sizeBytes }, d) => {
  if (!BLOCKS.includes(block)) return { status: 'invalid', reason: 'bad_block' };
  const spec = MEDIA[kind];
  if (!spec) return { status: 'invalid', reason: 'unknown_kind' };
  if (kind === 'photo' && block !== 'maths') return { status: 'invalid', reason: 'no_photo_for_block' };
  const type = baseType(contentType);
  const ext = spec.types[type];
  if (!ext) return { status: 'invalid', reason: 'wrong_type' };
  const size = Number(sizeBytes);
  if (Number.isFinite(size) && size > spec.maxBytes) return { status: 'invalid', reason: 'too_large' };

  const session = await ownSession(d, userId, sessionId);
  if (!session) return { status: 'not_found' };
  const key = expectedKey(d.env, session, block, kind, ext);
  const uploadUrl = await d.r2.getPresignedUploadUrl(key, type, PRESIGN_TTL_SECONDS);
  return { status: 'ok', key, uploadUrl, contentType: type, expiresIn: PRESIGN_TTL_SECONDS, maxBytes: spec.maxBytes };
});

/** Off the request path: the coach is not kept waiting, and a scorer failure is logged, never thrown. */
function startScoring(d, session, block) {
  d.defer(() => {
    Promise.resolve()
      .then(() => d.scoring.scoreBlock({ sessionId: session.id, block, grade: session.grade, form: session.form }))
      .then((res) => {
        if (!res || !res.ok) {
          d.logError('child_test.app.score_not_ok', { sessionId: session.id, block, aiStatus: res && res.aiStatus, reason: res && res.reason });
        }
      })
      .catch((error) => {
        d.logError('child_test.app.score_failed', { sessionId: session.id, block, error: error && error.message });
      });
  });
}

/**
 * The app knows exactly when the timed minute started and ended inside the
 * recording (a tap, not a guess from the audio). Stored as session timings —
 * `<block>.app_timed_start` etc. — next to the cue phrase the scorer listens
 * for. A malformed value is skipped: it must never cost the upload.
 */
async function recordAppTiming(d, sessionId, block, timing) {
  if (!timing || typeof timing !== 'object') return;
  const start = Date.parse(timing.startedAt);
  if (!Number.isFinite(start)) return;
  const at = (ms) => (Number.isFinite(Number(ms)) && ms !== null && ms !== '' ? new Date(start + Number(ms)) : null);
  const marks = [
    ['app_recording_start', new Date(start)],
    ['app_timed_start', at(timing.timedStartMs)],
    ['app_timed_end', at(timing.timedEndMs)],
    ['app_finished_early', timing.finishedEarly === true ? at(timing.timedEndMs) : null],
    ['app_fallback', timing.fallback === true ? at(timing.timedEndMs) : null],
  ];
  for (const [name, when] of marks) {
    // eslint-disable-next-line no-await-in-loop
    if (when) await d.store.recordTiming(sessionId, `${block}.${name}`, when);
  }
}

const registerBlockMedia = guarded('register', async ({ userId, sessionId, block, audioKey, photoKey, timing }, d) => {
  if (!BLOCKS.includes(block)) return { status: 'invalid', reason: 'bad_block' };
  if (!audioKey && !photoKey) return { status: 'invalid', reason: 'no_media' };
  const session = await ownSession(d, userId, sessionId);
  if (!session) return { status: 'not_found' };

  if (audioKey && !isExpectedKey(d.env, session, block, 'audio', audioKey)) return { status: 'invalid', reason: 'not_your_upload' };
  if (photoKey && (block !== 'maths' || !isExpectedKey(d.env, session, block, 'photo', photoKey))) {
    return { status: 'invalid', reason: 'not_your_upload' };
  }
  for (const [key, kind] of [[audioKey, 'audio'], [photoKey, 'photo']]) {
    if (!key) continue;
    // eslint-disable-next-line no-await-in-loop
    const head = await d.r2.headObject(key);
    if (!head || !head.exists) return { status: 'invalid', reason: 'upload_missing' };
    if (Number(head.sizeBytes) > MEDIA[kind].maxBytes) return { status: 'invalid', reason: 'too_large' };
  }

  const attached = await d.store.attachBlockMedia({ sessionId, block, audioR2Key: audioKey, photoR2Key: photoKey });
  if (!attached || !attached.ok) {
    if (attached && attached.alreadyScored) return { status: 'invalid', reason: 'already_scored' };
    throw new Error((attached && attached.error) || 'attachBlockMedia failed');
  }
  if (audioKey) {
    await d.store.recordTiming(sessionId, `${block}.audio_received`, d.now());
    await recordAppTiming(d, sessionId, block, timing);
  }
  if (photoKey) await d.store.recordTiming(sessionId, 'maths.photo_received', d.now());
  d.log('child_test.app.media', { userId, sessionId, block, audio: !!audioKey, photo: !!photoKey });

  const row = attached.block || {};
  // Maths is one block with two inputs; ai_marks is written once, so it is
  // scored when both are in, not twice.
  if (block === 'maths' && !(row.audio_r2_key && row.photo_r2_key)) {
    return { status: 'ok', scoring: row.audio_r2_key ? 'waiting_for_photo' : 'waiting_for_audio' };
  }
  startScoring(d, session, block);
  return { status: 'ok', scoring: 'started' };
});

// ─── the check ────────────────────────────────────────────────────────────

function bar(thresholds, field) {
  const t = thresholds || {};
  return typeof t[field] === 'number' ? t[field] : (typeof t.default === 'number' ? t.default : 0.7);
}

function sure(item, thresholds, field) {
  return item && typeof item.confidence === 'number' && item.confidence >= bar(thresholds, field);
}

/** One verdict list (questions, nonwords…): a doubtful verdict arrives empty, the model's guess kept as a hint. */
function prefillVerdicts(list, thresholds, field) {
  return (list || []).map((it) => {
    const keep = !it.hint_only && sure(it, thresholds, field);
    return { ...it, verdict: keep ? it.verdict : null, hint: keep ? null : (it.verdict || null) };
  });
}

/**
 * The check form's starting values — the same rule as the WhatsApp check Flow
 * (L6): a field the model is not confident about is shown empty for the coach
 * to fill; first sounds and letters are coach-marked, the AI's view only a hint.
 */
function buildCheckPrefill(aiMarks, thresholds) {
  if (!aiMarks || typeof aiMarks !== 'object') return null;
  const out = { version: aiMarks.version || null };
  if (aiMarks.story) {
    const s = aiMarks.story;
    const flagged = s.flagged || [];
    out.story = {
      ...s,
      words_correct: sure(s, thresholds, 'story') ? s.words_correct : null,
      flagged: flagged.filter((f) => sure(f, thresholds, 'story_word')),
      uncertain: flagged.filter((f) => !sure(f, thresholds, 'story_word')),
    };
  }
  if ('fallback' in aiMarks) out.fallback = aiMarks.fallback;
  for (const field of ['questions', 'first_sounds', 'nonwords']) {
    if (aiMarks[field]) out[field] = prefillVerdicts(aiMarks[field], thresholds, field);
  }
  if (aiMarks.maths) {
    const m = aiMarks.maths;
    out.maths = {
      ...m,
      numbers: prefillVerdicts(m.numbers, thresholds, 'numbers'),
      written: (m.written || []).map((w) => {
        const keep = sure(w, thresholds, 'written');
        return { ...w, verdict: keep ? w.verdict : null, read_answer: keep ? w.read_answer : null, hint: keep ? null : (w.read_answer || null) };
      }),
      word_problem: m.word_problem
        ? { ...m.word_problem, verdict: sure(m.word_problem, thresholds, 'word_problem') ? m.word_problem.verdict : null }
        : m.word_problem,
    };
  }
  if (aiMarks.protocol_flags) out.protocol_flags = aiMarks.protocol_flags;
  return out;
}

function isPlain(v) {
  return v !== null && typeof v === 'object';
}

/** Every leaf whose value differs, as { path, ai, coach } — CONTRACT §5 (coach_edits). */
function diffMarks(ai, coach, prefix = '') {
  const edits = [];
  const a = isPlain(ai) ? ai : {};
  const c = isPlain(coach) ? coach : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(c)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    const av = a[k];
    const cv = c[k];
    if (isPlain(av) || isPlain(cv)) {
      if (isPlain(av) && isPlain(cv)) edits.push(...diffMarks(av, cv, p));
      else if (JSON.stringify(av) !== JSON.stringify(cv)) edits.push({ path: p, ai: av === undefined ? null : av, coach: cv === undefined ? null : cv });
    } else if (av !== cv) {
      edits.push({ path: p, ai: av === undefined ? null : av, coach: cv === undefined ? null : cv });
    }
  }
  return edits;
}

// Fields the prefill adds for the form's own use; they are not marks.
const PREFILL_ONLY = new Set(['hint', 'uncertain']);

function stripPrefillFields(v) {
  if (Array.isArray(v)) return v.map(stripPrefillFields);
  if (!isPlain(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!PREFILL_ONLY.has(k)) out[k] = stripPrefillFields(x);
  }
  return out;
}

const sessionStatus = guarded('session_status', async ({ userId, sessionId }, d) => {
  const session = await ownSession(d, userId, sessionId);
  if (!session) return { status: 'not_found' };
  const listed = await d.store.listBlocks(sessionId);
  if (!listed || !listed.ok) throw new Error((listed && listed.error) || 'listBlocks failed');
  const byBlock = new Map((listed.blocks || []).map((b) => [b.block, b]));
  const thresholds = d.thresholds;
  const blocks = BLOCKS.map((name) => {
    const b = byBlock.get(name);
    if (!b) return { block: name, hasAudio: false, hasPhoto: false, aiStatus: null, aiReason: null, checked: false, prefill: null };
    return {
      block: name,
      hasAudio: !!b.audio_r2_key,
      hasPhoto: !!b.photo_r2_key,
      aiStatus: b.ai_status || null,
      aiReason: b.ai_reason || null,
      checked: !!b.checked_at,
      prefill: buildCheckPrefill(b.ai_marks, thresholds),
    };
  });
  return {
    status: 'ok',
    session: { id: session.id, status: session.status, grade: session.grade, form: session.form },
    thresholdsSource: (thresholds && thresholds.source) || null,
    blocks,
  };
});

const submitCheck = guarded('submit_check', async ({ userId, sessionId, block, coachMarks }, d) => {
  if (!BLOCKS.includes(block)) return { status: 'invalid', reason: 'bad_block' };
  if (!isPlain(coachMarks)) return { status: 'invalid', reason: 'no_marks' };
  const session = await ownSession(d, userId, sessionId);
  if (!session) return { status: 'not_found' };
  const got = await d.store.getBlock(sessionId, block);
  if (!got || !got.ok) throw new Error((got && got.error) || 'getBlock failed');
  const row = got.block;
  if (!row || !row.ai_marks) {
    // A block the AI could not mark is still checked — from scratch, every field an edit.
    if (!(row && row.ai_status === 'failed')) return { status: 'not_ready', reason: 'not_scored' };
  }
  if (row.checked_at) return { status: 'invalid', reason: 'already_checked' };

  const marks = stripPrefillFields(coachMarks);
  const coachEdits = diffMarks(row.ai_marks || {}, marks);
  const saved = await d.store.saveCoachMarks({ sessionId, block, coachMarks: marks, coachEdits });
  if (!saved || !saved.ok) {
    if (saved && saved.alreadyChecked) return { status: 'invalid', reason: 'already_checked' };
    throw new Error((saved && saved.error) || 'saveCoachMarks failed');
  }
  await d.store.recordTiming(sessionId, `check.${block}.submitted`, d.now());
  d.log('child_test.app.checked', { userId, sessionId, block, edits: coachEdits.length });

  const listed = await d.store.listBlocks(sessionId);
  const all = (listed && listed.ok ? listed.blocks : []) || [];
  const done = BLOCKS.every((name) => {
    if (name === block) return true;
    const b = all.find((x) => x.block === name);
    return !!(b && b.checked_at);
  });
  if (done) await d.store.setSessionStatus(sessionId, 'completed');
  return { status: 'ok', edits: coachEdits.length, sessionCompleted: done };
});

module.exports = {
  BLOCKS,
  MEDIA,
  isEnabled,
  listVisits,
  todaysList,
  markOutcome,
  getCard,
  presignBlockUpload,
  registerBlockMedia,
  sessionStatus,
  submitCheck,
  // pure, exported for tests and for the portal's check form
  buildCard,
  buildCheckPrefill,
  diffMarks,
  startOfTodayPkt,
};
