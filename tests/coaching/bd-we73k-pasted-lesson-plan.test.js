/**
 * bd-we73k — a lesson plan PASTED AS CHAT TEXT at the coaching LP step is
 * never attached to the session.
 *
 * Reported on the DC feedback sheet, row 136: "DC only accepts a lesson plan if
 * it's uploaded as a PDF, Word document, or images. If a teacher instead pastes
 * the lesson plan as plain text directly in the chat message, DC doesn't pick it
 * up or consider it as a valid lesson plan attachment."
 *
 * Confirmed in the fork: every path that can attach an LP is keyed on a WhatsApp
 * MEDIA id — handleLessonPlanMediaArrival (document webhook + LP-as-photo) and
 * the lessonplan_yes_ tap. Text at that step either re-prompts (a leader, via
 * resendLpPromptIfWaiting) or falls to generic AI chat (a teacher). Either way
 * has_lesson_plan stays false and Section B scores on nothing — the same outcome
 * bd-5azz0 fixed for the photo paths.
 *
 * Contract asserted here:
 *  1. A cheap, DB-free pre-filter decides whether a text is even LP-shaped, so
 *     ordinary chat never costs a query.
 *  2. An LP-shaped text, while a session the sender DRIVES waits at
 *     awaiting_lesson_plan, is attached through the SAME writer the document
 *     path uses and queues the SAME extraction job — so isLikelyLessonPlan,
 *     lesson_plan_structured and the fidelity recompute all come for free.
 *  3. The extraction worker accepts text directly: no R2 round-trip.
 *  4. The text handler consults this BEFORE the exam checker and WITHOUT the
 *     school-leader gate, so a plain teacher gets it too.
 */

const fs = require('fs');
const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// A pasted plan in the shape teachers actually send (prod, 18-Sep: a 3,189-char
// paste at AWAITING_LESSON_PLAN that the bot answered as generic chat).
const PASTED_LP = [
  'Class 5 English – Chapter 7: What Goes Around Comes Around',
  'Lesson Plan – 1st Lesson',
  'Class: 5   Subject: English   Duration: 40 minutes',
  '',
  'Objectives:',
  '- Students will read the passage aloud with correct pronunciation.',
  '- Students will identify the moral of the story in their own words.',
  '',
  'Materials: textbook page 61, board, flashcards of the new vocabulary.',
  '',
  'Activities:',
  '1. Warm-up (5 min): ask what "kindness" means and collect answers on the board.',
  '2. I do (10 min): read the first two paragraphs aloud, modelling intonation.',
  '3. We do (15 min): paired reading, each pair reads one paragraph.',
  '4. You do (10 min): learners write two sentences about the moral.',
  '',
  'Assessment: check the two written sentences; ask three recall questions.',
  'Homework: read the passage once at home and underline five new words.',
].join('\n');

const PASTED_LP_URDU = [
  'سبق کا منصوبہ: پانی کی اہمیت',
  'جماعت: دوم   مضمون: جنرل نالج   دورانیہ: 35 منٹ',
  '',
  'مقاصد:',
  '- بچے پانی کے تین استعمال بتا سکیں گے۔',
  '- بچے پانی بچانے کے دو طریقے بیان کر سکیں گے۔',
  '',
  'سرگرمی: تصویری کارڈ دکھا کر بچوں سے سوال و جواب کیے جائیں گے۔',
  'جانچ: ہر بچے سے پانی کا ایک استعمال پوچھا جائے گا۔',
].join('\n');

