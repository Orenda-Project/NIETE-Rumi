/**
 * bd-o98ji — resolving a coach to her work email, deterministically. Red-first.
 *
 * WHY THERE IS NO SIMILARITY RATIO ANYWHERE IN HERE
 * -------------------------------------------------
 * A difflib pass at cutoff 0.80, run while preparing this work, matched
 * `Farida Malik` → `zarina.shahid@otherorg.example`. A different person, at a
 * different company. It scored well because the two strings share letters.
 *
 * One wrong match puts a school visit on a stranger's calendar. A miss leaves a
 * coach without an invite and a line in a CSV for a human. Those two failures
 * are not comparable, so the matcher is allowed only decisions it can justify:
 * normalised equality, the email local-part, or the same words in another order.
 *
 * The three normalisations, in order:
 *   1. strip Unicode control characters — several HRMIS names carry invisible
 *      bidi marks (U+200E), e.g. "‎Kamil Asif‎", which never match;
 *   2. expand the honorific prefix — "M. rizwan" is "muhammad rizwan";
 *   3. match against BOTH the full name AND the email local-part, because HRMIS
 *      often stores only a given name ("Nasreen", "Farida") while the mailbox
 *      encodes first.last. That is what resolves Farida correctly.
 */

const {
  normalizeCoachName, nameFromEmail, matchesRosterName, resolveRosterName,
} = require('../../shared/services/observe/coach-directory');

describe('bd-o98ji — the normaliser is pure and total', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(normalizeCoachName('  Nasreen   IQBAL ')).toBe('nasreen iqbal');
    expect(normalizeCoachName('nasreen iqbal')).toBe('nasreen iqbal');
  });

  it('strips the invisible bidi marks HRMIS stores', () => {
    expect(normalizeCoachName('‎Kamil Asif‎')).toBe('kamil asif');
    expect(normalizeCoachName('‫Farida‬ Malik')).toBe('farida malik');
    expect(normalizeCoachName('Nadia​Afzal')).toBe('nadiaafzal');
  });

  it('expands the honorific prefix in every spelling we have seen', () => {
    expect(normalizeCoachName('M. rizwan')).toBe('muhammad rizwan');
    expect(normalizeCoachName('Md Rizwan')).toBe('muhammad rizwan');
    expect(normalizeCoachName('Mohd. Rizwan')).toBe('muhammad rizwan');
    expect(normalizeCoachName('Muhammad Rizwan')).toBe('muhammad rizwan');
  });

  it('expands the honorific only in front position', () => {
    // "Ali M. Rizwan" is a different person from "Muhammad Rizwan"; an honorific
    // in the middle of a name is a middle initial, not a title.
    expect(normalizeCoachName('Ali M. Rizwan')).toBe('ali m rizwan');
  });

  it('drops the punctuation a roster picks up but keeps the words apart', () => {
    expect(normalizeCoachName('Ch. Adnan Hussain-Shahid')).toBe('ch adnan hussain shahid');
  });

  it('never throws on junk', () => {
    for (const junk of [null, undefined, '', '   ', 42, {}, []]) {
      expect(normalizeCoachName(junk)).toBe('');
    }
  });
});

describe('bd-o98ji — the email local-part is a name source', () => {
  it('reads first.last out of a mailbox', () => {
    expect(nameFromEmail('nasreen.iqbal@example.edu')).toBe('nasreen iqbal');
    expect(nameFromEmail('tahira.zia@example.edu')).toBe('tahira zia');
    expect(nameFromEmail('farida.malik@example.edu')).toBe('farida malik');
  });

  it('handles the separators a mailbox actually uses', () => {
    expect(nameFromEmail('hina_kokab@example.edu')).toBe('hina kokab');
    expect(nameFromEmail('rukhsana-nisar@example.edu')).toBe('rukhsana nisar');
  });

  it('leaves a single-token mailbox as one token', () => {
    expect(nameFromEmail('nargis@example.edu')).toBe('nargis');
  });

  it('never throws on junk', () => {
    for (const junk of [null, '', 'not-an-email', '@example.edu']) {
      expect(typeof nameFromEmail(junk)).toBe('string');
    }
  });
});

