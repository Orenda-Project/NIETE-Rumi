/**
 * bd-w2daa.8 — Teacher Training: fewer bubbles, same words.
 *
 * From 1 Oct 2026 Meta bills every message we send. Several training sends
 * were a bubble of their own carrying a line that fits on the very next
 * bubble, so the teacher paid (in our bill) for a split nobody needed. Each
 * case below drives the REAL service functions — only the network boundary is
 * mocked (WhatsApp Graph sends, R2 presign/download, the LLM, certificate
 * ISSUANCE) — and pins two things together:
 *
 *   1. the exact billed sends, in order (count + type), and
 *   2. that every line the teacher used to read is still there, in order.
 *
 * NT1  the per-question verdict rides on the next question's header (the free
 *      ✅/❌ reaction still goes out); on the last answer it opens the result.
 * NT2  the module-check intro rides on Q1.
 * NT3  "Module check — passed" rides on whatever comes next;
 *      "Loading the next module…" is dropped (the module is in the same bubble).
 * NT4  module card + its buttons in one message (video); PDF caption on the
 *      document; fail text + retry buttons in one; capstone score + next
 *      question in one; congratulation as the certificate's caption; the
 *      Beacon House level-complete text no longer duplicates the exam offer.
 *
 * Every merge has a cap, and every cap has a fallback to today's separate
 * messages — the fallbacks are pinned here too.
 */

const PHONE = 'phone-under-test';
const UID = 'u-teacher';
const WAMID = 'wamid.THEIR_TAP';
const ATTEMPT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ─── in-memory Supabase ──────────────────────────────────────────────────────
let tables;
function from(name) {
  const rows = () => (tables[name] = tables[name] || []);
  const q = { filters: [], count: false, mut: null, limitN: null, orders: [] };
  const match = (r) => q.filters.every(f => f(r));
  const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b));
  const c = {};
  c.select = (_cols, opts) => { if (opts && opts.count === 'exact' && opts.head) q.count = true; return c; };
  c.eq = (col, v) => { q.filters.push(r => same(r[col], v)); return c; };
  c.neq = (col, v) => { q.filters.push(r => !same(r[col], v)); return c; };
  c.in = (col, vs) => { q.filters.push(r => (vs || []).some(v => same(r[col], v))); return c; };
  c.is = (col, v) => { q.filters.push(r => (v === null ? r[col] == null : r[col] === v)); return c; };
  c.ilike = (col, pat) => {
    const re = new RegExp('^' + String(pat).split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    q.filters.push(r => re.test(String(r[col] ?? '')));
    return c;
  };
  ['not', 'gt', 'gte', 'lt', 'lte', 'filter', 'range'].forEach(m => { c[m] = () => c; });
  c.order = (col, opts) => { q.orders.push([col, !opts || opts.ascending !== false]); return c; };
  c.limit = (n) => { q.limitN = n; return c; };
  c.insert = (v) => {
    const ins = (Array.isArray(v) ? v : [v]).map((x, i) => ({ id: x.id ?? `${name}-${rows().length + i + 1}`, ...x }));
    rows().push(...ins);
    q.mut = { op: 'write', rows: ins };
    return c;
  };
  c.upsert = (v, opts) => {
    const keys = String((opts && opts.onConflict) || 'id').split(',');
    const out = [];
    for (const x of (Array.isArray(v) ? v : [v])) {
      const hit = rows().find(r => keys.every(k => same(r[k], x[k])));
      if (hit) { Object.assign(hit, x); out.push(hit); } else { const n = { ...x }; rows().push(n); out.push(n); }
    }
    q.mut = { op: 'write', rows: out };
    return c;
  };
  c.update = (patch) => { q.mut = { op: 'update', patch }; return c; };
  const resolve = (single) => {
    if (q.mut && q.mut.op === 'update') {
      const hit = rows().filter(match);
      hit.forEach(r => Object.assign(r, q.mut.patch));
      q.mut = { op: 'write', rows: hit };
    }
    if (q.mut) return { data: single ? (q.mut.rows[0] || null) : q.mut.rows, error: null };
    let out = rows().filter(match);
    for (const [col, asc] of [...q.orders].reverse()) {
      out = [...out].sort((a, b) => ((a[col] ?? 0) > (b[col] ?? 0) ? 1 : (a[col] ?? 0) < (b[col] ?? 0) ? -1 : 0) * (asc ? 1 : -1));
    }
    if (q.limitN) out = out.slice(0, q.limitN);
    if (q.count) return { count: out.length, data: null, error: null };
    return { data: single ? (out[0] || null) : out, error: null };
  };
  c.single = async () => resolve(true);
  c.maybeSingle = async () => resolve(true);
  c.then = (res, rej) => Promise.resolve(resolve(false)).then(res, rej);
  return c;
}

// ─── the network boundary ───────────────────────────────────────────────────
let sends;      // every outbound call, in order: { kind, billed, ... }
let wa;
let r2;
let cert;
let llmCreate;
const billed = () => sends.filter(s => s.billed);
const kinds = () => billed().map(s => s.kind);
const textOf = (s) => s.text ?? s.body ?? s.caption ?? '';

/** Assert `needles` all appear in `hay`, in this order. */
function expectInOrder(hay, needles) {
  let at = -1;
  for (const n of needles) {
    const i = String(hay).indexOf(n, at + 1);
    if (i < 0) throw new Error(`expected ${JSON.stringify(n)} after index ${at} in:\n${hay}`);
    at = i;
  }
}

