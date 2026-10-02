/**
 * bd-s1oo0.7 (L7) — the bot side of the coach-app child test.
 *
 * The portal holds no child-test logic: every call relays to
 * bot/shared/services/child-test/app/app-api.service.js over the internal API.
 * What is pinned here:
 *   - the gate (CHILD_TEST_ENABLED) — inert when off
 *   - IDENTITY: a visit / session that is not this coach's is refused
 *   - the R2 keys follow CONTRACT §4 and a registered key must be the one minted
 *   - the card never carries an answer key
 *   - scoring is started, off the request path, when a block's media is complete
 *   - the check form hides low-confidence fields, and coach_edits lists every change
 *
 * Mocked: the Supabase client (fake below), R2 (network), and the draw/store/
 * scoring modules — those three are L3/L5's and are injected through the
 * service's deps because they are still stubs on the integration branch
 * (STORE_API.md is the contract the fakes follow).
 */

const path = require('path');
const bank = require('./fixtures/mini-bank.json');

const SVC = '../../../bot/shared/services/child-test/app/app-api.service';

const COACH = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const VISIT = '33333333-3333-4333-8333-333333333333';
const SCHOOL = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const DRAW = '66666666-6666-4666-8666-666666666666';

function fakeSupabase(tables) {
  return {
    from(table) {
      const filters = [];
      let limitN = null;
      const chain = {
        select: () => chain,
        eq: (c, v) => { filters.push((r) => r[c] === v); return chain; },
        gte: (c, v) => { filters.push((r) => String(r[c]) >= String(v)); return chain; },
        in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return chain; },
        order: () => chain,
        limit: (n) => { limitN = n; return chain; },
        then: (resolve) => {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (limitN != null) rows = rows.slice(0, limitN);
          return resolve({ data: rows, error: null });
        },
        maybeSingle: async () => {
          const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          return { data: rows[0] || null, error: null };
        },
      };
      return chain;
    },
  };
}

