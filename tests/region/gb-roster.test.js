'use strict';
/**
 * bd-rj6w0n.14.2 — the GB teacher roster -> users.region / users.school_id (scripts/lib/gb-roster.js).
 *
 * The roster file is gitignored personal data; the seed script reads it at run time and this pure
 * module decides every write. A roster phone that is a user gets the registry's GB region, spelt as
 * region_features.display_name ('Gilgit-Baltistan'; the seed reads it, nothing here hardcodes it), only
 * when her users.region is empty and the roster school (only when users.school_id is empty and
 * the EMIS names exactly one GB school). Nothing else is ever written.
 *
 * No phone-shaped literal in this file: digits are built from parts.
 */

const lib = () => require('../../scripts/lib/gb-roster');
const D = (...p) => p.join('');
const LOCAL = D('3', '00', '0000', '001');            // 10 digits, as the roster holds them
const E164 = D('92', LOCAL);                          // as users.phone_number holds them

describe('normalisePkPhone', () => {
  test.each([
    [LOCAL, E164],
    [D('0', LOCAL), E164],
    [D('+', E164), E164],
    [E164, E164],
    [D('00', E164), E164],
    [D('0', LOCAL.slice(0, 3), ' ', LOCAL.slice(3)), E164],
    [Number(LOCAL), E164],
  ])('%j -> 92 + ten digits', (input, out) => {
    expect(lib().normalisePkPhone(input)).toBe(out);
  });

  test.each([[''], [null], [undefined], ['12345'], [D('1', LOCAL)], [D('44', LOCAL)]])('%j -> null', (input) => {
    expect(lib().normalisePkPhone(input)).toBeNull();
  });
});

describe('normaliseEmis', () => {
  test.each([['12345.0', '12345'], [12345, '12345'], [' 6789 ', '6789'], ['', null], [null, null], ['nan', null]])(
    '%j -> %j', (input, out) => { expect(lib().normaliseEmis(input)).toBe(out); });
});

describe('planRosterWrites', () => {
  const P = (n) => D('92', '300', '000', String(n).padStart(4, '0'));
  const roster = [
    { 'Teacher WhatsApp*': P(1).slice(2), 'School ID/EMIS*': '111.0' },
    { 'Teacher WhatsApp*': P(2).slice(2), 'School ID/EMIS*': '222.0' },
    { 'Teacher WhatsApp*': P(3).slice(2), 'School ID/EMIS*': '111.0' },
    { 'Teacher WhatsApp*': P(4).slice(2), 'School ID/EMIS*': '999.0' },
    { 'Teacher WhatsApp*': P(5).slice(2), 'School ID/EMIS*': '111.0' },
    { 'Teacher WhatsApp*': 'not a phone', 'School ID/EMIS*': '111.0' },
  ];
  const schools = [{ id: 's-111', emis: '111' }, { id: 's-222', emis: '222' }];
  const GB = ['Gilgit-Baltistan'];
  const users = [
    { id: 'u1', phone_number: P(1), region: null, school_id: null },
    { id: 'u2', phone_number: P(2), region: 'Gilgit-Baltistan', school_id: 's-x' },
    { id: 'u3', phone_number: P(3), region: 'Sihala', school_id: null },
    { id: 'u4', phone_number: P(4), region: null, school_id: null },
    { id: 'u9', phone_number: P(9), region: null, school_id: null },
  ];

  test('writes only what is missing, never overwrites, and counts without naming anyone', () => {
    const { writes, counts } = lib().planRosterWrites({ roster, users, schools, gbRegions: GB });
    expect(writes).toEqual([
      { userId: 'u1', patch: { region: 'Gilgit-Baltistan', school_id: 's-111' } },
      { userId: 'u4', patch: { region: 'Gilgit-Baltistan' } },
    ]);
    expect(counts).toEqual({
      rosterRows: 6,
      rosterNumbers: 5,
      unparseable: 1,
      matchedUsers: 4,
      notYetUsers: 1,
      regionSet: 2,
      schoolSet: 1,
      alreadyKnown: 2,
      schoolUnresolved: 1,
    });
  });

  test('a known non-GB region is never overwritten (u3 Sihala) and gets no GB school', () => {
    const { writes } = lib().planRosterWrites({ roster, users, schools, gbRegions: GB });
    expect(writes.find((w) => w.userId === 'u3')).toBeUndefined();
  });

  test('an EMIS naming two GB schools resolves to none (ambiguous, so no school write)', () => {
    const twin = [...schools, { id: 's-111b', emis: '111' }];
    const { writes } = lib().planRosterWrites({ roster, users, schools: twin, gbRegions: GB });
    expect(writes.find((w) => w.userId === 'u1').patch).toEqual({ region: 'Gilgit-Baltistan' });
  });

  test('counts carry no phone and no name', () => {
    const { counts } = lib().planRosterWrites({ roster, users, schools, gbRegions: GB });
    expect(JSON.stringify(counts)).not.toMatch(/\d{9,}/);
  });

  test("the region written is the registry's spelling, whatever it is", () => {
    const { writes } = lib().planRosterWrites({ roster, users, schools, gbRegions: ['Gilgit Baltistan Region'] });
    expect(writes.map((w) => w.patch.region)).toEqual(['Gilgit Baltistan Region', 'Gilgit Baltistan Region']);
  });

  test("a stored value matching the registry's GB region in another case still counts as GB (gets its school)", () => {
    const lower = users.map((u) => (u.id === 'u2' ? { ...u, region: 'gilgit-baltistan', school_id: null } : u));
    const { writes } = lib().planRosterWrites({ roster, users: lower, schools, gbRegions: GB });
    expect(writes.find((w) => w.userId === 'u2').patch).toEqual({ school_id: 's-222' });
  });

  test.each([[[]], [['Gilgit-Baltistan', 'Hunza']], [undefined]])('gbRegions %j: refuses (needs exactly one GB region)', (gbRegions) => {
    expect(() => lib().planRosterWrites({ roster, users, schools, gbRegions })).toThrow(/exactly one/);
  });

  test('the lib holds no region names and no region rule of its own', () => {
    const src = require('fs').readFileSync(require.resolve('../../scripts/lib/gb-roster'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/gilgit|region\.service/i);
  });
});
