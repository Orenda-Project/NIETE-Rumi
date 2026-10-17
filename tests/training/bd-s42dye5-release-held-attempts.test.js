/**
 * bd-s42dye.5 — silently release the held I-SAPS written-answer (CRQ) results.
 *
 * Operator decisions (2026-10-17): the LLM CRQ grades are accepted. Flip
 * app_settings.isaps_crq_results_released AND backfill the attempts already
 * held (status 'pending_review'), from their existing grades. SILENT: no
 * WhatsApp to anyone.
 *
 * Proved here against an in-memory Supabase, with the LLM stubbed:
 *   - --apply refuses while the flag is still held (and says the SQL to run);
 *   - dry-run writes nothing and never calls the LLM;
 *   - a null-scored CRQ is re-scored through scoreAnswer and stored like the live path;
 *   - verdict + status/is_passed/score/cooldown writes match gradeAttempt's released path;
 *   - a certificate only when ALL nine module exams passed, and only one;
 *   - zero WhatsApp calls, and quiz-delivery (gradeAttempt / sendCongratulation) never loads;
 *   - idempotent re-run;
 *   - the project-ref assertion aborts on a mismatch.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockWa = {
  sendMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendInteractiveMessage: jest.fn(),
  sendDocument: jest.fn(), sendTemplate: jest.fn(), sendImage: jest.fn(),
};
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWa);
// The release must never go through gradeAttempt (it sends WhatsApp). Loading the
// module at all would be the smell, so make loading it an error.
jest.mock('../../bot/shared/services/training/quiz-delivery.service', () => {
  throw new Error('quiz-delivery.service must not be loaded by the release');
});
const mockPdf = jest.fn(async () => 'certs/fake.pdf');
jest.mock('../../bot/shared/services/training/certificate-pdf.service', () => ({
  generateAndStoreCertificatePdf: (...a) => mockPdf(...a),
}));

const fs = require('fs');
const path = require('path');

// ── a small in-memory Supabase (PostgREST-ish: maybeSingle errors on >1 row) ─
function makeDb(tables) {
  const calls = { writes: [] };
  function from(name) {
    if (!tables[name]) tables[name] = [];
    const q = { filters: [], op: 'select', payload: null, order: null, lim: null, rng: null, wantRows: false };
    const apply = rows => {
      let out = rows.filter(r => q.filters.every(f => f(r)));
      if (q.order) out = [...out].sort((a, b) => (a[q.order] > b[q.order] ? 1 : a[q.order] < b[q.order] ? -1 : 0));
      if (q.rng) out = out.slice(q.rng[0], q.rng[1] + 1);
      if (q.lim !== null) out = out.slice(0, q.lim);
      return out;
    };
    const exec = async () => {
      if (q.op === 'update') {
        const hit = tables[name].filter(r => q.filters.every(f => f(r)));
        hit.forEach(r => Object.assign(r, q.payload));
        calls.writes.push({ table: name, op: 'update', payload: q.payload, n: hit.length });
        return { data: q.wantRows ? hit.map(r => ({ ...r })) : null, error: null };
      }
      if (q.op === 'insert') {
        const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
        rows.forEach(r => tables[name].push({ ...r }));
        calls.writes.push({ table: name, op: 'insert', payload: q.payload });
        return { data: null, error: null };
      }
      return { data: apply(tables[name]).map(r => ({ ...r })), error: null };
    };
    const b = {
      select: () => { q.wantRows = true; return b; },
      eq: (c, v) => { q.filters.push(r => r[c] === v); return b; },
      neq: (c, v) => { q.filters.push(r => r[c] !== v); return b; },
      is: (c, v) => { q.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
      in: (c, vs) => { q.filters.push(r => vs.includes(r[c])); return b; },
      not: () => b,
      order: c => { q.order = c; return b; },
      limit: n => { q.lim = n; return b; },
      range: (a, z) => { q.rng = [a, z]; return b; },
      update: p => { q.op = 'update'; q.payload = p; return b; },
      insert: p => { q.op = 'insert'; q.payload = p; return b; },
      maybeSingle: async () => {
        const r = await exec();
        if (r.data && r.data.length > 1) return { data: null, error: { message: 'multiple rows' } };
        return { data: (r.data && r.data[0]) || null, error: r.error };
      },
      single: async () => { const r = await exec(); return { data: (r.data && r.data[0]) || null, error: r.error }; },
      then: (res, rej) => exec().then(res, rej),
    };
    return b;
  }
  return { from, calls, tables };
}

const VENDOR = { id: 'v', key: 'ISAPS', capstone_points_per_question: 10, cooldown_hours: 0, unlock_logic: 'all_modules', passing_pct: 60, module_passing_pct: 70 };
const EXAMS = Array.from({ length: 9 }, (_, i) => ({ id: 36 + i, level_id: 27, source_quiz_id: 901 + i, quiz_type: 'grand_quiz', is_active: true }));
const FLAG_ON = { key: 'isaps_crq_results_released', value: true };

/** MCQs: n correct of 4; the CRQ last (index 4). */
function paper(attemptId, { mcqRight = 4, crq = 8, crqText = 'my answer' } = {}) {
  const rows = [0, 1, 2, 3].map(i => ({ attempt_id: attemptId, question_index: i, question_id: 100 + i, is_correct: i < mcqRight, answer_text: null, answer_score: null, feedback_text: null }));
  rows.push({ attempt_id: attemptId, question_index: 4, question_id: 900, is_correct: null, answer_text: crqText, answer_score: crq, feedback_text: crq === null ? null : 'fb' });
  return rows;
}
const heldAttempt = (id, userId, examIdx) => ({
  id, user_id: userId, level_id: 27, program_id: 'p1', grand_quiz_id: EXAMS[examIdx].id, quiz_kind: 'grand',
  total_questions: 5, score: 20, status: 'pending_review', is_passed: null, cooldown_until: null, completed_at: '2026-10-05T00:00:00Z',
});

