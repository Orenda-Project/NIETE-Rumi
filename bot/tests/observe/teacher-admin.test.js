/**
 * The number a coach types is the identity of a person (TDD, red-first).
 *
 * This is what survives the move to the derived model, and it survives because
 * it never depended on the roster table: whatever she types has to resolve to
 * exactly one `users.phone_number`, which is UNIQUE.
 *
 * The classifier that used to live beside this is gone. It existed to refuse a
 * number carrying two different teachers, and that case was only possible
 * because `leader_teachers` allowed duplicate phones. Outcome logic now lives
 * in planAdd, covered by teacher-admin-writes.test.js.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  normaliseTeacherPhone, removedTeacherAck, refusalBody, addPlanAck,
} = require('../../shared/services/observe/observe-teacher-admin.service');

describe('normaliseTeacherPhone · one canonical identity from whatever she types', () => {
  it('accepts the four shapes a PK coach actually types', () => {
    for (const raw of ['03001234567', '3001234567', '923001234567', '+92 300 1234567']) {
      expect(normaliseTeacherPhone(raw)).toBe('923001234567');
    }
  });

  it('survives punctuation — dashes, spaces, brackets', () => {
    for (const raw of ['92-300-123-4567', '0300 123 4567', '(0300) 1234567']) {
      expect(normaliseTeacherPhone(raw)).toBe('923001234567');
    }
  });

  it('strips a 00 international prefix rather than reading it as digits', () => {
    expect(normaliseTeacherPhone('00923001234567')).toBe('923001234567');
  });

  it('is idempotent — a value already normalised comes back unchanged', () => {
    expect(normaliseTeacherPhone(normaliseTeacherPhone('03001234567'))).toBe('923001234567');
  });

  it('refuses what is not a PK mobile rather than inventing one', () => {
    for (const raw of ['', null, undefined, '   ', 'abcdefg', '12345', '9251111111', '92300123456789']) {
      expect(normaliseTeacherPhone(raw)).toBeNull();
    }
  });

  it("refuses the live malformed value that silently became a STRANGER's number", () => {
    // Production carries `33355494779` in the old raw phone column; the
    // import's looser normalisation turned it into 923335549477, a dialable
    // Pakistani mobile belonging to someone who is not this teacher.
    expect(normaliseTeacherPhone('33355494779')).toBeNull();
  });
});

// ── the copy the operator flagged from staging ─────────────────────────

describe('the copy is gender-neutral', () => {
  // Operator, 2026-08-28, testing on staging: "All the copy says 'She'.
  // Amjad Hussaini is a male. Awkward."
  const GENDERED = /\b(she|her|hers|himself|herself)\b/i;

  it('the removal acknowledgement', () => {
    expect(removedTeacherAck('en', { name: 'Amjad Hussaini', schoolName: 'Rawal Dam' }))
      .not.toMatch(GENDERED);
  });

  it('every refusal', () => {
    for (const k of ['invalid_phone', 'not_my_school', 'is_coach', 'name_required', 'not_found', 'cancelled', 'failed']) {
      expect(refusalBody('en', k)).not.toMatch(GENDERED);
    }
  });

  it('every add outcome', () => {
    const base = { person: { name: 'Amjad Hussaini' }, phone: '923001234567', toSchoolName: 'Rawal Dam' };
    for (const outcome of ['move', 'already_here', 'new']) {
      expect(addPlanAck('en', { ...base, outcome, fromSchoolName: 'SAID PUR' })).not.toMatch(GENDERED);
    }
  });
});

describe('removedTeacherAck · removal says what survives it', () => {
  it('names the person and the school, and promises the history stays', () => {
    const t = removedTeacherAck('en', { name: 'Tahira Manzoor', schoolName: 'IMCG, G-10/2' });
    expect(t).toContain('Tahira Manzoor');
    expect(t).toContain('IMCG, G-10/2');
    expect(t).toMatch(/history/i);
  });

  it('has an Urdu form', () => {
    expect(removedTeacherAck('ur', { name: 'X', schoolName: 'Y' })).toMatch(/[؀-ۿ]/);
  });
});

describe('refusalBody · every refusal says what to do next', () => {
  it('covers each refusal planAdd can return, in both languages', () => {
    for (const key of ['invalid_phone', 'not_my_school', 'is_coach', 'name_required', 'not_found']) {
      for (const lang of ['en', 'ur']) {
        const t = refusalBody(lang, key);
        expect(t.length).toBeGreaterThan(10);
        if (lang === 'ur') expect(t).toMatch(/[؀-ۿ]/);
      }
    }
  });

  it('falls back to a safe message for an unknown key rather than undefined', () => {
    expect(refusalBody('en', 'no-such-key')).toMatch(/did not go through/i);
  });
});