beforeEach(() => {
  jest.resetModules();
  tables = {};
  sends = [];
  delete process.env.TRAINING_MSQ_FLOW_ID;
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
  ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'exceljs', 'pdfkit', 'bullmq', 'aws-sdk']
    .forEach(m => jest.doMock(m, () => ({}), { virtual: true }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: jest.fn(), getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../../bot/shared/config/supabase', () => ({ from, rpc: jest.fn(async () => ({ data: null, error: null })) }));

  const rec = (entry, ok = true) => { sends.push(entry); return ok; };
  wa = {
    sendMessage: jest.fn(async (_to, text) => rec({ kind: 'text', billed: true, text })),
    sendInteractiveButtons: jest.fn(async (_to, o) => rec({ kind: 'buttons', billed: true, body: o.body, buttons: o.buttons.map(b => b.title), ids: o.buttons.map(b => b.id) })),
    sendInteractiveMessage: jest.fn(async (_to, o) => rec({
      kind: 'list', billed: true, header: o.header && (o.header.text || o.header), body: o.body.text || o.body,
      footer: o.footer && (o.footer.text || o.footer),
    })),
    sendFlow: jest.fn(async (_to, o) => rec({ kind: 'flow', billed: true, header: o.header, body: o.body })),
    sendReaction: jest.fn(async (_to, id, emoji) => rec({ kind: 'reaction', billed: false, id, emoji })),
    sendDocumentByLink: jest.fn(async (_to, url, filename, caption) => rec({ kind: 'doc', billed: true, url, filename, caption })),
    sendDocumentFromUrl: jest.fn(async (_to, url, filename, caption) => rec({ kind: 'doc', billed: true, url, filename, caption })),
    sendImageFromUrl: jest.fn(async (_to, url, caption) => rec({ kind: 'image', billed: true, url, caption })),
  };
  jest.doMock('../../bot/shared/services/whatsapp.service', () => wa);

  r2 = {
    getPresignedUrl: jest.fn(async (url) => `https://r2.example/signed/${String(url).split('/').pop()}?X-Amz-Signature=abc`),
    buildR2PublicUrl: jest.fn((key) => `https://r2.example/public/${key}`),
  };
  jest.doMock('../../bot/shared/storage/r2', () => r2);

  // Certificate ISSUANCE writes rows and renders a PDF — a boundary these
  // tests do not exercise. DELIVERY (certificate-pdf.service) stays real: the
  // caption it is handed is the seam under test.
  cert = {
    issueCertificate: jest.fn(async () => ({
      certificate_code: 'NIETE-20261001-ABC123', teacher_name: 'Asma', level_name: 'Teacher Leader',
      pdf_r2_key: 'certs/u/NIETE-20261001-ABC123.pdf',
    })),
    maybeIssueQuizScoreCertificate: jest.fn(async () => ({ issued: false })),
  };
  jest.doMock('../../bot/shared/services/training/certificate.service', () => cert);

  llmCreate = jest.fn(async () => ({ choices: [{ message: { content: '{"score": 4, "feedback": "Good grounding in classroom practice."}' } }] }));
  jest.doMock('../../bot/shared/services/llm-client', () => ({
    getClient: () => ({ chat: { completions: { create: llmCreate } } }),
    getDefaultModel: () => 'test-model',
  }));
});
afterEach(() => { jest.resetModules(); delete process.env.TRAINING_MSQ_FLOW_ID; });

const Quiz = () => require('../../bot/shared/services/training/quiz-delivery.service');
const Content = () => require('../../bot/shared/services/training/content-delivery.service');
const Capstone = () => require('../../bot/shared/services/training/capstone-delivery.service');

// ─── fixtures ───────────────────────────────────────────────────────────────
//
// A NIETE-shaped level: one course, module 101 (being checked) then 102 (next).
function seedLevel({
  vendorKey = 'TALEEMABAD', unlock = 'chain', modulePct = 100,
  next = 'video',          // 'video' | 'pdf' | 'none'
  moduleQuestions = 2,
  questionText = (i) => `Q${i} text?`,
  multiAt = null,          // 1-based index of a multi-answer question
} = {}) {
  tables.users = [{ id: UID, name: 'Asma', phone_number: PHONE }];
  tables.teacher_training_assignments = [{ user_id: UID, program_id: 'p1', is_active: true }];
  tables.training_vendors = [{
    id: 'v1', key: vendorKey, unlock_logic: unlock, passing_pct: 80, module_passing_pct: modulePct,
    shuffle_options: false, cooldown_hours: 24,
  }];
  tables.training_levels = [{ id: 4, name: 'Teacher Leader', order_index: 3, vendor_id: 'v1', is_active: true }];
  tables.training_courses = [{ id: 1, level_id: 4, title: 'Classroom Basics', order_index: 1, is_active: true }];
  const mods = [{ id: 101, course_id: 1, title: 'Wait time', order_index: 1, is_active: true, video_url: 'https://x.r2.cloudflarestorage.com/v/101.mp4' }];
  if (next === 'video') mods.push({ id: 102, course_id: 1, title: 'Cold calling', order_index: 2, is_active: true, video_url: 'https://x.r2.cloudflarestorage.com/v/102.mp4' });
  if (next === 'pdf') mods.push({ id: 102, course_id: 1, title: 'Seating plans', order_index: 2, is_active: true, video_url: null, source_media_url: 'https://bucket.s3.amazonaws.com/seating.pdf' });
  tables.training_modules = mods;
  tables.teacher_training_progress = [];
  tables.training_questions = Array.from({ length: moduleQuestions }, (_, i) => ({
    id: 1000 + i, training_module_id: 101, grand_quiz_id: null, order_index: i, is_active: true,
    question_text: questionText(i + 1),
    options: ['Alpha', 'Beta', 'Gamma'],
    correct_option: multiAt === i + 1 ? '1,2' : '2',
    bloom_level: 'apply',
  }));
  // the next module carries a quiz too, so its button reads "📝 Take quiz"
  tables.training_questions.push({ id: 2000, training_module_id: 102, order_index: 0, is_active: true, question_text: 'Next?', options: ['a', 'b'], correct_option: '1' });
  tables.training_assessment_answers = [];
  tables.training_assessment_attempts = [];
  tables.training_grand_quizzes = [];
}

/** An in-progress module-check attempt sitting on question `idx` (0-based). */
function seedAttempt({ idx = 0, total = 2, answeredCorrect = idx } = {}) {
  tables.training_assessment_attempts.push({
    id: ATTEMPT, user_id: UID, program_id: 'p1', quiz_kind: 'training_module', grand_quiz_id: null,
    training_module_id: 101, level_id: 4, current_question_index: idx, total_questions: total,
    total_score: total, status: 'in_progress', started_at: '2026-10-01T00:00:00Z',
  });
  for (let i = 0; i < idx; i++) {
    tables.training_assessment_answers.push({
      attempt_id: ATTEMPT, question_index: i, question_id: 1000 + i,
      chosen_option: i < answeredCorrect ? '2' : '3', is_correct: i < answeredCorrect,
    });
  }
}

const tap = (option, messageId = WAMID) =>
  Quiz().handleQuizButton(UID, `training_quiz_${ATTEMPT}_${option}`, PHONE, messageId);

// ═════════════════════════════ NT1 ═════════════════════════════════════════
describe('NT1 — the verdict rides on the next question (reaction unchanged)', () => {
  it('right answer, mid-check: ONE billed send — the next question, headed "✅ Correct · Q2/2"', async () => {
    seedLevel(); seedAttempt({ idx: 0 });
    await tap(2);
    expect(kinds()).toEqual(['list']);
    expect(billed()[0].header).toBe('✅ Correct · Q2/2');
    expect(billed()[0].body).toContain('Q2 text?');
    expect(wa.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '✅');
  });

  it('wrong answer, mid-check: headed "✗ Not correct · Q2/2", reaction ❌', async () => {
    seedLevel(); seedAttempt({ idx: 0 });
    await tap(3);
    expect(kinds()).toEqual(['list']);
    expect(billed()[0].header).toBe('✗ Not correct · Q2/2');
    expect(wa.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '❌');
  });

  it('no inbound message id → no reaction, but the header still carries the verdict (signal never dropped)', async () => {
    seedLevel(); seedAttempt({ idx: 0 });
    await tap(2, null);
    expect(wa.sendReaction).not.toHaveBeenCalled();
    expect(kinds()).toEqual(['list']);
    expect(billed()[0].header).toBe('✅ Correct · Q2/2');
  });

  it('the header stays inside Meta\'s 60-code-point cap at the widest verdict', async () => {
    seedLevel({ moduleQuestions: 10 }); seedAttempt({ idx: 8, total: 10 });
    await tap(3);
    expect(billed()[0].header).toBe('✗ Not correct · Q10/10');
    expect([...billed()[0].header].length).toBeLessThanOrEqual(60);
  });

  it('next question on the Flow surface: the Flow header carries the verdict', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = '1583240000000000';
    seedLevel({ multiAt: 2 }); seedAttempt({ idx: 0 });
    await tap(2);
    expect(kinds()).toEqual(['flow']);
    expect(billed()[0].header).toBe('✅ Correct · Q2/2');
  });

  it('answer submitted through the Flow: the next question still carries the verdict', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = '1583240000000000';
    seedLevel(); seedAttempt({ idx: 0 });
    await Quiz().handleQuizFlowSubmission(UID, { attempt_ref: `${ATTEMPT}:0`, selected_option: '3' }, PHONE, WAMID);
    expect(kinds()).toEqual(['list']);
    expect(billed()[0].header).toBe('✗ Not correct · Q2/2');
    expect(wa.sendReaction).toHaveBeenCalledWith(PHONE, WAMID, '❌');
  });

  it('next question refused by Meta → the "couldn\'t display" text says the verdict too', async () => {
    seedLevel(); seedAttempt({ idx: 0 });
    wa.sendInteractiveMessage.mockImplementationOnce(async () => false);
    await tap(2);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['✅ *Correct*', "I couldn't display that question just now"]);
  });

  it('last answer, failed check: the verdict opens the result — one billed send', async () => {
    seedLevel(); seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(3);
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, ['✗ *Not correct.*', '📝 *Module check — not quite.*']);
  });

  it('last answer on a level exam: the verdict opens the result text', async () => {
    seedLevel();
    tables.training_grand_quizzes.push({ id: 40, level_id: 4, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 1 });
    tables.training_questions.push(
      { id: 3000, grand_quiz_id: 40, order_index: 0, is_active: true, question_text: 'E1?', options: ['a', 'b'], correct_option: '1' },
      { id: 3001, grand_quiz_id: 40, order_index: 1, is_active: true, question_text: 'E2?', options: ['a', 'b'], correct_option: '1' },
    );
    tables.training_assessment_attempts.push({
      id: ATTEMPT, user_id: UID, program_id: 'p1', quiz_kind: 'grand', grand_quiz_id: 40, training_module_id: null,
      level_id: 4, current_question_index: 1, total_questions: 2, total_score: 2, status: 'in_progress',
    });
    tables.training_assessment_answers.push({ attempt_id: ATTEMPT, question_index: 0, question_id: 3000, chosen_option: '2', is_correct: false });
    await tap(2);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['✗ *Not correct.*', '❌ *Not this time.*']);
  });
});

