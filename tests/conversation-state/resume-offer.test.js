/**
 * Offering an interrupted task back.
 *
 * The store can already hold a paused flow — that landed with the state core — but
 * nothing paused one and nothing offered one back, so the capability was inert. This
 * is the half a teacher actually feels.
 *
 * What exists today, and why it isn't enough: every feature's answer to "she stopped
 * halfway" is to tell her to start over. The same copy repeats across the menu,
 * reading (three times), training (twice), quizzes and exam marking. Meanwhile work
 * simply strands — abandoned requests and half-finished forms sit in non-terminal
 * states for weeks with no sweep that covers them, and the one surface that lists a
 * teacher's open work (`/status`) offers only to CANCEL it.
 *
 * The shape here:
 *
 *   1. A step's deadline passes.
 *   2. The sweeper transitions that row to `offered_resume`, keeping the original
 *      step in the payload, and sends two buttons.
 *   3. "Pick up" restores the step. "Start fresh" clears it.
 *   4. If she answers neither, the OFFER expires too and is cleared — we ask once,
 *      not forever.
 *
 * The transition is itself a state, in the same store, so the buttons resolve against
 * real state rather than a side-channel "did we already ask?" flag.
 */

const mockState = {
  getState: jest.fn(),
  setState: jest.fn(),
  clearState: jest.fn(),
  sweepExpired: jest.fn(),
};
const mockWhatsApp = { sendMessage: jest.fn(), sendInteractiveButtons: jest.fn() };
const mockSupabase = { from: jest.fn() };

jest.mock('../../bot/shared/services/conversation-state.service', () => mockState);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const resume = require('../../bot/shared/services/conversation-resume.service');

const USER = '11111111-2222-3333-4444-555555555555';
const PHONE = '923000000000';

beforeEach(() => {
  jest.clearAllMocks();
  mockWhatsApp.sendInteractiveButtons.mockResolvedValue(true);
  mockWhatsApp.sendMessage.mockResolvedValue(true);
  mockState.setState.mockImplementation((u, s) => Promise.resolve({ ...s, stack: [] }));
  mockState.clearState.mockResolvedValue(true);
  // The teacher lookup the sweeper needs to know where to send.
  mockSupabase.from.mockImplementation(() => ({
    select: () => ({
      in: () => Promise.resolve({ data: [{ id: USER, phone_number: PHONE, preferred_language: 'en' }], error: null }),
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: USER, phone_number: PHONE, preferred_language: 'en' }, error: null }) }),
    }),
  }));
});

describe('the sweeper offers an interrupted task back', () => {
  it('offers each expired flow, once, and records that it asked', async () => {
    mockState.sweepExpired.mockResolvedValue([
      { userId: USER, flow: 'lesson_plan', step: 'awaiting_topic', payload: { grade: 4 } },
    ]);

    const res = await resume.sweepAndOffer();

    expect(res.offered).toBe(1);
    expect(mockWhatsApp.sendInteractiveButtons).toHaveBeenCalledTimes(1);

    // Recorded as a state transition in the SAME store, not a side-channel flag,
    // so the buttons below resolve against real state.
    expect(mockState.setState).toHaveBeenCalledWith(USER, expect.objectContaining({
      flow: 'lesson_plan',
      step: 'offered_resume',
      payload: expect.objectContaining({ resumeStep: 'awaiting_topic' }),
    }));
  });

  it('does not offer twice — an already-offered row is skipped', async () => {
    mockState.sweepExpired.mockResolvedValue([
      { userId: USER, flow: 'video', step: 'offered_resume', payload: { resumeStep: 'awaiting_topic' } },
    ]);

    const res = await resume.sweepAndOffer();

    expect(mockWhatsApp.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(res.offered).toBe(0);
  });

  it('clears an offer she never answered instead of asking again forever', async () => {
    mockState.sweepExpired.mockResolvedValue([
      { userId: USER, flow: 'video', step: 'offered_resume', payload: { resumeStep: 'awaiting_topic' } },
    ]);

    const res = await resume.sweepAndOffer();

    expect(mockState.clearState).toHaveBeenCalledWith(USER, { flow: 'video' });
    expect(res.expired).toBe(1);
  });

  it('survives one teacher failing without abandoning the rest', async () => {
    mockState.sweepExpired.mockResolvedValue([
      { userId: 'u-broken', flow: 'quiz', step: 'awaiting_topic', payload: {} },
      { userId: USER, flow: 'lesson_plan', step: 'awaiting_topic', payload: {} },
    ]);
    // BOTH teachers must be resolvable, or the first is merely skipped and the test
    // measures the wrong thing — the point is that a genuine SEND failure on one
    // does not abandon the other.
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        in: () => Promise.resolve({
          data: [
            { id: 'u-broken', phone_number: '923000000001', preferred_language: 'en' },
            { id: USER, phone_number: PHONE, preferred_language: 'en' },
          ],
          error: null,
        }),
      }),
    }));
    mockWhatsApp.sendInteractiveButtons.mockRejectedValueOnce(new Error('WhatsApp 500'));

    const res = await resume.sweepAndOffer();

    expect(res.failed).toBe(1);
    expect(res.offered).toBe(1);
  });
});