describe('bd-o98ji — what counts as a match', () => {
  it('matches the HRMIS full name', () => {
    expect(matchesRosterName('Nasreen Iqbal', 'nasreen iqbal', 'x@example.edu')).toBe(true);
  });

  it('matches through the mailbox when HRMIS holds only a given name', () => {
    // The load-bearing case: this is how Farida resolves, and it is why the
    // fuzzy pass was not needed in the first place.
    expect(matchesRosterName('Farida Malik', 'Farida', 'farida.malik@example.edu')).toBe(true);
    expect(matchesRosterName('Nasreen Iqbal', 'Nasreen', 'nasreen.iqbal@example.edu')).toBe(true);
  });

  it('matches the same words in another order', () => {
    expect(matchesRosterName('Iqbal Nasreen', 'Nasreen Iqbal', 'x@example.edu')).toBe(true);
  });

  it('matches across an honorific', () => {
    expect(matchesRosterName('M. rizwan', 'Muhammad Rizwan', 'x@example.edu')).toBe(true);
  });

  it('REFUSES the near miss that a similarity ratio accepted', () => {
    // Farida Malik vs Zarina Shahid: 0.80 on difflib, a different person.
    expect(matchesRosterName('Farida Malik', 'Zarina Shahid', 'zarina.shahid@otherorg.example'))
      .toBe(false);
  });

  it('REFUSES a first-name-only overlap', () => {
    expect(matchesRosterName('Kamila Jabeen', 'Kamila Noor', 'rabia.noor@example.edu')).toBe(false);
  });

  it('REFUSES a subset — more words is not the same person', () => {
    expect(matchesRosterName('Kamil Asif', 'Kamil', 'saim@example.edu')).toBe(false);
  });

  it('never throws on junk', () => {
    expect(matchesRosterName(null, null, null)).toBe(false);
  });
});

