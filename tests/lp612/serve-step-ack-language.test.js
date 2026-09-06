/**
 * bd-15l6c — the language-row tap returns an ENGLISH closing screen to an Urdu teacher.
 *
 * `serveLp612Segment` (the `lp612_serve` step, reached by tapping «اردو» or
 * «English» on the language screen) returned a hardcoded English sentence:
 *
 *     'Your lesson plan is on its way — check this chat in a moment.'
 *
 * Its sibling — the flag-off segment tap, a few lines above in the same file —
 * already does the right thing:
 *
 *     resolveUx('lp612FlowAck', { language: who.preferred_language })
 *
 * So a teacher who has just tapped «اردو» is answered in English, on the last
 * screen she sees before the Flow closes.
 *
 * TWO DEFECTS IN ONE STRING.
 *
 * 1. LANGUAGE. It is teacher-addressed text and it is not in the catalog, which
 *    root CLAUDE.md rule 20 forbids outright: one writer, and every
 *    teacher-facing string resolved through `resolveUx` at send time.
 *
 * 2. TIMING. "in a moment" is the stale promise bd-2ym0h removed everywhere
 *    else. A first hit on this lane is minutes, not a moment (227-843 s
 *    measured on staging on 2026-09-03), so this screen was also making a claim
 *    the lane cannot keep. `lp612FlowAck` says "as soon as it is ready", which
 *    is honest at any latency.
 *
 * WHICH LANGUAGE THE ACK USES — deliberately her UI language, not `d.lang`.
 * `d.lang` is the DOCUMENT she ordered; the ack is addressed TO her. The
 * language-menu suite states the same split in its own header: "`lang` (the
 * document) and `uiLang` (the acks) — the two territories diverge the moment an
 * Urdu-UI teacher orders an English physics plan." So an Urdu teacher ordering
 * an English lesson is still answered in Urdu.
 */

const mockBuildSubjectItems = jest.fn();
const mockBuildChapterItems = jest.fn();
const mockBuildSegmentItems = jest.fn();
const mockBuildGradeItems = jest.fn();
const mockSegmentById = jest.fn();
const mockRequestLesson = jest.fn();

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: mockBuildGradeItems,
  buildSubjectItems: mockBuildSubjectItems,
  buildChapterItems: mockBuildChapterItems,
  buildSegmentItems: mockBuildSegmentItems,
  segmentById: mockSegmentById,
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({
  requestLesson: mockRequestLesson,
}));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`,
}));
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
}));

let userRow;
function mockBuilder() {
  const settle = () => Promise.resolve({ data: userRow, error: null });
  const b = {
    select: () => b,
    eq: () => b,
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const SEGMENT = {
  segment_id: 'grade_9_chemistry.c01.p007-008',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  is_religious: false,
  language: 'en',
};

const serve = (lang) => Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LANGUAGE', {
  step: 'lp612_serve', segment_id: SEGMENT.segment_id, lang,
});

beforeEach(() => {
  jest.clearAllMocks();
  userRow = { phone_number: '923001234567', preferred_language: 'en' };
  process.env.LP_612_ENABLED = 'true';
  process.env.LP_612_LANG_MENU = 'true';
  mockSegmentById.mockResolvedValue(SEGMENT);
  mockRequestLesson.mockResolvedValue({ outcome: 'queued' });
});

afterAll(() => {
  delete process.env.LP_612_ENABLED;
  delete process.env.LP_612_LANG_MENU;
});

describe('bd-15l6c — the lp612_serve closing screen speaks her language', () => {
  test('an URDU teacher gets the URDU ack — the reported bug', async () => {
    userRow = { phone_number: '923001234567', preferred_language: 'ur' };

    const res = await serve('ur');

    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toBe(resolveUx('lp612FlowAck', { language: 'ur' }));
  });

  test('an ENGLISH teacher gets the English catalog string, not the old hardcoded sentence', async () => {
    const res = await serve('en');

    expect(res.data.message).toBe(resolveUx('lp612FlowAck', { language: 'en' }));
  });

  test('the ack follows her UI language even when she orders the OTHER document language', async () => {
    // The two territories are separate: she ordered an English lesson, but she
    // is still an Urdu-reading teacher and the screen is addressed to her.
    userRow = { phone_number: '923001234567', preferred_language: 'ur' };

    const res = await serve('en');

    expect(res.data.message).toBe(resolveUx('lp612FlowAck', { language: 'ur' }));
  });

  test('the stale "in a moment" promise is gone — a first hit is minutes, not a moment', async () => {
    userRow = { phone_number: '923001234567', preferred_language: 'en' };

    const res = await serve('en');

    expect(res.data.message).not.toMatch(/in a moment/i);
  });

  test('this step now matches its sibling — the flag-off tap and the language tap say the same thing', async () => {
    userRow = { phone_number: '923001234567', preferred_language: 'ur' };
    const viaLanguageRow = await serve('ur');

    delete process.env.LP_612_LANG_MENU;
    const viaSegmentTap = await Endpoint.handlePakistanLpDataExchange('user-1:tok', 'SELECT_LESSON', {
      step: 'lp612_segment', segment_id: SEGMENT.segment_id,
    });

    expect(viaLanguageRow.data.message).toBe(viaSegmentTap.data.message);
  });

  test('no hardcoded teacher-facing sentence is left in the serve step', () => {
    // A grep-style guard: the literal that shipped must not come back, in this
    // file or any other, however the code around it is refactored.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../bot/shared/routes/pakistan-lp-endpoint.js'), 'utf8'
    );
    expect(src).not.toMatch(/Your lesson plan is on its way/);
  });
});