describe('what she taps', () => {
  it('"pick up" restores the step she was on', async () => {
    mockState.getState.mockResolvedValue({
      flow: 'lesson_plan', step: 'offered_resume',
      payload: { resumeStep: 'awaiting_topic', grade: 4 }, stack: [],
    });

    const handled = await resume.handleResumeButton(
      { id: USER, phone_number: PHONE, preferred_language: 'en' }, PHONE, 'resume_yes:lesson_plan'
    );

    expect(handled).toBe(true);
    expect(mockState.setState).toHaveBeenCalledWith(USER, expect.objectContaining({
      flow: 'lesson_plan',
      step: 'awaiting_topic',            // the ORIGINAL step, not offered_resume
      payload: expect.objectContaining({ grade: 4 }),  // and its context
    }));
  });

  it('"start fresh" clears it, scoped to that flow only', async () => {
    mockState.getState.mockResolvedValue({
      flow: 'video', step: 'offered_resume', payload: { resumeStep: 'awaiting_topic' }, stack: [],
    });

    const handled = await resume.handleResumeButton(
      { id: USER, phone_number: PHONE, preferred_language: 'en' }, PHONE, 'resume_no:video'
    );

    expect(handled).toBe(true);
    expect(mockState.clearState).toHaveBeenCalledWith(USER, { flow: 'video' });
  });

  it('answers gracefully when the state is already gone', async () => {
    // Intent-first: the button id names the flow, so a vanished state must produce a
    // sensible reply, never a crash and never silence.
    mockState.getState.mockResolvedValue(null);

    const handled = await resume.handleResumeButton(
      { id: USER, phone_number: PHONE, preferred_language: 'en' }, PHONE, 'resume_yes:video'
    );

    expect(handled).toBe(true);
    expect(mockWhatsApp.sendMessage).toHaveBeenCalled();
  });

  it('ignores button ids that are not resume decisions', async () => {
    const handled = await resume.handleResumeButton(
      { id: USER, phone_number: PHONE }, PHONE, 'menu_lesson_plan'
    );
    expect(handled).toBe(false);
    expect(mockState.setState).not.toHaveBeenCalled();
    expect(mockState.clearState).not.toHaveBeenCalled();
  });
});

describe('the copy', () => {
  const { resolveUx, UX_STRINGS } = require('../../bot/shared/config/ux-strings');

  // Language protocol: teacher-facing copy comes from the catalog in every offered
  // language. A partial map silently serves English, which is the bug the catalog
  // exists to prevent.
  const KEYS = ['resumeOfferBody', 'resumeYesLabel', 'resumeNoLabel', 'resumeRestored', 'resumeDiscarded'];

  it.each(KEYS)('%s exists in every offered language', (key) => {
    expect(UX_STRINGS[key]).toBeDefined();
    expect(UX_STRINGS[key].en).toBeTruthy();
    expect(UX_STRINGS[key].ur).toBeTruthy();
  });

  it.each(['resumeYesLabel', 'resumeNoLabel'])('%s fits WhatsApp\'s 20-char button cap', (key) => {
    for (const lang of ['en', 'ur']) {
      // Code points, not UTF-16 length — Urdu counts differently than .length suggests.
      const len = [...UX_STRINGS[key][lang]].length;
      expect(len).toBeLessThanOrEqual(20);
    }
  });

  it('names the task she left, so the offer is not a mystery', () => {
    const body = resolveUx('resumeOfferBody', { language: 'en', params: { task: 'lesson plan' } });
    expect(body).toMatch(/lesson plan/);
  });
});
