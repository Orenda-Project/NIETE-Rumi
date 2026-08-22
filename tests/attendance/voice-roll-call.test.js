/**
 * Voice roll call, restored. (bd-43520)
 *
 * Voice marking was deleted with the rest of attendance on 2026-08-10 because it
 * had never reached a teacher on this deployment. It comes back for the PRINCIPAL
 * path first, where the roster is a dozen colleagues whose names the principal says
 * every morning anyway — not 40 children whose names collide.
 *
 * The design rule that makes it safe: voice never writes. It PRE-TICKS. The
 * extraction lands on the REVIEW screen with the absentees already selected, the
 * principal confirms or corrects by tap, and the existing LEAVE -> CONFIRM -> write
 * path is the only way a register is ever saved. A transcription mistake costs a tap,
 * not a wrong record.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const voice = require('../../bot/shared/services/voice-attendance.service');

const STAFF = [
  { id: 'u1', first_name: 'Ayesha', last_name: 'Khan' },
  { id: 'u2', first_name: 'Bilal', last_name: 'Ahmed' },
  { id: 'u3', first_name: 'Sana', last_name: 'Iqbal' },
  { id: 'u4', first_name: 'Muhammad', last_name: 'Usman' },
];

describe('matching a spoken name to the roster', () => {
  it('matches a full name', () => {
    expect(voice.matchPerson('Ayesha Khan', STAFF)?.id).toBe('u1');
  });

  it('matches a first name alone — which is how a principal actually speaks', () => {
    expect(voice.matchPerson('Bilal', STAFF)?.id).toBe('u2');
  });

  it('matches a surname alone', () => {
    expect(voice.matchPerson('Iqbal', STAFF)?.id).toBe('u3');
  });

  it('survives the spelling Soniox gives back', () => {
    expect(voice.matchPerson('ayesha  khan', STAFF)?.id).toBe('u1');
    expect(voice.matchPerson('Aisha Khan', STAFF)?.id).toBe('u1');
  });

  it('returns null rather than guessing at a name nobody has', () => {
    expect(voice.matchPerson('Fatima', STAFF)).toBeNull();
  });

  it('refuses an ambiguous first name instead of picking one', () => {
    // Two Sanas on staff: a wrong guess marks the wrong colleague absent, which is
    // the exact failure the typed-coordinates channel was deleted for.
    const twoSanas = [...STAFF, { id: 'u5', first_name: 'Sana', last_name: 'Yousaf' }];
    expect(voice.matchPerson('Sana', twoSanas)).toBeNull();
    expect(voice.matchPerson('Sana Iqbal', twoSanas)?.id).toBe('u3');
  });
});

describe('turning what was said into a selection', () => {
  it('separates absent from on-leave', () => {
    const r = voice.resolveSpoken([
      { name: 'Ayesha Khan', status: 'absent' },
      { name: 'Bilal', status: 'leave' },
    ], STAFF);

    expect(r.absentIds).toEqual(['u1']);
    expect(r.leaveIds).toEqual(['u2']);
  });

  it('never puts the same person in both lists', () => {
    const r = voice.resolveSpoken([
      { name: 'Ayesha', status: 'absent' },
      { name: 'Ayesha Khan', status: 'leave' },
    ], STAFF);

    // Leave is the more specific statement, and double-counting corrupts tallies.
    expect(r.absentIds).not.toContain('u1');
    expect(r.leaveIds).toEqual(['u1']);
  });

  it('reports the names it could not place instead of dropping them', () => {
    const r = voice.resolveSpoken([
      { name: 'Ayesha', status: 'absent' },
      { name: 'Zubair', status: 'absent' },
    ], STAFF);

    expect(r.absentIds).toEqual(['u1']);
    expect(r.unmatched).toEqual(['Zubair']);
  });

  it('says nothing is selected when nobody was named', () => {
    const r = voice.resolveSpoken([], STAFF);
    expect(r.absentIds).toEqual([]);
    expect(r.leaveIds).toEqual([]);
  });

  it('ignores a present statement — marking is by exception', () => {
    const r = voice.resolveSpoken([
      { name: 'Ayesha', status: 'present' },
      { name: 'Bilal', status: 'absent' },
    ], STAFF);

    expect(r.absentIds).toEqual(['u2']);
    expect(r.leaveIds).toEqual([]);
  });
});

describe('reading the words for absent and leave', () => {
  it('understands Urdu and English, in either script', () => {
    expect(voice.readStatus('غیر حاضر')).toBe('absent');
    expect(voice.readStatus('absent')).toBe('absent');
    expect(voice.readStatus('chutti')).toBe('leave');
    expect(voice.readStatus('leave')).toBe('leave');
    expect(voice.readStatus('حاضر')).toBe('present');
    expect(voice.readStatus('present')).toBe('present');
  });

  it('defaults an unrecognised word to absent, because that is what was volunteered', () => {
    // A principal only names the exceptions. If the status word is unclear the
    // safe reading is "this person was named", and the REVIEW screen shows it.
    expect(voice.readStatus('')).toBe('absent');
    expect(voice.readStatus('kuch bhi')).toBe('absent');
  });
});