// ═════════════════════════════ NT2 ═════════════════════════════════════════
describe('NT2 — the module-check intro rides on Q1', () => {
  it('a new check is ONE billed send: Q1 headed "Module check · Q1/2", the intro opening its body', async () => {
    seedLevel();
    await Quiz().startTrainingQuiz(UID, 101, PHONE);
    expect(kinds()).toEqual(['list']);
    const q1 = billed()[0];
    expect(q1.header).toBe('Module check · Q1/2');
    expectInOrder(q1.body, [
      '📝 *Module check — "Wait time"*',
      '2 questions. You need *100%* to unlock the next module — if you miss it you can retry straight away.',
      'Q1 text?',
    ]);
    expect(q1.footer).toBe('100% required · tap an option');
  });

  it('intro + question over the 1024 body cap → today\'s two messages, intro first', async () => {
    seedLevel({ moduleQuestions: 1, questionText: () => `${'long question '.repeat(70)}?` });
    await Quiz().startTrainingQuiz(UID, 101, PHONE);
    expect(kinds()).toEqual(['text', 'list']);
    expect(billed()[0].text).toContain('📝 *Module check — "Wait time"*');
    expect(billed()[1].header).toBe('Q1/1');
    expect(billed()[1].body).not.toContain('Module check');
  });

  it('Q1 on the Flow surface (multi-answer): the intro opens the Flow body', async () => {
    process.env.TRAINING_MSQ_FLOW_ID = '1583240000000000';
    seedLevel({ multiAt: 1 });
    await Quiz().startTrainingQuiz(UID, 101, PHONE);
    expect(kinds()).toEqual(['flow']);
    expect(billed()[0].header).toBe('Module check · Q1/2');
    expectInOrder(billed()[0].body, ['📝 *Module check — "Wait time"*', 'Q1 text?']);
  });

  it('a resumed check sends no intro (unchanged)', async () => {
    seedLevel(); seedAttempt({ idx: 1, answeredCorrect: 1 });
    await Quiz().startTrainingQuiz(UID, 101, PHONE);
    expect(kinds()).toEqual(['list']);
    expect(billed()[0].header).toBe('Q2/2');
  });
});