function makeDeps(over = {}) {
  const sessions = {
    [SESSION]: {
      id: SESSION, draw_id: DRAW, coach_user_id: COACH, visit_id: VISIT, school_id: SCHOOL,
      grade: 3, form: 'A', status: 'in_progress', timings: {},
    },
  };
  const blocks = {};
  const store = {
    getSession: jest.fn(async (id) => ({ ok: true, session: sessions[id] || null })),
    getSessionByDraw: jest.fn(async (drawId) => ({
      ok: true, session: Object.values(sessions).find((s) => s.draw_id === drawId) || null,
    })),
    createSession: jest.fn(async ({ drawId, coachUserId, visitId, channel }) => {
      const s = { id: 'new-session', draw_id: drawId, coach_user_id: coachUserId, visit_id: visitId, channel, grade: 3, form: 'A', school_id: SCHOOL, status: 'in_progress' };
      sessions[s.id] = s;
      return { ok: true, session: s, created: true };
    }),
    listSessionsForVisit: jest.fn(async () => ({ ok: true, sessions: Object.values(sessions) })),
    setSessionStatus: jest.fn(async (id, status) => ({ ok: true, session: { ...sessions[id], status } })),
    recordTiming: jest.fn(async () => ({ ok: true, timings: {} })),
    attachBlockMedia: jest.fn(async ({ sessionId, block, audioR2Key, photoR2Key }) => {
      const k = `${sessionId}:${block}`;
      const row = blocks[k] || { session_id: sessionId, block, audio_r2_key: null, photo_r2_key: null, ai_marks: null, ai_status: 'pending' };
      if (row.ai_marks) return { ok: false, alreadyScored: true };
      if (audioR2Key) row.audio_r2_key = audioR2Key;
      if (photoR2Key) row.photo_r2_key = photoR2Key;
      blocks[k] = row;
      return { ok: true, block: row };
    }),
    listBlocks: jest.fn(async (sessionId) => ({ ok: true, blocks: Object.values(blocks).filter((b) => b.session_id === sessionId) })),
    getBlock: jest.fn(async (sessionId, block) => ({ ok: true, block: blocks[`${sessionId}:${block}`] || null })),
    saveCoachMarks: jest.fn(async ({ sessionId, block, coachMarks, coachEdits }) => {
      const row = blocks[`${sessionId}:${block}`];
      if (row.checked_at) return { ok: false, alreadyChecked: true };
      row.coach_marks = coachMarks; row.coach_edits = coachEdits; row.checked_at = 'now';
      return { ok: true, block: row };
    }),
  };
  const draw = {
    resolveVisitSchool: jest.fn(async () => ({ ok: true, schoolId: SCHOOL })),
    todaysList: jest.fn(async () => ({
      ok: true, cycleId: 'ICT-2026-Q4', grade: 3, classId: 'c1',
      children: [{ drawId: DRAW, studentId: 's1', rollNumber: '7', displayName: 'Child 7', role: 'new', form: 'A', status: 'listed' }],
      alternates: [],
    })),
    markOutcome: jest.fn(async () => ({ ok: true, list: { ok: true, children: [], alternates: [] } })),
  };
  const r2 = {
    getPresignedUploadUrl: jest.fn(async (key) => `https://r2.example/${key}?sig=1`),
    headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000 })),
  };
  const scoring = { scoreBlock: jest.fn(async () => ({ ok: true, aiStatus: 'scored' })) };
  const supabase = fakeSupabase({
    observation_field_forms: [
      { id: VISIT, observer_user_id: COACH, created_at: '2026-10-02T05:00:00Z', sealed_at: null, visit_context: { school_ext_id: 'niete:123' }, answers: { lp_ref: { grade: 3 } } },
      { id: 'old-visit', observer_user_id: COACH, created_at: '2026-09-01T05:00:00Z', visit_context: {}, answers: {} },
      { id: 'their-visit', observer_user_id: OTHER, created_at: '2026-10-02T05:00:00Z', visit_context: {}, answers: {} },
    ],
    schools: [{ id: SCHOOL, name: 'IMCB G-10/4' }],
  });
  return {
    store, draw, r2, scoring, supabase,
    itemBank: bank,
    now: () => new Date('2026-10-02T09:00:00Z'),
    env: 'sandbox',
    enabled: () => true,
    log: jest.fn(),
    logError: jest.fn(),
    defer: (fn) => fn(),
    ...over,
    _blocks: blocks,
    _sessions: sessions,
  };
}

let Svc;
beforeEach(() => {
  jest.resetModules();
  Svc = require(SVC);
});