function seed({ flag = true, vendor = VENDOR, users = {} } = {}) {
  const attempts = []; const answers = [];
  for (const [uid, spec] of Object.entries(users)) {
    spec.exams.forEach((e, k) => {
      const id = `${uid}-e${k}`;
      attempts.push(heldAttempt(id, uid, k));
      answers.push(...paper(id, e));
    });
  }
  return makeDb({
    app_settings: flag ? [{ ...FLAG_ON }] : [],
    training_assessment_attempts: attempts,
    training_assessment_answers: answers,
    training_grand_quizzes: EXAMS.map(e => ({ ...e })),
    training_levels: [{ id: 27, name: 'Level 1: Novice', vendor_id: 'v', order_index: 0 }],
    training_vendors: [{ ...vendor }],
    training_questions: [{ id: 900, question_text: 'Explain X', rubric: { total_marks: 10, criteria: [] } }],
    training_certificates: [],
    users: Object.keys(users).map(id => ({ id, name: `Teacher ${id}` })),
  });
}
const passing = () => ({ mcqRight: 3, crq: 6 });       // 3/4 MCQs + 6/10 CRQ → both bars cleared
const allNine = (over = {}) => Array.from({ length: 9 }, () => ({ ...passing(), ...over }));

let Release;
let scoreAnswer;
beforeEach(() => {
  jest.clearAllMocks();
  Release = require('../../bot/shared/services/training/isaps-held-release.service');
  scoreAnswer = jest.fn(async () => ({ score: 7, feedback: 'Re-scored feedback' }));
});
const attemptsOf = db => db.tables.training_assessment_attempts;

describe('the flag pre-check', () => {
  test('--apply refuses while the flag is held, prints the SQL, and writes nothing', async () => {
    const db = seed({ flag: false, users: { u1: { exams: allNine() } } });
    await expect(Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer }))
      .rejects.toMatchObject({ code: 'FLAG_STILL_HELD' });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer }).catch(e => {
      expect(e.message).toContain("insert into public.app_settings");
      expect(e.message).toContain("isaps_crq_results_released");
    });
    expect(db.calls.writes).toHaveLength(0);
    expect(attemptsOf(db).every(a => a.status === 'pending_review')).toBe(true);
  });
  test('a string "true" is still held (only JSON true or {released:true} releases)', async () => {
    const db = seed({ users: { u1: { exams: allNine() } } });
    db.tables.app_settings = [{ key: 'isaps_crq_results_released', value: 'true' }];
    await expect(Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer }))
      .rejects.toMatchObject({ code: 'FLAG_STILL_HELD' });
  });
  test('dry-run is allowed while held (that is when the operator wants the counts)', async () => {
    const db = seed({ flag: false, users: { u1: { exams: allNine() } } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: false, scoreAnswer });
    expect(s.flag_held).toBe(true);
    expect(s.attempts_seen).toBe(9);
  });
});

describe('dry-run', () => {
  test('writes nothing, never calls the LLM, counts what it would do', async () => {
    const db = seed({ users: {
      u1: { exams: allNine() },
      u2: { exams: [{ ...passing(), crq: null }, ...allNine().slice(1)] },     // one null-scored
      u3: { exams: [{ mcqRight: 4, crq: 3 }] },                                 // CRQ under 60% → fails
    } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: false, scoreAnswer });
    expect(db.calls.writes).toHaveLength(0);
    expect(scoreAnswer).not.toHaveBeenCalled();
    expect(s).toMatchObject({ mode: 'dry-run', attempts_seen: 19, would_rescore: 1, rescored: 0 });
    expect(s.passed).toBe(17);            // projected from the stored grades
    expect(s.failed).toBe(1);             // u3
    expect(s.unknown_pending_rescore).toBe(1);
    expect(s.users_certifiable_min).toBe(1);   // u1 only (u2 needs its re-score)
    expect(s.users_certifiable_max).toBe(2);   // u2 if its re-score passes
    expect(attemptsOf(db).every(a => a.status === 'pending_review')).toBe(true);
  });
});