// ═════════════════════════════ NT3 ═════════════════════════════════════════
describe('NT3 — "passed" rides on what comes next; "Loading the next module…" dropped', () => {
  it('pass → next VIDEO module: ONE billed send carrying verdict, pass line, module card, link and buttons', async () => {
    seedLevel({ next: 'video' }); seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    expect(kinds()).toEqual(['buttons']);
    const card = billed()[0];
    expectInOrder(card.body, [
      '✅ *Correct*',
      '📝 *Module check — passed.*',
      'Nice — *2/2* correct. Perfect score! ✨',
      '📘 *Classroom Basics* — 2 of 2',
      '*Cold calling*',
      'Watch the video, then tap 📝 Take quiz',
      '▶️ https://r2.example/signed/102.mp4',
      'Finished watching "Cold calling"?',
    ]);
    expect(card.body).not.toContain('Loading the next module');
    expect(card.buttons).toEqual(['📝 Take quiz', '⏸ Pause']);
    expect(card.ids).toEqual(['training_module_done_102', 'training_pause']);
  });

  it('pass → next PDF module: the pass line opens the document caption (2 billed, was 5)', async () => {
    seedLevel({ next: 'pdf' }); seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    expect(kinds()).toEqual(['doc', 'buttons']);
    expectInOrder(billed()[0].caption, [
      '✅ *Correct*', '📝 *Module check — passed.*', '📘 *Classroom Basics* — 2 of 2', '*Seating plans*', 'Read the PDF',
    ]);
    expect(billed()[0].filename).toBe('Seating plans.pdf');
    expect(billed()[1].body).toBe('Finished reading "Seating plans"?');
  });

  it('pass → level complete: one text — verdict, pass line, "every module … complete"', async () => {
    seedLevel({ next: 'none' }); seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['✅ *Correct*', '📝 *Module check — passed.*', "🎉 That's every module in this level complete."]);
    expect(billed()[0].text).not.toContain('Loading the next module');
  });

  it('pass → I-SAPS module exam offer: the pass line opens the offer', async () => {
    seedLevel({ vendorKey: 'ISAPS', unlock: 'chain_per_course', modulePct: 70, next: 'none' });
    tables.training_courses[0].title = 'Module 1: Foundations';
    tables.training_grand_quizzes.push({ id: 77, level_id: 4, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 901 });
    tables.training_questions.push({ id: 4000, grand_quiz_id: 77, order_index: 0, is_active: true, question_text: 'S?', options: ['a', 'b'], correct_option: '1' });
    seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, ['✅ *Correct*', '📝 *Module check — passed.*', 'Module 1: Foundations']);
    expect(billed()[0].buttons).toEqual(['📝 Take the exam']);
  });

  it('pass + quiz-score certificate: pass line and congratulation ride on the certificate PDF; next step after it', async () => {
    seedLevel({ vendorKey: 'OXBRIDGE', unlock: 'all_modules', modulePct: 70, next: 'none' });
    cert.maybeIssueQuizScoreCertificate.mockResolvedValue({
      issued: true, teacher_name: 'Asma', level_name: 'Session Pack', certificate_code: 'NIETE-20261001-OXB001',
      pdf_r2_key: 'certs/u/NIETE-20261001-OXB001.pdf',
    });
    seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    expect(kinds()).toEqual(['doc', 'text']);
    expectInOrder(billed()[0].caption, [
      '✅ *Correct*', '📝 *Module check — passed.*', '🏆 *Congratulations, Asma!*', 'Certificate code: `NIETE-20261001-OXB001`',
    ]);
    expect(billed()[1].text).toContain("That's every module in this level complete.");
    expect(billed()[1].text).not.toContain('Module check — passed');
  });
});