describe('gate', () => {
  test('every call is refused with status disabled when the feature is off', async () => {
    const deps = makeDeps({ enabled: () => false });
    const out = await Svc.listVisits({ userId: COACH }, deps);
    expect(out).toEqual({ status: 'disabled' });
    expect(deps.draw.todaysList).not.toHaveBeenCalled();
  });

  test('the default gate reads CHILD_TEST_ENABLED and is off unless exactly "true"', () => {
    const prev = process.env.CHILD_TEST_ENABLED;
    try {
      delete process.env.CHILD_TEST_ENABLED;
      expect(Svc.isEnabled()).toBe(false);
      process.env.CHILD_TEST_ENABLED = '1';
      expect(Svc.isEnabled()).toBe(false);
      process.env.CHILD_TEST_ENABLED = 'true';
      expect(Svc.isEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CHILD_TEST_ENABLED; else process.env.CHILD_TEST_ENABLED = prev;
    }
  });
});

describe('visits and the list', () => {
  test("listVisits returns only this coach's visits from today (Pakistan date)", async () => {
    const deps = makeDeps();
    const out = await Svc.listVisits({ userId: COACH }, deps);
    expect(out.status).toBe('ok');
    expect(out.visits.map((v) => v.visitId)).toEqual([VISIT]);
    expect(out.visits[0]).toMatchObject({ schoolId: SCHOOL, schoolName: 'IMCB G-10/4', observedGrade: 3 });
  });

  test("todaysList refuses a visit that is not this coach's", async () => {
    const deps = makeDeps();
    const out = await Svc.todaysList({ userId: COACH, visitId: 'their-visit' }, deps);
    expect(out).toEqual({ status: 'not_found' });
    expect(deps.draw.todaysList).not.toHaveBeenCalled();
  });

  test('todaysList calls the draw with the visit school and observed grade, and joins sessions by draw', async () => {
    const deps = makeDeps();
    const out = await Svc.todaysList({ userId: COACH, visitId: VISIT }, deps);
    expect(deps.draw.todaysList).toHaveBeenCalledWith({ coachUserId: COACH, schoolId: SCHOOL, visitId: VISIT, observedGrade: 3 });
    expect(out.status).toBe('ok');
    expect(out.list.children[0]).toMatchObject({ drawId: DRAW, sessionId: SESSION });
  });

  test('a draw refusal (no class list) is passed through as its reason, never as an empty list', async () => {
    const deps = makeDeps();
    deps.draw.todaysList.mockResolvedValueOnce({ ok: false, reason: 'no_class_list', grade: 3 });
    const out = await Svc.todaysList({ userId: COACH, visitId: VISIT }, deps);
    expect(out).toEqual({ status: 'invalid', reason: 'no_class_list' });
  });
});

describe('outcome', () => {
  test('present creates an app-channel session', async () => {
    const deps = makeDeps();
    const out = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: 'd2', outcome: 'present' }, deps);
    expect(deps.draw.markOutcome).toHaveBeenCalledWith({ drawId: 'd2', outcome: 'present', note: undefined, visitId: VISIT });
    expect(deps.store.createSession).toHaveBeenCalledWith(expect.objectContaining({ drawId: 'd2', coachUserId: COACH, visitId: VISIT, channel: 'app' }));
    expect(out.status).toBe('ok');
    expect(out.sessionId).toBe('new-session');
  });

  test('present on a child already marked present (e.g. on WhatsApp) reuses the existing session', async () => {
    const deps = makeDeps();
    deps.draw.markOutcome.mockResolvedValueOnce({ ok: false, reason: 'already_marked' });
    const out = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: DRAW, outcome: 'present' }, deps);
    expect(out).toMatchObject({ status: 'ok', sessionId: SESSION });
    expect(deps.store.createSession).not.toHaveBeenCalled();
  });

  test('absent creates no session', async () => {
    const deps = makeDeps();
    const out = await Svc.markOutcome({ userId: COACH, visitId: VISIT, drawId: 'd2', outcome: 'absent', note: 'sick' }, deps);
    expect(out.status).toBe('ok');
    expect(out.sessionId).toBeUndefined();
    expect(deps.store.createSession).not.toHaveBeenCalled();
  });
});

describe('the card', () => {
  test('carries the stimulus and the coach prompts but never an answer key', async () => {
    const deps = makeDeps();
    const out = await Svc.getCard({ userId: COACH, sessionId: SESSION, block: 'urdu' }, deps);
    expect(out.status).toBe('ok');
    expect(out.card.child.story.text).toBe(bank.grades['3'].forms.A.urdu.story.text);
    expect(out.card.child.nonwords).toHaveLength(5);
    expect(out.card.coach.questions[0].prompt).toBe(bank.grades['3'].forms.A.urdu.questions[0].prompt);
    const json = JSON.stringify(out.card);
    for (const leak of ['"accept"', '"reject"', '"rubric"', '"answer"', '"sounds"', '"sound"']) {
      expect(json).not.toContain(leak);
    }
  });

  test('the maths card has numbers, quick sums and the written prompts, without answers', async () => {
    const deps = makeDeps();
    const out = await Svc.getCard({ userId: COACH, sessionId: SESSION, block: 'maths' }, deps);
    expect(out.card.child.numbers).toEqual(bank.grades['3'].forms.A.maths.numbers.map((n) => n.value));
    expect(out.card.child.quickSums[0]).toBe('3 + 1');
    expect(out.card.timedSeconds).toBe(60);
    expect(JSON.stringify(out.card)).not.toContain('"answer"');
  });

  test("another coach's session is not found", async () => {
    const deps = makeDeps();
    const out = await Svc.getCard({ userId: OTHER, sessionId: SESSION, block: 'urdu' }, deps);
    expect(out).toEqual({ status: 'not_found' });
  });

  test('an unknown block is invalid', async () => {
    const out = await Svc.getCard({ userId: COACH, sessionId: SESSION, block: 'science' }, makeDeps());
    expect(out).toEqual({ status: 'invalid', reason: 'bad_block' });
  });
});

