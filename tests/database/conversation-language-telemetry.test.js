/**
 * Language telemetry on the conversation writer.
 *
 * Production evidence (5 Aug 2026, 18,729 rows): 78.8% of conversations have a
 * NULL output_language and ZERO have both input and output recorded. So we
 * cannot reconstruct a single language decision — which means we cannot tell
 * whether a language change improved or regressed anything.
 *
 * The cause is not a missing column; both columns exist. It is that language is
 * the 7th and 9th POSITIONAL parameter of storeConversation(), and most of the
 * ~15 call sites pass only the first five. Threading a positional argument
 * through every caller would repeat the "every site must remember" mistake this
 * whole workstream exists to remove.
 *
 * So the writer resolves what it can itself:
 *   - assistant rows: output_language defaults to the user's resolved language,
 *     because that is by definition the language the reply was rendered in
 *   - user rows: input_language is NOT invented. What a teacher actually wrote
 *     in needs detection; defaulting it to her stored preference would poison
 *     the very telemetry we are trying to collect
 *   - both are canonicalised, so a label like 'Urdu' can never reach the column
 *     (the parent bot's worst language incident began with a spelled-out name)
 */

let insertCaptor;

function load({ resolvedLanguage = 'ur' } = {}) {
  jest.resetModules();
  insertCaptor = [];

  const chain = {
    insert(data) {
      insertCaptor.push(data);
      return {
        select: () => ({ single: () => Promise.resolve({ data: { id: 'row-1', ...data }, error: null }) }),
      };
    },
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: [], error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
  };

  jest.doMock('../../bot/shared/config/supabase', () => ({ from: () => chain }));
  jest.doMock('../../bot/shared/utils/language-cache', () => ({
    getUserLanguage: jest.fn().mockResolvedValue(resolvedLanguage),
    setUserLanguage: jest.fn(),
  }));

  return require('../../bot/shared/database/bot-helpers');
}

const SESSION = 'sess-1';

describe('conversation language telemetry — assistant rows record what we answered in', () => {
  it('records output_language from the resolved language when the caller omits it', async () => {
    const H = load({ resolvedLanguage: 'ur' });
    await H.storeConversation('user-1', 'assistant', 'جواب', 'text', SESSION);
    expect(insertCaptor).toHaveLength(1);
    expect(insertCaptor[0].output_language).toBe('ur');
  });

  it('lets an explicit output language win over the resolved default', async () => {
    const H = load({ resolvedLanguage: 'ur' });
    await H.storeConversation('user-1', 'assistant', 'reply', 'text', SESSION, null, null, 'text', 'en');
    expect(insertCaptor[0].output_language).toBe('en');
  });

  it('records output_language even for a non-text assistant message', async () => {
    const H = load({ resolvedLanguage: 'en' });
    await H.storeConversation('user-1', 'assistant', '[Feature Menu Sent]', 'interactive', SESSION);
    expect(insertCaptor[0].output_language).toBe('en');
  });
});

describe('conversation language telemetry — user rows are not guessed', () => {
  it('does NOT invent an input_language from the stored preference', async () => {
    const H = load({ resolvedLanguage: 'ur' });
    await H.storeConversation('user-1', 'user', 'hello', 'text', SESSION);
    expect(insertCaptor[0].input_language).toBeUndefined();
  });

  it('records an input_language the caller actually detected', async () => {
    const H = load({ resolvedLanguage: 'ur' });
    await H.storeConversation('user-1', 'user', 'hello', 'text', SESSION, 'text', 'en');
    expect(insertCaptor[0].input_language).toBe('en');
  });
});

describe('conversation language telemetry — values are canonicalised', () => {
  it('canonicalises a spelled-out language label before it reaches the column', async () => {
    const H = load({ resolvedLanguage: 'en' });
    await H.storeConversation('user-1', 'assistant', 'x', 'text', SESSION, null, null, 'text', 'Urdu');
    expect(insertCaptor[0].output_language).toBe('ur');
  });

  it('canonicalises a regional variant to its base offered code', async () => {
    const H = load({ resolvedLanguage: 'en' });
    await H.storeConversation('user-1', 'user', 'x', 'text', SESSION, 'text', 'ur-PK');
    expect(insertCaptor[0].input_language).toBe('ur');
  });

  it('drops an unrecognisable label rather than storing junk', async () => {
    const H = load({ resolvedLanguage: 'en' });
    await H.storeConversation('user-1', 'user', 'x', 'text', SESSION, 'text', 'gibberish');
    expect(insertCaptor[0].input_language).toBeUndefined();
  });
});
