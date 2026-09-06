/**
 * A 6-12 shelf entry has to reach the PROMPT, not just the shelf.
 *
 * Recording the delivery (delivery-context.test.js) is half the fix. The other half is that
 * `renderEntry` must render something useful from it. Its two detail sources are both K-5-only:
 * `resolveMoveList` needs a `lesson_id` from the v8 corpus, and `getVoicenoteScript` needs an
 * `r2_key` pointing at a voicenote transcript. A 6-12 entry has neither by design, so without
 * this it would render a bare heading — grade, subject, chapter — and the model would still be
 * answering "what does the activity mean?" with no idea what the activity IS.
 *
 * `one_screen` is the lesson on one phone screen: the field the authoring brief calls the
 * WhatsApp body, lint-sized at 150-260 words, already stored on the render row and already sent
 * to her. It is the right grounding text and it costs nothing extra to carry.
 *
 * The branch is ADDITIVE and keyed on the field's presence. No K-5 entry has `one_screen`, so
 * every K-5 render is byte-identical — which is the only safe way to touch a service this shared
 * (root CLAUDE.md rule 10).
 */

const mockGetShelf = jest.fn();
const mockResolveMoveList = jest.fn().mockResolvedValue(null);
const mockGetVoicenoteScript = jest.fn().mockResolvedValue(null);

jest.mock('../../bot/shared/services/lp-shelf.service', () => ({
  getShelf: (...a) => mockGetShelf(...a),
  getDeliveryType: () => 'segment',
}));
jest.mock('../../bot/shared/services/lp-voicenote-script.service', () => ({
  getVoicenoteScript: (...a) => mockGetVoicenoteScript(...a),
}));
jest.mock('../../bot/shared/services/coaching/fidelity/lp-fidelity-store', () => ({
  resolveMoveList: (...a) => mockResolveMoveList(...a),
}));
jest.mock('../../bot/shared/services/lp-v8-catalog.service', () => ({ lessonById: () => null }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const ONE_SCREEN = 'Today the class turns a listed set into set-builder form, using p.71-73. '
  + 'Start on the board with {1,2,3}, then ask for the rule that makes it.';

const LP612_ENTRY = {
  lane: 'lp612',
  segment_id: 'grade_8_mathematics.c05.p071-073',
  grade: 8,
  subject: 'Mathematics',
  chapter_number: 5,
  chapter_title: 'Sets',
  topic: 'Set-builder notation',
  pages_label: '71-73',
  one_screen: ONE_SCREEN,
  lang: 'en',
  delivered_at: new Date().toISOString(),
};

let Context;
beforeEach(() => {
  jest.resetModules();
  mockGetShelf.mockReset();
  mockResolveMoveList.mockReset().mockResolvedValue(null);
  mockGetVoicenoteScript.mockReset().mockResolvedValue(null);
  Context = require('../../bot/shared/services/lp-context.service');
});

describe('a 6-12 entry grounds the prompt', () => {
  test('the one-screen summary is rendered into the block', async () => {
    mockGetShelf.mockResolvedValue([LP612_ENTRY]);
    const ctx = await Context.buildLpContext('u1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).toContain('set-builder form');
  });

  test('the heading still identifies the lesson, pages included', async () => {
    mockGetShelf.mockResolvedValue([LP612_ENTRY]);
    const ctx = await Context.buildLpContext('u1');
    expect(ctx.fullBlock).toContain('Grade 8 Mathematics');
    expect(ctx.fullBlock).toContain('Sets');
    expect(ctx.fullBlock).toContain('71-73');
  });

  test('it never wakes the K-5 resolvers — no lesson_id, no R2 fetch', async () => {
    mockGetShelf.mockResolvedValue([LP612_ENTRY]);
    await Context.buildLpContext('u1');
    // resolveMoveList is called but self-guards on the absent lesson_id; the R2 one must not
    // even be reached with a key, because a 6-12 lesson has no voicenote transcript to fetch.
    const scriptArgs = mockGetVoicenoteScript.mock.calls.map((c) => c[0] && c[0].r2_key);
    expect(scriptArgs.every((k) => !k)).toBe(true);
  });

  test('an entry with no one_screen still renders its heading and does not crash', async () => {
    const { one_screen, ...bare } = LP612_ENTRY;
    mockGetShelf.mockResolvedValue([bare]);
    const ctx = await Context.buildLpContext('u1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).toContain('Grade 8 Mathematics');
  });

  test('a K-5 entry is untouched — the branch is keyed on a field K-5 never sets', async () => {
    const k5 = {
      lesson_id: 'v8-lesson-1', content_hash: 'abc', grade: 3, subject: 'Science',
      chapter_number: 2, chapter_title: 'Plants', delivered_at: new Date().toISOString(),
    };
    mockGetShelf.mockResolvedValue([k5]);
    const ctx = await Context.buildLpContext('u1');
    expect(ctx).not.toBeNull();
    expect(ctx.fullBlock).not.toContain('set-builder');
    // The K-5 detail path is still consulted exactly as before.
    expect(mockResolveMoveList).toHaveBeenCalledWith(
      expect.objectContaining({ lesson_id: 'v8-lesson-1' }),
    );
  });
});