describe('upload', () => {
  test('presign mints the CONTRACT §4 key for block audio', async () => {
    const deps = makeDeps();
    const out = await Svc.presignBlockUpload({ userId: COACH, sessionId: SESSION, block: 'urdu', kind: 'audio', contentType: 'audio/webm;codecs=opus', sizeBytes: 500000 }, deps);
    expect(out.status).toBe('ok');
    expect(out.key).toBe(`child-test/sandbox/${SCHOOL}/${SESSION}/urdu.webm`);
    expect(out.contentType).toBe('audio/webm');
    expect(deps.r2.getPresignedUploadUrl).toHaveBeenCalledWith(out.key, 'audio/webm', expect.any(Number));
  });

  test('presign mints maths-strip.jpg for the photo, and refuses a photo on a reading block', async () => {
    const deps = makeDeps();
    const ok = await Svc.presignBlockUpload({ userId: COACH, sessionId: SESSION, block: 'maths', kind: 'photo', contentType: 'image/jpeg', sizeBytes: 100 }, deps);
    expect(ok.key).toBe(`child-test/sandbox/${SCHOOL}/${SESSION}/maths-strip.jpg`);
    const bad = await Svc.presignBlockUpload({ userId: COACH, sessionId: SESSION, block: 'urdu', kind: 'photo', contentType: 'image/jpeg', sizeBytes: 100 }, deps);
    expect(bad).toEqual({ status: 'invalid', reason: 'no_photo_for_block' });
  });

  test('presign refuses a wrong type and an oversized file', async () => {
    const deps = makeDeps();
    expect(await Svc.presignBlockUpload({ userId: COACH, sessionId: SESSION, block: 'urdu', kind: 'audio', contentType: 'video/mp4', sizeBytes: 1 }, deps))
      .toEqual({ status: 'invalid', reason: 'wrong_type' });
    expect(await Svc.presignBlockUpload({ userId: COACH, sessionId: SESSION, block: 'urdu', kind: 'audio', contentType: 'audio/webm', sizeBytes: 60 * 1024 * 1024 }, deps))
      .toEqual({ status: 'invalid', reason: 'too_large' });
  });

  test('register refuses a key this session did not mint', async () => {
    const deps = makeDeps();
    const out = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'urdu', audioKey: `child-test/sandbox/${SCHOOL}/other/urdu.webm` }, deps);
    expect(out).toEqual({ status: 'invalid', reason: 'not_your_upload' });
    expect(deps.store.attachBlockMedia).not.toHaveBeenCalled();
  });

  test('register refuses a key that never reached R2', async () => {
    const deps = makeDeps();
    deps.r2.headObject.mockResolvedValueOnce({ exists: false });
    const out = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'urdu', audioKey: `child-test/sandbox/${SCHOOL}/${SESSION}/urdu.webm` }, deps);
    expect(out).toEqual({ status: 'invalid', reason: 'upload_missing' });
  });

  test('register attaches the audio, stamps the timing and starts scoring for a reading block', async () => {
    const deps = makeDeps();
    const key = `child-test/sandbox/${SCHOOL}/${SESSION}/urdu.webm`;
    const out = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'urdu', audioKey: key }, deps);
    expect(out).toMatchObject({ status: 'ok', scoring: 'started' });
    expect(deps.store.attachBlockMedia).toHaveBeenCalledWith({ sessionId: SESSION, block: 'urdu', audioR2Key: key, photoR2Key: undefined });
    expect(deps.store.recordTiming).toHaveBeenCalledWith(SESSION, 'urdu.audio_received', expect.any(Date));
    expect(deps.scoring.scoreBlock).toHaveBeenCalledWith({ sessionId: SESSION, block: 'urdu', grade: 3, form: 'A' });
  });

  test('maths is scored only once both the audio and the strip photo are in', async () => {
    const deps = makeDeps();
    const base = `child-test/sandbox/${SCHOOL}/${SESSION}`;
    const first = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'maths', audioKey: `${base}/maths.webm` }, deps);
    expect(first.scoring).toBe('waiting_for_photo');
    expect(deps.scoring.scoreBlock).not.toHaveBeenCalled();
    const second = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'maths', photoKey: `${base}/maths-strip.jpg` }, deps);
    expect(second.scoring).toBe('started');
    expect(deps.scoring.scoreBlock).toHaveBeenCalledTimes(1);
  });

  test('a scorer that throws is logged at error and never fails the upload', async () => {
    const deps = makeDeps();
    deps.scoring.scoreBlock.mockRejectedValueOnce(new Error('model down'));
    const out = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'english', audioKey: `child-test/sandbox/${SCHOOL}/${SESSION}/english.webm` }, deps);
    await new Promise((r) => setImmediate(r));
    expect(out.status).toBe('ok');
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('child_test.app.score_failed'), expect.objectContaining({ sessionId: SESSION, block: 'english' }));
  });

  test('a block already scored cannot take new media', async () => {
    const deps = makeDeps();
    deps.store.attachBlockMedia.mockResolvedValueOnce({ ok: false, alreadyScored: true });
    const out = await Svc.registerBlockMedia({ userId: COACH, sessionId: SESSION, block: 'urdu', audioKey: `child-test/sandbox/${SCHOOL}/${SESSION}/urdu.webm` }, deps);
    expect(out).toEqual({ status: 'invalid', reason: 'already_scored' });
  });
});

