/**
 * bd-fbih0 follow-up under bd-z5olm — lock the unsupported-type contract.
 *
 * The bd-fbih0 fix (reactions/stickers stay SILENT, video gets a contextual
 * line) shipped without tests; this locks it so a future webhook refactor
 * cannot resurrect the 38-replies-to-👍 morning. Also repairs the surviving
 * generic fallback: it spoke as a MALE («جواب دے سکتا ہوں») and Urdu-only —
 * Rumi is female, and NIETE is a flat en/ur deployment.
 */
const { unsupportedTypeReply, DEFAULT_REPLY, VIDEO_REPLY } = require('../../shared/utils/unsupported-message');

describe('silent types — a reaction is not a request', () => {
  test.each(['reaction', 'sticker', 'system', 'ephemeral', 'unsupported', 'REACTION'])(
    '%s → null (no reply, ever)', (t) => expect(unsupportedTypeReply(t)).toBeNull(),
  );
});

describe('video gets the contextual line', () => {
  test('names the supported inputs, bilingual', () => {
    const r = unsupportedTypeReply('video');
    expect(r).toBe(VIDEO_REPLY);
    expect(r).toMatch(/photos, voice notes, or text/);
    expect(r).toMatch(/[؀-ۿ]/);
  });
});

describe('the generic fallback', () => {
  test('unknown types still get it', () => {
    expect(unsupportedTypeReply('contacts')).toBe(DEFAULT_REPLY);
    expect(unsupportedTypeReply(undefined)).toBe(DEFAULT_REPLY);
  });
  test('speaks as Rumi — feminine, bilingual', () => {
    expect(DEFAULT_REPLY).toContain('سکتی ہوں');       // feminine
    expect(DEFAULT_REPLY).not.toContain('سکتا ہوں');   // the male slip
    expect(DEFAULT_REPLY).toMatch(/text|voice/i);      // an English line too
  });
});
