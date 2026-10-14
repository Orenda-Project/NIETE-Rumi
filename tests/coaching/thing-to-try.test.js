/**
 * v10 coaching test (bd-v0toag.8): the one thing to try, for groups C and D (the new report).
 *
 * The thing to try is picked after a recording (bd-v0toag.20) and stored on that session's
 * prioritized_action.thing_to_try = { move_id, lesson_id, text, tag }. Here: the next plan's caption
 * names it, and it replaces the old "Quick reminder" of the last commitment. Only while ab_v10_enabled
 * is on and only for C and D; A, B and teachers outside the draw keep today's caption and reminder.
 * Nothing here may cost the teacher her plan: any failure falls back to today's caption.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockArms = { groupFor: jest.fn() };
jest.mock('../../bot/shared/services/coaching/ab-v10-arms', () => ({
  ...jest.requireActual('../../bot/shared/services/coaching/ab-v10-arms'),
  groupFor: (...a) => mockArms.groupFor(...a),
}));

const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
const T = require('../../bot/shared/services/coaching/thing-to-try');

const THING = { move_id: 'm4', lesson_id: 'grade_1_english_ch8_seg5', text: 'Ask one child to explain to a neighbour.', tag: 'hlp_peer_talk' };
const CAPTION = '📘 Day 6 · Reading\nT (p.1)\nGrade 1 English — Ch8: C8';
const GROUPS = {
  A: { group: 'A', plan: 'v9', report: 'today' },
  B: { group: 'B', plan: 'v10', report: 'today' },
  C: { group: 'C', plan: 'v9', report: 'new' },
  D: { group: 'D', plan: 'v10', report: 'new' },
};

// rows: coaching_sessions rows for the latest-prioritized_action read; fail: make the read error
function sessions(rows, { fail = false, throws = false } = {}) {
  mockSupabase.from.mockImplementation(() => {
    if (throws) throw new Error('client down');
    const c = {
      select: () => c, eq: () => c, not: () => c, order: () => c,
      limit: async () => (fail ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }),
    };
    return c;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockArms.groupFor.mockResolvedValue(GROUPS.C);
  sessions([{ prioritized_action: { action: 'old', teacher_response: 'yes', thing_to_try: THING } }]);
});

describe('thingToTryOf', () => {
  test('reads the stored record', () => {
    expect(T.thingToTryOf({ thing_to_try: THING })).toEqual(THING);
  });
  test.each([[null], [{}], [{ thing_to_try: null }], [{ thing_to_try: { text: '  ' } }], [{ thing_to_try: { text: 7 } }]])(
    'no usable text → null (%p)', (pa) => expect(T.thingToTryOf(pa)).toBeNull(),
  );
  test('trims the text and fills missing fields with null', () => {
    expect(T.thingToTryOf({ thing_to_try: { text: '  Wait five seconds.  ' } }))
      .toEqual({ move_id: null, lesson_id: null, text: 'Wait five seconds.', tag: null });
  });
});

describe('replacesReminder', () => {
  test.each([['C', true], ['D', true], ['A', false], ['B', false]])('%s → %p', (g, want) => {
    expect(T.replacesReminder(GROUPS[g])).toBe(want);
  });
  test('no group → false', () => expect(T.replacesReminder(null)).toBe(false));
});

describe('captionLine', () => {
  test('english: the catalog line with the text', () => {
    const line = T.captionLine(THING, 'en');
    expect(line).toBe(getCoachingMessage('thingToTryCaption', 'en').replace('{{thing}}', THING.text));
    expect(line).toContain(THING.text);
  });
  test('urdu: the urdu catalog line', () => {
    const ur = getCoachingMessage('thingToTryCaption', 'ur');
    expect(ur).not.toBe(getCoachingMessage('thingToTryCaption', 'en'));
    expect(T.captionLine(THING, 'ur')).toBe(ur.replace('{{thing}}', THING.text));
  });
  test('a very long text is capped so the caption stays inside WhatsApp\'s 1024', () => {
    const long = { ...THING, text: 'x'.repeat(5000) };
    const out = `${CAPTION}\n\n${T.captionLine(long, 'en')}`;
    expect([...out].length).toBeLessThanOrEqual(1024);
    expect(T.captionLine(long, 'en')).toContain('…');
  });
});

describe('planCaption', () => {
  const run = (lang = 'en') => T.planCaption({ userId: 'u-1', lessonId: 'grade_1_english_ch8_seg6', caption: CAPTION, lang });

  test.each([['C'], ['D']])('%s: the caption ends with the thing to try', async (g) => {
    mockArms.groupFor.mockResolvedValue(GROUPS[g]);
    expect(await run()).toBe(`${CAPTION}\n\n${T.captionLine(THING, 'en')}`);
  });

  test('in urdu for an urdu teacher', async () => {
    expect(await run('ur')).toBe(`${CAPTION}\n\n${T.captionLine(THING, 'ur')}`);
  });

  test.each([['A'], ['B']])('%s: today\'s caption, byte for byte, and no session read', async (g) => {
    mockArms.groupFor.mockResolvedValue(GROUPS[g]);
    expect(await run()).toBe(CAPTION);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  test('outside the draw or switch off (groupFor null): today\'s caption', async () => {
    mockArms.groupFor.mockResolvedValue(null);
    expect(await run()).toBe(CAPTION);
  });

  test('no thing to try stored: today\'s caption', async () => {
    sessions([{ prioritized_action: { action: 'old', teacher_response: 'yes' } }]);
    expect(await run()).toBe(CAPTION);
  });

  test('no earlier session at all: today\'s caption', async () => {
    sessions([]);
    expect(await run()).toBe(CAPTION);
  });

  test.each([[{ fail: true }], [{ throws: true }]])('a failed read (%p): today\'s caption, never throws', async (how) => {
    sessions(null, how);
    expect(await run()).toBe(CAPTION);
  });

  test('groupFor throwing: today\'s caption', async () => {
    mockArms.groupFor.mockRejectedValue(new Error('x'));
    expect(await run()).toBe(CAPTION);
  });

  test('a caption that names the thing to try is logged with the group, lesson and move', async () => {
    await run();
    expect(logEvent).toHaveBeenCalledWith('coaching.thing_to_try.caption', {
      userId: 'u-1', group: 'C', lessonId: 'grade_1_english_ch8_seg6',
      moveId: 'm4', setOnLessonId: THING.lesson_id, tag: 'hlp_peer_talk',
    });
  });

  test('nothing is logged when the caption is today\'s', async () => {
    mockArms.groupFor.mockResolvedValue(GROUPS.A);
    await run();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('sendsPriorReminder', () => {
  test.each([['A', true], ['B', true], ['C', false], ['D', false]])('%s → %p', async (g, want) => {
    mockArms.groupFor.mockResolvedValue(GROUPS[g]);
    expect(await T.sendsPriorReminder('u-1')).toBe(want);
  });
  test('outside the draw / switch off: true (today)', async () => {
    mockArms.groupFor.mockResolvedValue(null);
    expect(await T.sendsPriorReminder('u-1')).toBe(true);
  });
  test('groupFor throwing: true (today)', async () => {
    mockArms.groupFor.mockRejectedValue(new Error('x'));
    expect(await T.sendsPriorReminder('u-1')).toBe(true);
  });
});