describe('the check', () => {
  const marks = {
    version: 'ai-marks-v1',
    story: { words_correct: 41, words_attempted: 45, seconds: 60, finished_early: false, confidence: 0.9,
      flagged: [{ idx: 3, word: 'w3', verdict: 'wrong', confidence: 0.8 }, { idx: 9, word: 'w9', verdict: 'skipped', confidence: 0.3 }] },
    fallback: null,
    questions: [{ id: 'u3A-q1', verdict: 'correct', heard: 'x', confidence: 0.85 }, { id: 'u3A-q2', verdict: 'wrong', heard: 'y', confidence: 0.4 }],
    first_sounds: [{ id: 'u3A-fs1', verdict: 'correct', heard: 'm', confidence: 0.9, hint_only: true }],
    nonwords: [{ id: 'u3A-nw1', verdict: 'wrong', heard: 'z', confidence: 0.6 }],
  };

  test('prefill keeps confident fields, empties the rest, and never pre-fills a hint-only field', () => {
    const pre = Svc.buildCheckPrefill(marks, { default: 0.7 });
    expect(pre.story.words_correct).toBe(41);
    expect(pre.story.flagged.map((f) => f.idx)).toEqual([3]);
    expect(pre.story.uncertain.map((f) => f.idx)).toEqual([9]);
    expect(pre.questions.map((q) => q.verdict)).toEqual(['correct', null]);
    expect(pre.first_sounds[0].verdict).toBeNull();
    expect(pre.first_sounds[0].hint).toBe('correct');
    expect(pre.nonwords[0].verdict).toBeNull();
  });

  test('diffMarks lists every leaf the coach changed with both values', () => {
    const coach = JSON.parse(JSON.stringify(marks));
    coach.story.words_correct = 39;
    coach.questions[1].verdict = 'correct';
    const edits = Svc.diffMarks(marks, coach);
    expect(edits).toEqual(expect.arrayContaining([
      { path: 'story.words_correct', ai: 41, coach: 39 },
      { path: 'questions.1.verdict', ai: 'wrong', coach: 'correct' },
    ]));
    expect(edits).toHaveLength(2);
  });

  test('submitCheck saves coach marks with the diff and completes the session when the last block is checked', async () => {
    const deps = makeDeps();
    for (const b of ['urdu', 'english', 'maths']) {
      deps._blocks[`${SESSION}:${b}`] = { session_id: SESSION, block: b, ai_marks: b === 'urdu' ? marks : { version: 'ai-marks-v1' }, ai_status: 'scored', checked_at: b === 'urdu' ? null : 'earlier' };
    }
    const coach = JSON.parse(JSON.stringify(marks));
    coach.story.words_correct = 40;
    const out = await Svc.submitCheck({ userId: COACH, sessionId: SESSION, block: 'urdu', coachMarks: coach }, deps);
    expect(out.status).toBe('ok');
    expect(deps.store.saveCoachMarks).toHaveBeenCalledWith({
      sessionId: SESSION, block: 'urdu', coachMarks: coach, coachEdits: [{ path: 'story.words_correct', ai: 41, coach: 40 }],
    });
    expect(deps.store.setSessionStatus).toHaveBeenCalledWith(SESSION, 'completed');
    expect(out.sessionCompleted).toBe(true);
  });

  test('prefill-only fields (hint, uncertain) sent back by a form are not stored as coach marks or edits', async () => {
    const deps = makeDeps();
    deps._blocks[`${SESSION}:urdu`] = { session_id: SESSION, block: 'urdu', ai_marks: marks, ai_status: 'scored', checked_at: null };
    const coach = JSON.parse(JSON.stringify(Svc.buildCheckPrefill(marks, { default: 0.7 })));
    coach.story.words_correct = 41;
    coach.story.flagged = marks.story.flagged;
    coach.questions[1].verdict = 'wrong';
    coach.first_sounds[0].verdict = 'correct';
    coach.nonwords[0].verdict = 'wrong';
    await Svc.submitCheck({ userId: COACH, sessionId: SESSION, block: 'urdu', coachMarks: coach }, deps);
    const saved = deps.store.saveCoachMarks.mock.calls[0][0];
    expect(JSON.stringify(saved.coachMarks)).not.toMatch(/"hint"|"uncertain"/);
    expect(saved.coachEdits).toEqual([]);
  });

  test('a block not yet marked by the AI cannot be checked', async () => {
    const deps = makeDeps();
    deps._blocks[`${SESSION}:urdu`] = { session_id: SESSION, block: 'urdu', ai_marks: null, ai_status: 'scoring' };
    const out = await Svc.submitCheck({ userId: COACH, sessionId: SESSION, block: 'urdu', coachMarks: {} }, deps);
    expect(out).toEqual({ status: 'not_ready', reason: 'not_scored' });
  });

  test('sessionStatus reports each block with its prefill', async () => {
    const deps = makeDeps();
    deps._blocks[`${SESSION}:urdu`] = { session_id: SESSION, block: 'urdu', audio_r2_key: 'k', ai_marks: marks, ai_status: 'scored', checked_at: null };
    const out = await Svc.sessionStatus({ userId: COACH, sessionId: SESSION }, deps);
    expect(out.status).toBe('ok');
    const urdu = out.blocks.find((b) => b.block === 'urdu');
    expect(urdu).toMatchObject({ hasAudio: true, aiStatus: 'scored', checked: false });
    expect(urdu.prefill.story.words_correct).toBe(41);
    expect(out.blocks.find((b) => b.block === 'english')).toMatchObject({ hasAudio: false, aiStatus: null });
  });
});

test('fixture bank is the trimmed v1 bank (sanity)', () => {
  expect(path.basename(require.resolve('./fixtures/mini-bank.json'))).toBe('mini-bank.json');
  expect(bank.version).toBe('child-test-items-v1');
});