// ------------------------------------------------------------------
// 1. The pre-filter
// ------------------------------------------------------------------
describe('bd-we73k · looksLikePastedLessonPlan (pure, no I/O)', () => {
  const { looksLikePastedLessonPlan } = require('../../bot/shared/services/coaching/lp-coaching/lp-text-paste.service');

  it('accepts a pasted English lesson plan', () => {
    expect(looksLikePastedLessonPlan(PASTED_LP)).toBe(true);
  });

  it('accepts a pasted Urdu lesson plan', () => {
    expect(looksLikePastedLessonPlan(PASTED_LP_URDU)).toBe(true);
  });

  it('rejects the short replies teachers actually send at this step', () => {
    for (const s of ['no', 'No', 'nahi', 'wait', 'Sana Bibi 03001234567', 'ok thank you', '']) {
      expect(looksLikePastedLessonPlan(s)).toBe(false);
    }
  });

  it('rejects a long reflective answer that is not a plan', () => {
    // A real reflective-question answer, prod shape: long, but no plan structure.
    const reflection = 'Us waqt mere zehan mein yeh tha ke student ne jo answer diya hai woh '
      + 'correct concept ko show nahi kar raha tha, isliye maine usko turant correct kar diya. '
      + 'Baad mein mujhe laga ke shayad behtar hota agar main pehle doosre bachon se poochta ke '
      + 'unka kya khayal hai, phir hum mil kar us par baat karte, taake sab ko sochne ka mauqa milta '
      + 'aur woh khud apni galti pehchan lete.';
    expect(reflection.length).toBeGreaterThan(280);
    expect(looksLikePastedLessonPlan(reflection)).toBe(false);
  });

  it('rejects a slash command however long', () => {
    expect(looksLikePastedLessonPlan('/observe ' + PASTED_LP)).toBe(false);
  });

  it('rejects an LP-shaped text that is too short to be a plan', () => {
    expect(looksLikePastedLessonPlan('Lesson plan: objectives, activities, assessment.')).toBe(false);
  });
});

// ------------------------------------------------------------------
// 2. tryAttachPastedLessonPlan — session resolution + hand-off
// ------------------------------------------------------------------
describe('bd-we73k · tryAttachPastedLessonPlan', () => {
  const user = { id: 'teacher-1' };
  let resolveCalls; let pasted;

  function load({ outcome, session }) {
    jest.resetModules();
    resolveCalls = []; pasted = [];
    jest.doMock('../../bot/shared/services/coaching/media-session-resolver', () => ({
      resolveMediaSession: async (args) => { resolveCalls.push(args); return { outcome, session, candidates: session ? [session] : [] }; },
    }));
    jest.doMock('../../bot/shared/services/coaching/lesson-plan-processor.service', () => ({
      handlePastedLessonPlan: async (sid, from, text) => { pasted.push({ sid, from, text }); },
    }));
    return require('../../bot/shared/services/coaching/lp-coaching/lp-text-paste.service');
  }

  // resetModules clears the module REGISTRY but not the doMock factories, so
  // without dontMock the stub processor below would still be in force in the
  // next describe — which asserts the REAL processor's writes.
  afterEach(() => {
    jest.dontMock('../../bot/shared/services/coaching/media-session-resolver');
    jest.dontMock('../../bot/shared/services/coaching/lesson-plan-processor.service');
    jest.resetModules();
  });

  it('attaches the paste to the session waiting at the LP step', async () => {
    const svc = load({ outcome: 'single', session: { id: 'sess-1', status: 'awaiting_lesson_plan' } });
    await expect(svc.tryAttachPastedLessonPlan({ user, from: '923001234567', text: PASTED_LP })).resolves.toBe(true);
    expect(resolveCalls).toEqual([expect.objectContaining({ kind: 'lp' })]);
    expect(pasted).toEqual([{ sid: 'sess-1', from: '923001234567', text: PASTED_LP }]);
  });

  it('does nothing when no session is at the LP gate', async () => {
    const svc = load({ outcome: 'none', session: null });
    await expect(svc.tryAttachPastedLessonPlan({ user, from: '923001234567', text: PASTED_LP })).resolves.toBe(false);
    expect(pasted).toEqual([]);
  });

  it('stands down when the gate is ambiguous rather than guessing a teacher', async () => {
    // Text cannot be parked the way media is (media-target stores a mediaId),
    // so an ambiguous gate keeps the caller's existing fall-through.
    const svc = load({ outcome: 'ambiguous', session: null });
    await expect(svc.tryAttachPastedLessonPlan({ user, from: '923001234567', text: PASTED_LP })).resolves.toBe(false);
    expect(pasted).toEqual([]);
  });

  it('never touches the database for ordinary chat', async () => {
    const svc = load({ outcome: 'single', session: { id: 'sess-1' } });
    await expect(svc.tryAttachPastedLessonPlan({ user, from: '92300', text: 'no' })).resolves.toBe(false);
    expect(resolveCalls).toEqual([]);   // the pre-filter ran first
    expect(pasted).toEqual([]);
  });
});

