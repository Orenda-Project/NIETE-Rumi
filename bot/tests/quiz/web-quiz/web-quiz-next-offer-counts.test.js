'use strict';
/**
 * scripts/web-quiz/counts/web_quiz_next_offer.js: the read-only table of what the ranked Next tile can offer the
 * smallest-served children. Here: the sandbox guard (the project's own host only, never a substring), the per-kind
 * counts and the exit rule (non-zero when a child's home would be empty OR a kind today's pick offers is lost with the
 * switch on). The ranker is the real one, on hand-built candidates; nothing reaches a database.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const Counts = require('../../../../scripts/web-quiz/counts/web_quiz_next_offer');
const NO = require('../../../shared/services/quiz/web-quiz-next-offer');

const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };
const REF = Counts.SANDBOX_REF;
const c = (kind, id, extra = {}) => ({ kind, id, href: `/x/${id}`, title: `T ${id}`, ...extra });

describe('the sandbox guard', () => {
  test.each([
    ['no ref on argv', [], { SUPABASE_URL: `https://${REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['another ref on argv', ['ihzciabopbttygxxgrkm'], { SUPABASE_URL: `https://${REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['the ref only in the path', [REF], { SUPABASE_URL: `https://ihzciabopbttygxxgrkm.supabase.co/${REF}`, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['the ref as a subdomain of another host', [REF], { SUPABASE_URL: `https://${REF}.example.com`, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['no key', [REF], { SUPABASE_URL: `https://${REF}.supabase.co` }],
    ['not a URL', [REF], { SUPABASE_URL: REF, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
  ])('%s -> REFUSED, exit 2, nothing read', async (_n, argv, env) => {
    const o = io();
    expect(await Counts.main({ argv, env, io: o })).toBe(2);
    expect(o.err.join('')).toMatch(/^REFUSED: not sandbox/);
    expect(o.out).toEqual([]);
  });

  test('the project\'s own host passes the guard', () => {
    expect(Counts.hostIs(`https://${REF}.supabase.co`, REF)).toBe(true);
    expect(Counts.hostIs(`https://x${REF}.supabase.co`, REF)).toBe(false);
  });
});

describe('the counts and the exit rule', () => {
  const now = new Date().toISOString();
  const table = (list, hasRoot = false) => Counts.tableFor('child-1', list, { hasRoot, rank: NO.rank, weights: NO.FILE_WEIGHTS, now });

  test('per kind: all / today\'s pick (OFF) / the slot (ON), and a Next in every arm', () => {
    const t = table([c('game', 'stop.bigger', { lantern: true }), c('story', 'p1'), c('story', 'p2', { on_its_way: true })]);
    expect(t.rows.find((r) => r.kind === 'story')).toEqual({ kind: 'story', all: 2, off: 0, on: 1 });
    expect(t.rows.find((r) => r.kind === 'game')).toEqual({ kind: 'game', all: 1, off: 1, on: 1 });
    expect(Object.keys(t.chosen)).toEqual(['rank', 'rand', 'ctrl']);
    expect(t.chosen.ctrl.id).toBe('stop.bigger');
    expect(Counts.lostOf(t)).toEqual([]);
  });

  test('a kind today\'s pick offers that the slot cannot (a video that needs a class quiz) is LOST', () => {
    const t = table([c('video', 'library', { lantern: true, needs_root: true }), c('story', 'p1')]);
    expect(Counts.lostOf(t)).toEqual(['video']);
    expect(Counts.lostOf(table([c('video', 'library', { lantern: true, needs_root: true }), c('story', 'p1')], true))).toEqual([]);
  });
});
