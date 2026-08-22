/**
 * An Urdu-script transcript against a Latin-script roster. (bd-43526)
 *
 * Observed on production, first real voice note: the principal said
 *
 *     آج عثمان اسکول نہیں آئے        ("Usman didn't come to school today")
 *
 * Soniox transcribes Urdu speech in URDU SCRIPT. The roster stores
 * "Muhammad Usman" in Latin. `عثمان` and `usman` share not one character, so every
 * pass of the matcher missed and the name came back as unplaced — correctly, given
 * it could not match, which is why the screen said "I could not find عثمان on your
 * staff list" rather than guessing. The refusal was right; the inability was the bug.
 *
 * Two layers fix it, and the second is what makes the first safe to rely on:
 *
 *   1. the extraction is told to return the ROSTER's spelling when it recognises the
 *      person — the model has both the Urdu transcript and the Latin roster in front
 *      of it, and resolving between two scripts is exactly what it is good at
 *   2. a script FOLD in the matcher, so an Urdu-script name still resolves when the
 *      model hands one back anyway: transliterate, reduce to a consonant skeleton,
 *      compare. Urdu drops short vowels in writing, so the skeleton is the part the
 *      two scripts actually agree on.
 *
 * Ambiguity still refuses. A fold that matches two people is a refusal for the same
 * reason two Sanas are.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const voice = require('../../bot/shared/services/voice-attendance.service');

// The roster as production actually held it when this failed.
const STAFF = [
  { id: 'u1', first_name: 'ZZTEST Ayesha', last_name: 'Khan' },
  { id: 'u2', first_name: 'ZZTEST Bilal', last_name: 'Ahmed' },
  { id: 'u3', first_name: 'ZZTEST Muhammad Usman', last_name: null },
  { id: 'u4', first_name: 'ZZTEST Sana', last_name: 'Iqbal' },
];

describe('the production failure, directly', () => {
  it('matches عثمان to Muhammad Usman', () => {
    expect(voice.matchPerson('عثمان', STAFF)?.id).toBe('u3');
  });

  it('resolves the whole transcript the way the handset sent it', () => {
    const r = voice.resolveSpoken([{ name: 'عثمان', status: 'absent' }], STAFF);
    expect(r.absentIds).toEqual(['u3']);
    expect(r.unmatched).toEqual([]);
  });
});

describe('the other names on that roster, in Urdu script', () => {
  it.each([
    ['عائشہ', 'u1'],
    ['بلال', 'u2'],
    ['ثنا', 'u4'],
    ['اقبال', 'u4'],
    ['خان', 'u1'],
  ])('matches %s', (spoken, id) => {
    expect(voice.matchPerson(spoken, STAFF)?.id).toBe(id);
  });
});

describe('what the fold must NOT do', () => {
  it('still refuses a name nobody has', () => {
    expect(voice.matchPerson('زبیر', STAFF)).toBeNull();
  });

  it('refuses when the fold lands on two people', () => {
    const twoSanas = [...STAFF, { id: 'u5', first_name: 'Sana', last_name: 'Yousaf' }];
    expect(voice.matchPerson('ثنا', twoSanas)).toBeNull();
  });

  it('does not match on a skeleton too short to identify anyone', () => {
    // A single consonant would match half a roster. "آ" folds to nothing usable.
    expect(voice.matchPerson('آ', STAFF)).toBeNull();
    expect(voice.matchPerson('ا', STAFF)).toBeNull();
  });

  it('leaves Latin-script matching exactly as it was', () => {
    expect(voice.matchPerson('Usman', STAFF)?.id).toBe('u3');
    expect(voice.matchPerson('Ayesha Khan', STAFF)?.id).toBe('u1');
    expect(voice.matchPerson('Fatima', STAFF)).toBeNull();
  });

  it('does not fold the ZZTEST prefix into a match for everyone', () => {
    // Every name on this roster shares it, so it identifies nobody — the same rule
    // that refuses a shared word in Latin.
    expect(voice.matchPerson('ZZTEST', STAFF)).toBeNull();
  });
});

describe('the extraction asks for the roster spelling', () => {
  it('tells the model to answer with the name as the roster spells it', () => {
    const prompt = voice.buildExtractionPrompt('آج عثمان اسکول نہیں آئے', STAFF);
    expect(prompt).toMatch(/roster/i);
    // The instruction that fixes the common case: hand back OUR spelling, not theirs.
    expect(prompt).toMatch(/exactly as (it appears|spelled|written)|roster spelling/i);
  });

  it('still puts the roster in front of the model', () => {
    const prompt = voice.buildExtractionPrompt('...', STAFF);
    expect(prompt).toContain('ZZTEST Muhammad Usman');
  });
});