// ═════════════════════════════ NT4 ═════════════════════════════════════════
describe('NT4 — module delivery, fail + retry, capstone, certificates, level-complete dedupe', () => {
  it('T04 video module (opened from the Flow): ONE buttons message — caption, link, "Finished watching?"', async () => {
    seedLevel();
    await Content().deliverModuleById(102, PHONE, { userId: UID });
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, [
      '📘 *Classroom Basics* — 2 of 2', '*Cold calling*', 'Watch the video, then tap 📝 Take quiz',
      '▶️ https://r2.example/signed/102.mp4', 'Finished watching "Cold calling"?',
    ]);
  });

  it('T04 over the 1024 body cap → today\'s caption+link text, then the buttons', async () => {
    seedLevel();
    r2.getPresignedUrl.mockResolvedValue(`https://r2.example/signed/102.mp4?X-Amz-Signature=${'f'.repeat(1000)}`);
    await Content().deliverModuleById(102, PHONE, { userId: UID });
    expect(kinds()).toEqual(['text', 'buttons']);
    expect(billed()[0].text).toContain('▶️ https://r2.example/signed/102.mp4');
    expect(billed()[1].body).toBe('Finished watching "Cold calling"?');
  });

  it('T04 merged card refused by Meta → re-sent as today\'s two messages, nothing lost', async () => {
    seedLevel();
    wa.sendInteractiveButtons.mockImplementationOnce(async () => false);
    await Content().deliverModuleById(102, PHONE, { userId: UID });
    const delivered = sends.filter(s => s.billed).slice(-2);
    expect(delivered.map(s => s.kind)).toEqual(['text', 'buttons']);
    expect(delivered[0].text).toContain('▶️ https://r2.example/signed/102.mp4');
    expect(delivered[1].body).toBe('Finished watching "Cold calling"?');
  });

  it('T05 PDF module: the document carries the whole caption, then the buttons (2 billed, was 3)', async () => {
    seedLevel({ next: 'pdf' });
    await Content().deliverModuleById(102, PHONE, { userId: UID });
    expect(kinds()).toEqual(['doc', 'buttons']);
    expectInOrder(billed()[0].caption, ['📘 *Classroom Basics* — 2 of 2', '*Seating plans*', 'Read the PDF, then tap 📝 Take quiz']);
  });

  it('T05 document send fails → the caption still reaches the teacher as text', async () => {
    seedLevel({ next: 'pdf' });
    wa.sendDocumentByLink.mockImplementationOnce(async () => false);
    await Content().deliverModuleById(102, PHONE, { userId: UID });
    const after = billed().filter(s => s.kind !== 'doc');
    expect(after.map(s => s.kind)).toEqual(['text', 'buttons']);
    expect(after[0].text).toContain('*Seating plans*');
  });

  it('T07 failed check: result text and retry buttons in ONE message (was 2)', async () => {
    seedLevel(); seedAttempt({ idx: 1, answeredCorrect: 0 });
    await tap(3);
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, [
      '📝 *Module check — not quite.*', 'You got *0/2* (0%). You need 100% to move on.',
      'Give it another go — you can retry right away.', 'Ready to try the module check again?',
    ]);
    expect(billed()[0].buttons).toEqual(['🔄 Try again', '⏸ Pause']);
    expect(billed()[0].ids).toEqual(['training_quiz_retry_101', 'training_pause']);
  });

  it('T07 merged result refused by Meta → today\'s text then buttons', async () => {
    seedLevel(); seedAttempt({ idx: 1, answeredCorrect: 0 });
    wa.sendInteractiveButtons.mockImplementationOnce(async () => false);
    await tap(3);
    const delivered = billed().slice(-2);
    expect(delivered.map(s => s.kind)).toEqual(['text', 'buttons']);
    expect(delivered[0].text).toContain('📝 *Module check — not quite.*');
    expect(delivered[1].body).toBe('Ready to try the module check again?');
  });

  // Beacon House written exam
  function seedCapstone({ idx = 0, total = 2 } = {}) {
    seedLevel({ vendorKey: 'BEACONHOUSE', unlock: 'all_modules', next: 'none' });
    tables.teacher_training_progress = [{ user_id: UID, module_id: 101 }];
    tables.training_grand_quizzes.push({ id: 900, level_id: 4, quiz_type: 'capstone', is_active: true });
    tables.training_questions.push(
      { id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', order_index: 1, is_active: true },
      { id: 9002, grand_quiz_id: 900, question_text: 'Open Q2?', order_index: 2, is_active: true },
    );
    tables.training_assessment_attempts.push({
      id: ATTEMPT, user_id: UID, level_id: 4, quiz_kind: 'capstone', grand_quiz_id: 900, program_id: 'p1',
      status: 'in_progress', current_question_index: idx, total_questions: total, total_score: total * 5,
      last_activity_at: '2026-10-01T00:00:00Z',
    });
    for (let i = 0; i < idx; i++) {
      tables.training_assessment_answers.push({ attempt_id: ATTEMPT, question_index: i, question_id: 9001 + i, answer_score: 5 });
    }
  }
  const essay = 'I would plan the lesson around the learning objective and check understanding often. '.repeat(6);

  it('T08 capstone answer: score + feedback and the next question in ONE text (was 2)', async () => {
    seedCapstone({ idx: 0 });
    await Capstone().routeTextAnswer(PHONE, essay);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['📝 *4/5* — Good grounding in classroom practice.', '✍️ *Question 2 of 2*', 'Open Q2?']);
  });

  it('T08+T09 capstone last answer, passed with a PDF: score, result and certificate code on the PDF caption (1 billed, was 3)', async () => {
    seedCapstone({ idx: 1 });
    await Capstone().routeTextAnswer(PHONE, essay);
    expect(kinds()).toEqual(['doc']);
    expectInOrder(billed()[0].caption, [
      '📝 *4/5* — Good grounding', '🎉 *Grand Quiz passed!*', 'Your score: *9/10*', 'Certificate code: `NIETE-20261001-ABC123`',
    ]);
  });

  it('T08 capstone last answer, failed: score and result in one text', async () => {
    seedCapstone({ idx: 1 });
    tables.training_assessment_answers[0].answer_score = 0;
    llmCreate.mockResolvedValue({ choices: [{ message: { content: '{"score": 1, "feedback": "Too thin."}' } }] });
    await Capstone().routeTextAnswer(PHONE, essay);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['📝 *1/5* — Too thin.', 'You scored *1/10*']);
  });

  // NIETE level exam pass
  function seedGrandLastQuestion() {
    seedLevel();
    tables.teacher_training_progress = [{ user_id: UID, module_id: 101 }];
    tables.training_grand_quizzes.push({ id: 40, level_id: 4, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 1 });
    tables.training_questions.push(
      { id: 3000, grand_quiz_id: 40, order_index: 0, is_active: true, question_text: 'E1?', options: ['a', 'b'], correct_option: '1' },
      { id: 3001, grand_quiz_id: 40, order_index: 1, is_active: true, question_text: 'E2?', options: ['a', 'b'], correct_option: '1' },
    );
    tables.training_assessment_attempts.push({
      id: ATTEMPT, user_id: UID, program_id: 'p1', quiz_kind: 'grand', grand_quiz_id: 40, training_module_id: null,
      level_id: 4, current_question_index: 1, total_questions: 2, total_score: 2, status: 'in_progress',
    });
    tables.training_assessment_answers.push({ attempt_id: ATTEMPT, question_index: 0, question_id: 3000, chosen_option: '1', is_correct: true });
  }

  it('T09 level exam passed: the congratulation is the certificate PDF\'s caption (1 billed, was 3)', async () => {
    seedGrandLastQuestion();
    await tap(1);
    expect(kinds()).toEqual(['doc']);
    expectInOrder(billed()[0].caption, [
      '✅ *Correct*', '🏆 *Congratulations, Asma!*', 'You passed the Teacher Leader grand quiz with *2/2* (100%).',
      'Certificate code: `NIETE-20261001-ABC123`',
    ]);
  });

  it('T09 certificate PDF fails to send → the congratulation goes as text', async () => {
    seedGrandLastQuestion();
    wa.sendDocumentFromUrl.mockImplementationOnce(async () => false);
    await tap(1);
    const texts = billed().filter(s => s.kind === 'text');
    expect(texts).toHaveLength(1);
    expectInOrder(texts[0].text, ['✅ *Correct*', '🏆 *Congratulations, Asma!*', 'Certificate code: `NIETE-20261001-ABC123`']);
  });

  it('T09 certificate with no PDF → text only (unchanged)', async () => {
    seedGrandLastQuestion();
    cert.issueCertificate.mockResolvedValue({ certificate_code: 'NIETE-20261001-NOPDF1', teacher_name: 'Asma', level_name: 'Teacher Leader', pdf_r2_key: null });
    await tap(1);
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toContain('Certificate code: `NIETE-20261001-NOPDF1`');
  });

  it('T10 Beacon House level complete: ONLY the Grand Quiz offer (awaited), opening with the pass line', async () => {
    seedLevel({ vendorKey: 'BEACONHOUSE', unlock: 'all_modules', modulePct: 70, next: 'none' });
    tables.training_grand_quizzes.push({ id: 900, level_id: 4, quiz_type: 'capstone', is_active: true });
    tables.training_questions.push({ id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', order_index: 1, is_active: true });
    seedAttempt({ idx: 1, answeredCorrect: 1 });
    await tap(2);
    // Awaited: the offer is already out by the time the tap is handled.
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, ['✅ *Correct*', '📝 *Module check — passed.*', "🎓 You've completed every Teacher Leader module!"]);
    expect(billed()[0].buttons).toEqual(['Start Grand Quiz']);
    expect(sends.some(s => /That's every module in this level complete/.test(textOf(s)))).toBe(false);
  });
});

// ═══════════════ every fallback arm executes (never drop the line) ═══════════
describe('fallback arms — the riding line is never dropped', () => {
  it('sendQuestion on a missing attempt: the verdict still goes, alone', async () => {
    seedLevel();
    await Quiz().sendQuestion('ffffffff-ffff-ffff-ffff-ffffffffffff', PHONE, { verdict: true });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('✅ *Correct*');
  });

  it('sendQuestion on a closed attempt: the verdict still goes, alone', async () => {
    seedLevel(); seedAttempt({ idx: 1 });
    tables.training_assessment_attempts[0].status = 'passed';
    await Quiz().sendQuestion(ATTEMPT, PHONE, { verdict: false });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('✗ *Not correct.*');
  });

  it('next question is a written answer (CRQ): the verdict heads its text', async () => {
    seedLevel();
    tables.training_questions[1] = { ...tables.training_questions[1], options: [], correct_option: '' };
    seedAttempt({ idx: 0 });
    await tap(2);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['*✅ Correct · Q2/2*', 'Q2 text?', 'Type your answer as a message']);
  });

  it('oversized next question and no Flow configured: the failure text carries the verdict', async () => {
    seedLevel({ questionText: (i) => (i === 2 ? `${'very long '.repeat(110)}?` : `Q${i} text?`) });
    seedAttempt({ idx: 0 });
    await tap(2);
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['✅ *Correct*', "I couldn't display that question just now"]);
  });

  it('Q1 with option pictures: the intro goes first on its own (it must precede the pictures)', async () => {
    seedLevel();
    tables.training_questions[0].option_images = JSON.stringify(['https://img.example/1.png', 'https://img.example/2.png']);
    await Quiz().startTrainingQuiz(UID, 101, PHONE);
    expect(kinds()).toEqual(['text', 'image', 'image', 'list']);
    expect(billed()[0].text).toContain('📝 *Module check — "Wait time"*');
    expect(billed()[3].header).toBe('Q1/2');
  });

  it('gradeAttempt on a missing attempt: the verdict still goes, alone', async () => {
    seedLevel();
    await Quiz().gradeAttempt('ffffffff-ffff-ffff-ffff-ffffffffffff', PHONE, { lead: '✗ Not correct' });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('✗ Not correct');
  });

  it('the next step throws after a pass: the pass line is still said, and the error still travels', async () => {
    seedLevel({ next: 'video' }); seedAttempt({ idx: 1, answeredCorrect: 1 });
    // Fault injection only: gradeAttempt resolves onModuleCompleted at call
    // time, so a throwing stand-in exercises its catch arm.
    jest.spyOn(Content(), 'onModuleCompleted').mockRejectedValueOnce(new Error('boom'));
    await expect(tap(2)).rejects.toThrow('boom');
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['✅ *Correct*', '📝 *Module check — passed.*']);
  });

  it('PDF card over the caption cap: today\'s text, then the document with its title', async () => {
    seedLevel({ next: 'pdf' });
    await Content().deliverModuleById(102, PHONE, { userId: UID, lead: 'x'.repeat(1100) });
    expect(kinds()).toEqual(['text', 'doc', 'buttons']);
    expect(billed()[1].caption).toBe('Seating plans');
  });

  it('legacy deliverNextModule takes the lead too', async () => {
    seedLevel({ next: 'video' });
    tables.teacher_training_progress = [{ user_id: UID, module_id: 101 }];
    await Content().deliverNextModule(UID, 1, PHONE, { lead: '📝 *Module check — passed.*' });
    expect(kinds()).toEqual(['buttons']);
    expectInOrder(billed()[0].body, ['📝 *Module check — passed.*', '*Cold calling*', 'Finished watching "Cold calling"?']);
  });

  it('legacy deliverNextModule with a bad course id: the lead is still said', async () => {
    await Content().deliverNextModule(UID, 'not-a-number', PHONE, { lead: '📝 *Module check — passed.*' });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('📝 *Module check — passed.*');
  });

  function seedBhLevelComplete() {
    seedLevel({ vendorKey: 'BEACONHOUSE', unlock: 'all_modules', next: 'none' });
    tables.teacher_training_progress = [{ user_id: UID, module_id: 101 }];
    tables.training_grand_quizzes.push({ id: 900, level_id: 4, quiz_type: 'capstone', is_active: true });
    tables.training_questions.push({ id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', order_index: 1, is_active: true });
  }

  it('capstone offer + a lead over the body cap: the lead first, then the bare offer', async () => {
    seedBhLevelComplete();
    const offered = await Capstone().maybeOfferCapstone(UID, 101, PHONE, { lead: 'y'.repeat(1000) });
    expect(offered).toBe(true);
    expect(kinds()).toEqual(['text', 'buttons']);
    expect(billed()[1].body.startsWith("🎓 You've completed every")).toBe(true);
  });

  it('capstone offer refused by Meta: the lead riding on it is still said', async () => {
    seedBhLevelComplete();
    wa.sendInteractiveButtons.mockImplementationOnce(async () => false);
    await Capstone().maybeOfferCapstone(UID, 101, PHONE, { lead: '📝 *Module check — passed.*' });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('📝 *Module check — passed.*');
  });

  it('I-SAPS module-exam offer refused by Meta: the pass line is still said', async () => {
    seedLevel({ vendorKey: 'ISAPS', unlock: 'chain_per_course', modulePct: 70, next: 'none' });
    tables.training_courses[0].title = 'Module 1: Foundations';
    tables.teacher_training_progress = [{ user_id: UID, module_id: 101 }];
    tables.training_grand_quizzes.push({ id: 77, level_id: 4, quiz_type: 'grand_quiz', is_active: true, source_quiz_id: 901 });
    tables.training_questions.push({ id: 4000, grand_quiz_id: 77, order_index: 0, is_active: true, question_text: 'S?', options: ['a', 'b'], correct_option: '1' });
    wa.sendInteractiveButtons.mockImplementationOnce(async () => false);
    await Content().onModuleCompleted(UID, 101, PHONE, { lead: '📝 *Module check — passed.*' });
    expect(kinds()).toEqual(['text']);
    expect(billed()[0].text).toBe('📝 *Module check — passed.*');
  });

  it('capstone score + next question over 4096: today\'s two texts', async () => {
    seedLevel({ vendorKey: 'BEACONHOUSE', unlock: 'all_modules', next: 'none' });
    tables.training_grand_quizzes.push({ id: 900, level_id: 4, quiz_type: 'capstone', is_active: true });
    tables.training_questions.push(
      { id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', order_index: 1, is_active: true },
      { id: 9002, grand_quiz_id: 900, question_text: `${'Long prompt. '.repeat(330)}?`, order_index: 2, is_active: true },
    );
    tables.training_assessment_attempts.push({
      id: ATTEMPT, user_id: UID, level_id: 4, quiz_kind: 'capstone', grand_quiz_id: 900, program_id: 'p1',
      status: 'in_progress', current_question_index: 0, total_questions: 2, total_score: 10, last_activity_at: '2026-10-01T00:00:00Z',
    });
    await Capstone().routeTextAnswer(PHONE, 'An answer with enough substance to be marked fairly.');
    expect(kinds()).toEqual(['text', 'text']);
    expect(billed()[0].text).toBe('📝 *4/5* — Good grounding in classroom practice.');
    expect(billed()[1].text).toContain('✍️ *Question 2 of 2*');
  });

  it('capstone answers missing at the end: the score line opens the refusal', async () => {
    seedLevel({ vendorKey: 'BEACONHOUSE', unlock: 'all_modules', next: 'none' });
    tables.training_grand_quizzes.push({ id: 900, level_id: 4, quiz_type: 'capstone', is_active: true });
    tables.training_questions.push(
      { id: 9001, grand_quiz_id: 900, question_text: 'Open Q1?', order_index: 1, is_active: true },
      { id: 9002, grand_quiz_id: 900, question_text: 'Open Q2?', order_index: 2, is_active: true },
      { id: 9003, grand_quiz_id: 900, question_text: 'Open Q3?', order_index: 3, is_active: true },
    );
    // Index 2 of 3 with NO stored answers for 0 and 1 → the finalize refuses.
    tables.training_assessment_attempts.push({
      id: ATTEMPT, user_id: UID, level_id: 4, quiz_kind: 'capstone', grand_quiz_id: 900, program_id: 'p1',
      status: 'in_progress', current_question_index: 2, total_questions: 3, total_score: 15, last_activity_at: '2026-10-01T00:00:00Z',
    });
    await Capstone().routeTextAnswer(PHONE, 'An answer with enough substance to be marked fairly.');
    expect(kinds()).toEqual(['text']);
    expectInOrder(billed()[0].text, ['📝 *4/5*', 'some of your answers were not saved']);
  });
});

// FX1 (bd-w2daa.22) — NT1 moved the verdict into the next question's header as a plain "✓ Correct".
// A header cannot carry *bold*, but it can carry emoji: the original ✅ / ✗ marks come back, and a
// verdict sent as body text is the original "✅ *Correct*" / "✗ *Not correct.*" word for word.
describe('FX1 — the verdict keeps its original marks', () => {
  const { verdictLabel, verdictText, HEADER_TEXT_MAX } = require('../../bot/shared/services/training/merged-sends');
  const cp = (s) => [...s].length;

  it('header form: ✅ Correct / ✗ Not correct', () => {
    expect(verdictLabel(true)).toBe('✅ Correct');
    expect(verdictLabel(false)).toBe('✗ Not correct');
  });

  it('body form: the pre-NT1 text, word for word', () => {
    expect(verdictText(true)).toBe('✅ *Correct*');
    expect(verdictText(false)).toBe('✗ *Not correct.*');
  });

  it('the longest header (wrong answer, Q100/100) fits 60 code points', () => {
    for (const ok of [true, false]) {
      const longest = `${verdictLabel(ok)} · Q100/100`;
      expect(cp(longest)).toBeLessThanOrEqual(HEADER_TEXT_MAX);
    }
    expect(cp(`${verdictLabel(false)} · Q100/100`)).toBe(24);
  });
});
