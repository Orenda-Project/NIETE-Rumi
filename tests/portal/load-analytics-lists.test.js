/**
 * scripts/load-analytics-lists.js — builds the three app_settings lists the v8 schools analytics counts against,
 * exactly as the RDF defines its populations (routine-data-flow rdf_niete/render.py primary_scope and
 * rdf_niete612/metrics.py cohort), with NO phone in what it writes.
 */
const L = require('../../scripts/load-analytics-lists');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ALLOC = {
  tphone2sect: { 923001110001: 'B.K', 923001110002: 'Sihala', 923001110003: 'Urban-I', 923001110004: 'Durbeen', 923001110005: 'Nilore', 923009990001: 'Tarnol' },
  coachph2name: { 923009990001: 'Mubasher Irfan', 923009990002: 'Mubasher Irfan', 923009990003: 'Saima Jabeen' },
  coachph2sector: { 923009990001: 'Nilore', 923009990002: 'Nilore', 923009990003: 'B.K' },
};
const USERS = [
  { id: U(1), phone_number: '03001110001', role: 'teacher', teacher_level: ['PRIMARY'] }, // 0-prefix → 92
  { id: U(2), phone_number: '+92 300 1110002', role: 'teacher', teacher_level: ['PRIMARY', 'HIGH'], is_test_user: true }, // RDF keeps test users
  { id: U(3), phone_number: '3001110003', role: 'principal', teacher_level: ['PRIMARY'] }, // not a teacher
  { id: U(4), phone_number: '923001110004', role: 'teacher', teacher_level: ['PRIMARY'] }, // sector outside the six
  { id: U(5), phone_number: '923001110005', role: 'teacher', teacher_level: ['MIDDLE'], deleted_at: '2026-10-01' }, // 6-12 drops deleted
  { id: U(6), phone_number: '923001119999', role: 'teacher', teacher_level: ['PRIMARY'] }, // not on the allocation
  { id: U(7), phone_number: '923009990001', role: 'teacher', teacher_level: ['HIGH'] }, // a coach SIM: out of 6-12
  { id: U(8), phone_number: '923009990003', role: 'coach', teacher_level: null },
  { id: U(9), phone_number: '923001110002', role: 'teacher', teacher_level: ['MIDDLE'] }, // second account on a phone
];

describe('load-analytics-lists — the RDF populations', () => {
  const t = L.buildTeacherLists(USERS, ALLOC);

  it('Primary = role teacher, PRIMARY, phone on the allocation in the six sectors; sector from the allocation', () => {
    expect(t.primary).toEqual({ 'B.K': [U(1)], Sihala: [U(2)] });
  });

  it('6-12 = role teacher, not deleted, not a coach SIM, MIDDLE or HIGH, on the allocation in the six', () => {
    expect(t.midHigh).toEqual({ Sihala: [U(2), U(9)] });
  });

  it('sectorByUser: EVERY user on the allocation file in the six sectors, any role (the RDF\'s uid2sect) — principals included', () => {
    expect(t.sectorByUser).toEqual({ 'B.K': [U(1)], Sihala: [U(2), U(9)], 'Urban-I': [U(3)], Nilore: [U(5)], Tarnol: [U(7)] });
  });

  it('stores ids only — no phone anywhere in the value', () => {
    const json = JSON.stringify(L.teachersValue(t, '2026-10-19'));
    expect(json).not.toMatch(/9230|0300/);
  });
});

describe('load-analytics-lists — the RDF coach roster', () => {
  it('one entry per NAME with its sector and the users on its phones; no phone stored', () => {
    const c = L.buildCoachList(USERS, ALLOC);
    expect(c).toEqual([
      { name: 'Mubasher Irfan', sector: 'Nilore', userIds: [U(7)] },
      { name: 'Saima Jabeen', sector: 'B.K', userIds: [U(8)] },
    ]);
    expect(JSON.stringify(c)).not.toMatch(/92300/);
  });
});

describe('load-analytics-lists — the FDE school list', () => {
  it('reads the governed snapshot: every EMIS once, counted per sector', () => {
    const v = L.buildSchoolList({ _as_of: '2026-10-19', by_sector: { 'B.K': ['401', '402'], Sihala: ['501'] } });
    expect(v).toEqual({ emis: ['401', '402', '501'], bySector: { 'B.K': 2, Sihala: 1 }, asOf: '2026-10-19' });
  });

  it('refuses a duplicated EMIS or a sector outside the six', () => {
    expect(() => L.buildSchoolList({ by_sector: { 'B.K': ['401'], Sihala: ['401'] } })).toThrow(/twice/);
    expect(() => L.buildSchoolList({ by_sector: { Durbeen: ['1'] } })).toThrow(/sector/);
  });
});

describe('load-analytics-lists — the target guard', () => {
  it('asserts the project ref before any client exists', () => {
    expect(() => L.assertProjectRef('https://olvritwoqujtjvwfulbh.supabase.co', 'ihzciabopbttygxxgrkm')).toThrow(/ABORT/);
    expect(L.assertProjectRef('https://olvritwoqujtjvwfulbh.supabase.co', 'olvritwoqujtjvwfulbh')).toBe('olvritwoqujtjvwfulbh');
  });

  it('dry run by default; --commit writes', () => {
    expect(L.parseArgs(['--env', 'sandbox']).commit).toBe(false);
    expect(L.parseArgs(['--env', 'sandbox', '--commit']).commit).toBe(true);
  });
});