// ------------------------------------------------------------------
// 3. The writer — same row shape as the document path, minus R2
// ------------------------------------------------------------------
describe('bd-we73k · LessonPlanProcessorService.handlePastedLessonPlan', () => {
  let updates; let sent; let jobs;

  beforeEach(() => {
    jest.resetModules();
    updates = []; sent = []; jobs = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          select: () => b, eq: () => b, order: () => b, limit: () => b,
          maybeSingle: async () => ({
            data: table === 'coaching_sessions'
              ? { status: 'awaiting_lesson_plan', user_id: 'teacher-1', observer_user_id: null, users: { preferred_language: 'en' } }
              : { preferred_language: 'en' },
            error: null,
          }),
          single: async () => ({ data: { status: 'awaiting_lesson_plan', user_id: 'teacher-1' }, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
        };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, body) => { sent.push({ to, body }); return true; }),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueLessonPlanExtraction: async (sid, meta) => { jobs.push({ type: 'extraction', sid, meta }); },
      queueAnalysis: async (sid, meta) => { jobs.push({ type: 'analysis', sid, meta }); },
    }));
  });

  afterEach(() => jest.resetModules());

  it('stores the text, flags the plan, and queues extraction + analysis', async () => {
    const Processor = require('../../bot/shared/services/coaching/lesson-plan-processor.service');
    await Processor.handlePastedLessonPlan('sess-1', '923001234567', PASTED_LP);

    const up = updates.find((u) => u.table === 'coaching_sessions');
    expect(up).toBeTruthy();
    expect(up.payload).toMatchObject({
      has_lesson_plan: true,
      lesson_plan_text: PASTED_LP,
      lesson_plan_format: 'text',
      lesson_plan_link_method: 'pasted',
      lesson_plan_extraction_status: 'pending',
    });
    // No R2 artefacts exist for a paste — never invent them.
    expect(up.payload.lesson_plan_r2_key).toBeUndefined();
    expect(up.payload.lesson_plan_url).toBeUndefined();

    const extraction = jobs.find((j) => j.type === 'extraction');
    expect(extraction).toBeTruthy();
    expect(extraction.meta).toMatchObject({ pastedText: PASTED_LP });
    expect(extraction.meta.r2Key).toBeUndefined();

    expect(jobs.find((j) => j.type === 'analysis')).toBeTruthy();
    expect(sent).toHaveLength(1);
  });

  it('acks from the coaching catalog, never an inline English literal', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/coaching/lesson-plan-processor.service.js'), 'utf8');
    const body = src.slice(src.indexOf('handlePastedLessonPlan'));
    expect(body).toMatch(/getCoachingMessage\(\s*'lessonPlan_receivedText'/);
  });
});