describe('apply — verdicts and writes match the live released path', () => {
  test('passed: status passed, is_passed true, score in marks, no cooldown', async () => {
    const db = seed({ users: { u1: { exams: [{ mcqRight: 3, crq: 6 }] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(attemptsOf(db)[0]).toMatchObject({ status: 'passed', is_passed: true, score: 21, cooldown_until: null });
  });
  test('failed on the CRQ bar: status failed, is_passed false, cooldown follows the vendor (0 → null)', async () => {
    const db = seed({ users: { u1: { exams: [{ mcqRight: 4, crq: 5 }] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(attemptsOf(db)[0]).toMatchObject({ status: 'failed', is_passed: false, score: 25, cooldown_until: null });
  });
  test('failed with a 24h vendor cooldown writes an ISO cooldown_until', async () => {
    const db = seed({ vendor: { ...VENDOR, cooldown_hours: 24 }, users: { u1: { exams: [{ mcqRight: 4, crq: 5 }] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(typeof attemptsOf(db)[0].cooldown_until).toBe('string');
    expect(new Date(attemptsOf(db)[0].cooldown_until).getTime()).toBeGreaterThan(Date.now());
  });
  test('the verdict is exactly decideIsapsModuleExamPass over scoreMixedPaper (boundary: 60% CRQ, 75% MCQ)', async () => {
    const db = seed({ users: { u1: { exams: [{ mcqRight: 3, crq: 6 }, { mcqRight: 2, crq: 10 }, { mcqRight: 4, crq: 5.9 }] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(attemptsOf(db).map(a => a.is_passed)).toEqual([true, false, false]);
  });
  test('completed_at is left alone (the sitting finished when it finished)', async () => {
    const db = seed({ users: { u1: { exams: [passing()] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(attemptsOf(db)[0].completed_at).toBe('2026-10-05T00:00:00Z');
  });
});

describe('apply — a null-scored CRQ is re-scored through scoreAnswer', () => {
  test('stores answer_score + feedback_text like the live path, then decides on the new mark', async () => {
    const db = seed({ users: { u1: { exams: [{ mcqRight: 4, crq: null }] } } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(scoreAnswer).toHaveBeenCalledTimes(1);
    const [q, text, perAnswer] = scoreAnswer.mock.calls[0];
    expect(q).toMatchObject({ id: 900, question_text: 'Explain X' });
    expect(q.rubric).toBeTruthy();
    expect(text).toBe('my answer');
    expect(perAnswer).toBe(10);
    const row = db.tables.training_assessment_answers.find(r => r.attempt_id === 'u1-e0' && r.question_index === 4);
    expect(row).toMatchObject({ answer_score: 7, feedback_text: 'Re-scored feedback' });
    expect(attemptsOf(db)[0]).toMatchObject({ status: 'passed', is_passed: true, score: 27 });
    expect(s.rescored).toBe(1);
  });
  test('a failed re-score is an error with the attempt id, left pending (never written failed)', async () => {
    const db = seed({ users: { u1: { exams: [{ mcqRight: 4, crq: null }, passing()] } } });
    scoreAnswer.mockRejectedValueOnce(new Error('llm down'));
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(s.errors).toEqual([expect.objectContaining({ attempt_id: 'u1-e0', message: expect.stringMatching(/llm down/) })]);
    expect(attemptsOf(db)[0].status).toBe('pending_review');
    expect(attemptsOf(db)[1].status).toBe('passed');
  });
});

describe('apply — the certificate', () => {
  test('issued through the guard once, only when all nine module exams passed', async () => {
    const db = seed({ users: { full: { exams: allNine() }, eight: { exams: allNine().slice(0, 8) } } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    const certs = db.tables.training_certificates;
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ user_id: 'full', level_id: 27 });
    expect(mockPdf).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ users_certified: 1, certificate_rows_created: 1 });
  });
  test('a user with one failed module exam is not certified', async () => {
    const exams = allNine(); exams[3] = { mcqRight: 1, crq: 9 };
    const db = seed({ users: { u1: { exams } } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(db.tables.training_certificates).toHaveLength(0);
    expect(s.users_certified).toBe(0);
  });
  test('a teacher who already holds the level certificate does not get a second', async () => {
    const db = seed({ users: { u1: { exams: allNine() } } });
    db.tables.training_certificates.push({ user_id: 'u1', level_id: 27, certificate_code: 'OLD' });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(db.tables.training_certificates).toHaveLength(1);
  });
});

describe('--only-users (the sandbox proof must not touch another tester)', () => {
  test('only the listed users are resolved and certified; the rest stay pending', async () => {
    const db = seed({ users: { mine: { exams: allNine() }, theirs: { exams: allNine() } } });
    const s = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer, onlyUserIds: ['mine'] });
    expect(s.attempts_seen).toBe(9);
    expect(attemptsOf(db).filter(a => a.user_id === 'theirs').every(a => a.status === 'pending_review')).toBe(true);
    expect(db.tables.training_certificates.map(c => c.user_id)).toEqual(['mine']);
  });
});

describe('silence', () => {
  test('zero WhatsApp calls across a full apply', async () => {
    const db = seed({ users: { full: { exams: allNine() }, x: { exams: [{ mcqRight: 1, crq: 9 }] } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    for (const fn of Object.values(mockWa)) expect(fn).not.toHaveBeenCalled();
  });
  test('neither the service nor the script can reach gradeAttempt / sendCongratulation (comments stripped)', () => {
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files = [
      '../../bot/shared/services/training/isaps-held-release.service.js',
      '../../scripts/release-isaps-held-attempts.js',
    ].map(f => strip(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(files.every(Boolean)).toBe(true);
    for (const src of files) {
      expect(src).not.toMatch(/gradeAttempt|sendCongratulation|quiz-delivery|whatsapp\.service|WhatsAppService|sendMessage/);
    }
  });
});

describe('idempotency', () => {
  test('a second apply finds 0 pending_review rows and issues nothing more', async () => {
    const db = seed({ users: { u1: { exams: allNine() } } });
    await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    const writesAfterFirst = db.calls.writes.length;
    const s2 = await Release.releaseHeldAttempts({ supabase: db, apply: true, scoreAnswer });
    expect(s2).toMatchObject({ attempts_seen: 0, passed: 0, failed: 0, users_certified: 0, certificate_rows_created: 0 });
    expect(db.calls.writes).toHaveLength(writesAfterFirst);
    expect(db.tables.training_certificates).toHaveLength(1);
  });
});

describe('the CLI guards', () => {
  const Cli = require('../../scripts/release-isaps-held-attempts');
  test('the three refs are the documented ones', () => {
    expect(Cli.TARGET_REFS).toEqual({
      sandbox: 'olvritwoqujtjvwfulbh', staging: 'rpqkekcfvumypldbejhp', prod: 'ihzciabopbttygxxgrkm',
    });
  });
  test('ref mismatch aborts BEFORE any connection', () => {
    expect(() => Cli.assertTargetRef('sandbox', 'https://ihzciabopbttygxxgrkm.supabase.co'))
      .toThrow(/ihzciabopbttygxxgrkm.*sandbox|sandbox.*olvritwoqujtjvwfulbh/);
    expect(() => Cli.assertTargetRef('prod', 'https://olvritwoqujtjvwfulbh.supabase.co')).toThrow();
    expect(() => Cli.assertTargetRef('prod', undefined)).toThrow();
    expect(() => Cli.assertTargetRef('prod', 'https://ihzciabopbttygxxgrkm.supabase.co')).not.toThrow();
  });
  test('the service-role key must be for the same project too', () => {
    const jwt = ref => `h.${Buffer.from(JSON.stringify({ ref, role: 'service_role' })).toString('base64url')}.s`;
    expect(() => Cli.assertKeyRef('prod', jwt('olvritwoqujtjvwfulbh'))).toThrow();
    expect(() => Cli.assertKeyRef('prod', jwt('ihzciabopbttygxxgrkm'))).not.toThrow();
  });
  test('dry-run is the default; --apply must be explicit; --target is required and validated', () => {
    expect(Cli.parseArgs(['--target', 'prod'])).toMatchObject({ target: 'prod', apply: false });
    expect(Cli.parseArgs(['--target', 'sandbox', '--apply'])).toMatchObject({ apply: true });
    expect(Cli.parseArgs(['--target', 'sandbox', '--dry-run'])).toMatchObject({ apply: false });
    expect(Cli.parseArgs(['--target', 'sandbox', '--only-users', 'a,b'])).toMatchObject({ onlyUsers: ['a', 'b'] });
    expect(() => Cli.parseArgs([])).toThrow(/--target/);
    expect(() => Cli.parseArgs(['--target', 'dev'])).toThrow(/--target/);
    expect(() => Cli.parseArgs(['--target', 'prod', '--apply', '--dry-run'])).toThrow();
  });
});