describe('bd-o98ji — resolving one roster name against a set of candidates', () => {
  const candidates = [
    { phone: '923000000004', name: 'Nasreen Iqbal' },
    { phone: '923000000000', name: 'Tahir Anwar' },
    { phone: '923000000001', name: 'M. rizwan' },
  ];

  it('returns the single deterministic match', () => {
    const r = resolveRosterName('Nasreen Iqbal', candidates);
    expect(r.ok).toBe(true);
    expect(r.match.phone).toBe('923000000004');
  });

  it('resolves through the honorific', () => {
    expect(resolveRosterName('Muhammad Rizwan', candidates).match.phone).toBe('923000000001');
  });

  it('reports no match rather than picking the closest', () => {
    const r = resolveRosterName('Farida Malik', candidates);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_match');
    expect(r.match).toBeNull();
  });

  it('REFUSES an ambiguous name instead of choosing one', () => {
    // Real: the ICT roster lists "Waqar Irfan" against two phone numbers.
    // Choosing either would put half this coach's visits on the wrong calendar.
    const dupes = [
      { phone: '923000000003', name: 'Waqar Irfan' },
      { phone: '923000000005', name: 'Waqar Irfan' },
    ];
    const r = resolveRosterName('Waqar Irfan', dupes);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('is total', () => {
    expect(resolveRosterName(null, null).ok).toBe(false);
    expect(resolveRosterName('x', []).ok).toBe(false);
  });
});

// ── the seed's planning step ─────────────────────────────────────────────────
const { planSeed, toCsv, assertProjectRef } = require('../../../scripts/seed-coach-directory');

describe('bd-o98ji — planning the seed', () => {
  const phoneToName = {
    '923000000004': 'Nasreen Iqbal',
    '923000000000': 'Tahir Anwar',
    '923000000002': 'Farida Malik',
  };
  const users = { '923000000004': 'u-nasreen', '923000000000': 'u-tahir' };
  const pair = (n, e) => ({ roster_name: n, email: e, sector: 'Urban-I' });

  it('writes an exact match', () => {
    const { rows } = planSeed([pair('Nasreen Iqbal', 'nasreen.iqbal@example.edu')], phoneToName, users);
    expect(rows).toEqual([{
      leader_user_id: 'u-nasreen',
      full_name: 'Nasreen Iqbal',
      work_email: 'nasreen.iqbal@example.edu',
      match_method: 'exact',
    }]);
  });

  it('never writes a near match — it goes to the human, with a reason', () => {
    const { rows, unresolved } = planSeed(
      [pair('Zarina Shahid', 'zarina.shahid@otherorg.example')], phoneToName, users);
    expect(rows).toHaveLength(0);
    expect(unresolved[0].reason).toBe('no_match');
  });

  it('never writes an ambiguous name', () => {
    const dupes = { '923000000003': 'Waqar Irfan', '923000000005': 'Waqar Irfan' };
    const { rows, unresolved } = planSeed(
      [pair('Waqar Irfan', 'waqar.irfan@example.edu')], dupes,
      { '923000000003': 'u-a', '923000000005': 'u-b' });
    expect(rows).toHaveLength(0);
    expect(unresolved[0].reason).toBe('ambiguous');
    expect(unresolved[0].detail).toContain('923000000003');
  });

  it('never writes a coach who has no bot account', () => {
    const { rows, unresolved } = planSeed(
      [pair('Farida Malik', 'farida.malik@example.edu')], phoneToName, users);
    expect(rows).toHaveLength(0);
    expect(unresolved[0].reason).toBe('no_user');
    expect(unresolved[0].detail).toBe('923000000002');
  });

  it('refuses to write two rows for one coach', () => {
    const { rows, unresolved } = planSeed([
      pair('Nasreen Iqbal', 'nasreen.iqbal@example.edu'),
      pair('Nasreen Iqbal', 'b.karim@example.edu'),
    ], phoneToName, users);
    expect(rows).toHaveLength(1);
    expect(unresolved.map((u) => u.reason)).toContain('duplicate_user');
  });

  it('is idempotent by construction — the plan is a pure function of its inputs', () => {
    const args = [[pair('Nasreen Iqbal', 'nasreen.iqbal@example.edu')], phoneToName, users];
    expect(planSeed(...args)).toEqual(planSeed(...args));
  });

  it('is total', () => {
    expect(planSeed(null, null, null)).toEqual({ rows: [], unresolved: [] });
    expect(planSeed([{}], phoneToName, users).unresolved[0].reason).toBe('incomplete_pair');
  });

  it('writes a CSV a human can open, escaping what needs escaping', () => {
    const csv = toCsv([{ roster_name: 'A "B"', email: 'a@b.c', reason: 'no_match', detail: '' }]);
    expect(csv.split('\n')[0]).toBe('roster_name,email,reason,detail');
    expect(csv).toContain('"A ""B"""');
  });
});

describe('bd-o98ji — the seed refuses the wrong database', () => {
  it('accepts the project it was told to write', () => {
    expect(assertProjectRef('https://rpqkekcfvumypldbejhp.supabase.co', 'rpqkekcfvumypldbejhp'))
      .toBe('rpqkekcfvumypldbejhp');
  });

  it('aborts on prod when staging was asked for — the worktree .env trap (bd-2533)', () => {
    expect(() => assertProjectRef('https://ihzciabopbttygxxgrkm.supabase.co', 'rpqkekcfvumypldbejhp'))
      .toThrow(/Refusing to write/);
  });

  it('aborts on an unparseable URL rather than assuming', () => {
    expect(() => assertProjectRef('', 'rpqkekcfvumypldbejhp')).toThrow(/could not parse/);
  });
});
