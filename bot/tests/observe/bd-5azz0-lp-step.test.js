/**
 * bd-5azz0 — the lesson-plan step was skipped or unreachable, so FICO's
 * LP-fidelity section scored on nothing ("Rumi never asked for the LP",
 * "Section B scored zero" — Toseef/Hafsa/Iqra/Mehwish, HITL rows 102-126).
 *
 * Three proven defects, one incident cluster (all traced on prod, 26-Aug):
 *  1. PHOTO-MAX SKIPPED THE LP ASK. On the 3rd photo, BOTH the image webhook
 *     (Phase 3) and the document-as-photo capture called queueAnalysis
 *     directly — the LP prompt lives behind the photo_done_ tap, which the
 *     max path never reaches. Live proof: Toseef's four 25-Aug sessions,
 *     3 photos each, conversation state stuck AWAITING_CLASSROOM_PHOTO,
 *     has_lesson_plan=false, form ~20 min later.
 *  2. A COACH'S LP PHOTO COULD NOT MATCH THE SESSION. The LP-as-image branch
 *     matched user_id only; in /observe the session is owned by the observed
 *     teacher and the coach is observer_user_id (the document path got the
 *     .or() in bd-9hzdn.2, the image path did not). The photo fell through to
 *     pic-to-LP and the session wedged at awaiting_lesson_plan until the
 *     60-min sweep advanced it WITHOUT the LP.
 *  3. Typed text at awaiting_lesson_plan fell to generic AI chat (same class
 *     as the bd-qq7wb typed-details gap).
 *
 * Contract: every path that finishes photo collection lands on the LP step
 * (advanceToLessonPlanStep), the LP-as-image and race-hold branches match the
 * observer too, and a leader's text while a session waits at the LP step
 * re-prompts instead of chatting.
 */

const fs = require('fs');
const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const IMAGE_HANDLER = path.join(__dirname, '../../shared/handlers/image-message.handler.js');
const TEXT_HANDLER = path.join(__dirname, '../../shared/handlers/text-message.handler.js');
const CAPTURE_SERVICE = path.join(__dirname, '../../shared/services/coaching/classroom-photo/capture.service.js');

describe('bd-5azz0 · wiring contracts (source)', () => {
  const imageSrc = fs.readFileSync(IMAGE_HANDLER, 'utf8');
  const captureSrc = fs.readFileSync(CAPTURE_SERVICE, 'utf8');
  const textSrc = fs.readFileSync(TEXT_HANDLER, 'utf8');

  it('LP-as-image branch matches the observer too (bd-9hzdn.2 parity)', () => {
    // The branch that resolves the awaiting_lesson_plan session for an inbound
    // IMAGE must use the same or(user_id, observer_user_id) shape as the
    // document path — a bare .eq('user_id') is defect 2.
    const lpBranch = imageSrc.slice(imageSrc.indexOf('lesson plan sent as a PHOTO'),
      imageSrc.indexOf('EXAM CHECKER DETECTION'));
    expect(lpBranch).toMatch(/observer_user_id\.eq\./);
    expect(lpBranch).not.toMatch(/\.eq\('user_id', user\.id\)/);
  });

  it('race-hold branch matches the observer too', () => {
    const start = imageSrc.indexOf('shouldHoldImageForActiveCoaching');
    const raceBranch = imageSrc.slice(start, start + 1500);
    expect(raceBranch).toMatch(/observer_user_id\.eq\./);
  });

  it('image-webhook photo-max advances to the LP step, never straight to analysis', () => {
    const phase3 = imageSrc.slice(imageSrc.indexOf('Phase 3'), imageSrc.indexOf('lesson plan sent as a PHOTO'));
    expect(phase3).toMatch(/advanceToLessonPlanStep/);
    expect(phase3).not.toMatch(/photo_max_limit_reached|photo_max_reached/);
  });

  it('document-as-photo capture photo-max advances to the LP step too', () => {
    expect(captureSrc).toMatch(/advanceToLessonPlanStep/);
    expect(captureSrc).not.toMatch(/photo_max_limit_reached|photo_max_reached/);
  });

  it("a leader's text while a session waits at the LP step re-prompts instead of chatting", () => {
    expect(textSrc).toMatch(/awaiting_lesson_plan/);
    expect(textSrc).toMatch(/advanceToLessonPlanStep|resendLpPromptIfWaiting/);
  });
});

describe('bd-5azz0 · advanceToLessonPlanStep (behavior)', () => {
  const sent = [];
  const updates = [];
  beforeEach(() => {
    jest.resetModules(); sent.length = 0; updates.length = 0;
    jest.doMock('../../shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          _table: table,
          select: () => b, eq: () => b, or: () => b, order: () => b, limit: () => b,
          maybeSingle: async () => (table === 'coaching_sessions'
            ? { data: { user_id: 'teacher-1', conversation_state: { classroom_photos: [1, 2, 3] } }, error: null }
            : { data: { preferred_language: 'ur', region: null }, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
        };
        return b;
      },
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', p }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', p }); return true; }),
    }));
  });
  afterEach(() => jest.resetModules());

  it('moves the session to awaiting_lesson_plan (state preserved) and sends the LP prompt', async () => {
    const { advanceToLessonPlanStep } = require('../../shared/services/coaching/lp-coaching/lp-step.service');
    await advanceToLessonPlanStep({ sessionId: 's1', from: '92300', tapperUserId: 'coach-1' });
    const up = updates.find((u) => u.table === 'coaching_sessions');
    expect(up).toBeTruthy();
    expect(up.payload.status).toBe('awaiting_lesson_plan');
    expect(up.payload.conversation_state.current_state).toBe('AWAITING_LESSON_PLAN');
    // held photos must survive the merge (bd-3ipd2 semantics)
    expect(up.payload.conversation_state.classroom_photos).toEqual([1, 2, 3]);
    expect(sent.length).toBe(1);   // the LP prompt (buttons — no recents in this mock)
  });
});

/**
 * bd-zrlcp — the step used to be committed before the prompt was sent, so a
 * refused payload (WhatsApp caps an interactive list at 10 rows; our send helper
 * returns false rather than throwing) left the session parked at
 * awaiting_lesson_plan with nothing delivered and no sweeper to recover it.
 */
describe('bd-zrlcp — advanceToLessonPlanStep commits only after the prompt lands', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/services/coaching/lp-coaching/lp-step.service.js'),
    'utf8'
  );

  it('sends the prompt BEFORE writing status awaiting_lesson_plan', () => {
    const send = SRC.indexOf('await sendLpPrompt(');
    const commit = SRC.indexOf("status: 'awaiting_lesson_plan'");
    expect(send).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    expect(send).toBeLessThan(commit);
  });

  it('returns early without committing when the prompt could not be delivered', () => {
    expect(SRC).toMatch(/const\s+sent\s*=\s*await\s+sendLpPrompt\(/);
    expect(SRC).toMatch(/if\s*\(\s*!sent\s*\)\s*\{[\s\S]{0,220}return\s+false;/);
  });

  it('still reports success on the happy path', () => {
    expect(SRC).toMatch(/return true;/);
  });
});