// ------------------------------------------------------------------
// 4. The extraction worker takes text directly
// ------------------------------------------------------------------
describe('bd-we73k · lesson-plan-extraction worker · pasted text', () => {
  let updates; let downloads;

  beforeEach(() => {
    jest.resetModules();
    updates = []; downloads = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          select: () => b, eq: () => b,
          single: async () => ({ data: { user_id: 'teacher-1', lesson_plan_url: null, lesson_plan_r2_key: null, lesson_plan_format: 'text' }, error: null }),
          maybeSingle: async () => ({ data: { user_id: 'teacher-1' }, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
        };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      downloadFromR2: async (k) => { downloads.push(k); return Buffer.from('should never be called'); },
      uploadLessonPlanBuffer: async () => 'k', buildR2PublicUrl: () => 'u',
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
  });

  afterEach(() => jest.resetModules());

  it('persists the pasted text without an R2 round-trip', async () => {
    const Worker = require('../../bot/workers/lesson-plan-extraction.worker');
    jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue({
      subject: 'English', topic: 'What Goes Around Comes Around',
      objectives: ['read aloud'], activities: [{ title: 'Warm-up' }],
    });

    await Worker.process({ coachingSessionId: 'sess-1', pastedText: PASTED_LP, userId: 'teacher-1' });

    expect(downloads).toEqual([]);          // the whole point: no file to fetch
    const completed = updates.find((u) => u.payload && u.payload.lesson_plan_text);
    expect(completed).toBeTruthy();
    expect(completed.payload).toMatchObject({
      lesson_plan_text: PASTED_LP,
      lesson_plan_extraction_status: 'completed',
      lesson_plan_format: 'text',
    });
    expect(completed.payload.lesson_plan_word_count).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// 5. Wiring — the handler must actually call it, for teachers too
// ------------------------------------------------------------------
describe('bd-we73k · text-handler wiring (source)', () => {
  const TEXT_HANDLER = path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js');
  // Comments name their own subject, so a bare match can land on prose and pass
  // on code that never runs (language-protocol §7.1). Strip them first.
  const src = fs.readFileSync(TEXT_HANDLER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Anchor on the CALL, never the bare identifier: `require(...)` mentions the
  // name too, so /tryAttachPastedLessonPlan/ passes on a handler that imports
  // it and never calls it (verified by mutation — it did).
  const CALL = /if\s*\(\s*await\s+tryAttachPastedLessonPlan\(\s*\{[^)]*messageBody[^)]*\}\s*\)\s*\)/;

  it('awaits tryAttachPastedLessonPlan on the raw message body and returns on a hit', () => {
    expect(src).toMatch(CALL);
    // The raw body, not `trimmedMessage` — that one is lower-cased, and an LP
    // stored in lower case is a lesson plan we mangled on the way in.
    expect(src).not.toMatch(/tryAttachPastedLessonPlan\(\s*\{[^)]*text:\s*trimmedMessage/);
  });

  it('is NOT behind the school-leader gate — a teacher pastes plans too', () => {
    const call = src.search(CALL);
    const leaderGate = src.indexOf('_isLeader(user)');
    expect(call).toBeGreaterThan(-1);
    expect(leaderGate).toBeGreaterThan(-1);
    expect(call).toBeLessThan(leaderGate);
  });

  it('runs before the exam checker claims the text', () => {
    const call = src.search(CALL);
    const examChecker = src.indexOf('handleExamText');
    expect(call).toBeGreaterThan(-1);
    expect(examChecker).toBeGreaterThan(-1);
    expect(call).toBeLessThan(examChecker);
  });
});

// ------------------------------------------------------------------
// 6. BOTH FLOWS — self-serve DC and a HITL /observe observation.
//    The resolver is REAL here (only the DB and the writer are stubbed), so
//    this proves the ownership rule end to end rather than trusting the mock
//    used in section 2.
// ------------------------------------------------------------------
describe('bd-we73k · the paste reaches DC and HITL alike, and nothing else', () => {
  function load(rows) {
    jest.resetModules();
    const pasted = [];
    jest.doMock('../../bot/shared/services/coaching/media-target.service', () => ({
      getTarget: async () => null, clearTarget: async () => {}, setTarget: async () => {},
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const b = { select: () => b, or: () => b, in: () => b, order: async () => ({ data: rows, error: null }) };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/services/coaching/lesson-plan-processor.service', () => ({
      handlePastedLessonPlan: async (sid) => { pasted.push(sid); },
    }));
    return { svc: require('../../bot/shared/services/coaching/lp-coaching/lp-text-paste.service'), pasted };
  }

  const AT_LP_STEP = { status: 'awaiting_lesson_plan' };
  const dcSession = { id: 'dc-1', ...AT_LP_STEP, user_id: 'teacher-1', observer_user_id: null, observation_type: null };
  const observation = { id: 'obs-1', ...AT_LP_STEP, user_id: 'teacher-2', observer_user_id: 'coach-1', observation_type: 'leader_observation' };

  afterEach(() => {
    jest.dontMock('../../bot/shared/services/coaching/media-target.service');
    jest.dontMock('../../bot/shared/config/supabase');
    jest.dontMock('../../bot/shared/services/coaching/lesson-plan-processor.service');
    jest.resetModules();
  });

  it('DC self-serve: the teacher pastes into her OWN session and it attaches', async () => {
    const { svc, pasted } = load([dcSession]);
    await expect(svc.tryAttachPastedLessonPlan({ user: { id: 'teacher-1' }, from: '92300', text: PASTED_LP })).resolves.toBe(true);
    expect(pasted).toEqual(['dc-1']);
  });

  it('HITL /observe: the COACH pastes the observed teacher\'s plan and it attaches', async () => {
    // The row is OWNED by the observed teacher; the coach drives it.
    const { svc, pasted } = load([observation]);
    await expect(svc.tryAttachPastedLessonPlan({ user: { id: 'coach-1' }, from: '92301', text: PASTED_LP })).resolves.toBe(true);
    expect(pasted).toEqual(['obs-1']);
  });

  it('HITL: the OBSERVED teacher\'s own paste never lands in the coach\'s observation', async () => {
    // She is the subject of the row, not its driver — the failure bd-wwcgf fixed
    // for photos and texts, reached here by a third route.
    const { svc, pasted } = load([observation]);
    await expect(svc.tryAttachPastedLessonPlan({ user: { id: 'teacher-2' }, from: '92302', text: PASTED_LP })).resolves.toBe(false);
    expect(pasted).toEqual([]);
  });

  it('a coach running two observations at the LP step is asked, not guessed at', async () => {
    const second = { ...observation, id: 'obs-2', user_id: 'teacher-3' };
    const { svc, pasted } = load([observation, second]);
    await expect(svc.tryAttachPastedLessonPlan({ user: { id: 'coach-1' }, from: '92301', text: PASTED_LP })).resolves.toBe(false);
    expect(pasted).toEqual([]);
  });
});

// ------------------------------------------------------------------
// 7. bd-cq1go — the floor was fitted to the wrong sample.
//
// 280 code points was calibrated on long, formatted pastes (3,189 / 2,574 /
// 322 chars). The first real teacher to try it on sandbox wrote a compact
// 3-line Roman-Urdu plan of 222 — it cleared the evidence bar with 3 markers
// and was rejected on LENGTH ALONE, so her session stayed without a plan and
// generic routing told her to send a classroom recording she had already sent.
//
// Her exact text is the fixture: the bug is what a real teacher actually typed,
// not a shape we imagined.
// ------------------------------------------------------------------
describe('bd-cq1go · a short but real lesson plan is still a lesson plan', () => {
  const { looksLikePastedLessonPlan } = require('../../bot/shared/services/coaching/lp-coaching/lp-text-paste.service');

  // Sandbox, 2026-09-22 06:01:58, user 44206d3b — 222 code points, verbatim.
  const REAL_SHORT_LP = 'Lesson plan: shairi , tashreeh ko bacho ko explain krna.\n'
    + 'Bacho ko mashoor shairoo k bary mai btana or shairi k impact ke batien\n'
    + ' Aik activity rkhwana jis mai shairi krwaye jsye do bacho ke pair mai interactove bnany k lye.';

  it('accepts the 222-char Roman-Urdu plan that the first live test rejected', () => {
    expect([...REAL_SHORT_LP].length).toBe(222);
    expect(looksLikePastedLessonPlan(REAL_SHORT_LP)).toBe(true);
  });

  it('still rejects a teacher SAYING she has no plan, however she phrases it', () => {
    // The danger of a lower floor. Each of these names a plan and would clear
    // the marker bar, so length alone can no longer be what saves us.
    for (const s of [
      "I don't have a lesson plan for this class today, sorry — the lesson was on poetry and I taught it from the textbook directly without writing anything down.",
      'Sorry sir, lesson plan nahi hai is class ka, maine textbook se hi parhaya tha aaj, koi plan likha nahi tha is lesson ke liye.',
      'اس کلاس کے لیے سبق کا منصوبہ نہیں ہے، میں نے کتاب سے ہی پڑھایا تھا اور کوئی تحریری منصوبہ نہیں بنایا تھا۔',
    ]) {
      expect(looksLikePastedLessonPlan(s)).toBe(false);
    }
  });

  it('still rejects ordinary short replies at the lesson-plan step', () => {
    for (const s of ['no', 'nahi', 'wait', 'Sana Bibi 03001234567', 'ok thank you']) {
      expect(looksLikePastedLessonPlan(s)).toBe(false);
    }
  });
});
