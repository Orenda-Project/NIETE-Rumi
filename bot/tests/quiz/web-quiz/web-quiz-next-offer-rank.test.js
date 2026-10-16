'use strict';
/**
 * The ranked next thing (web-quiz-next-offer.js `rank`), pure: the teacher pin first, the month's stop in
 * the first two home opens (never one "on its way"), resume once a PKT day, then the scores file's order per ctx
 * (VALUE override), ties -> newest unseen, a pos-0 shown twice and not tapped drops one place, overlapping CIs rotate
 * (stable within a day), the arm (rank / rand / ctrl) and an honest `rank_src`.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const NO = require('../../../shared/services/quiz/web-quiz-next-offer');
const FILE = require('../../../shared/services/quiz/next-offer-weights.json');

const NOW = '2026-10-16T09:00:00.000Z';
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86400000).toISOString();

const quizPin = (over = {}) => ({ kind: 'quiz', variant: 'new', id: 'qk-pin', href: '/q/AB12?k=x', title: "Your teacher's quiz: Science", rule: 'teacher_quiz', sent_at: daysAgo(2), ...over });
const again = { kind: 'quiz', variant: 'again', id: 'qk-again', href: '/q/CD34?k=y', title: 'Play again: Maths' };
const video = { kind: 'video', variant: 'recommended', id: 'vid-1', href: '/lib/t?kid=c&v=vid-1', title: 'Watch: Water', needs_root: true };
const story = (id, released, seen = false) => ({ kind: 'story', id, href: `/c/t?kid=c&room=story&pid=${id}`, title: `Story ${id}`, released_at: released, seen });
const stopRead = (over = {}) => ({ kind: 'story', id: 'stop.read', href: '/c/t?kid=c#read', title: 'Read a story with Jugnu', rule: 'month_stop', ...over });
const book = { kind: 'storybook', id: 'sb-7', href: '/s/sb-7/4', title: 'Finish your story', rule: 'resume' };
const game = { kind: 'game', id: 'numbers', href: '/c/t?kid=c&room=story#numbers', title: 'Play the numbers game' };
const invite = { kind: 'invite', id: 'invite', href: '/h/t#invite', title: 'Invite a friend' };

const base = (over = {}) => ({ arm: 'rank', seed: 'kid-1|20742', now: NOW, monthOpens: 5, resumeToday: false, streak: null, has_root: true, ...over });

describe('rule 1 — the teacher quiz (≤ 7 days, unfinished) is always first', () => {
  test('a pending teacher quiz beats every other candidate, in every arm', () => {
    for (const arm of ['rank', 'rand', 'ctrl']) {
      const r = NO.rank('home', [video, again, stopRead(), book, quizPin()], base({ arm, monthOpens: 1 }), FILE);
      expect(r.next.kind).toBe('quiz');
      expect(r.next.id).toBe('qk-pin');
      expect(r.next.rank_src).toBe('pinned');
      expect(r.meta.rule).toBe('teacher_quiz');
    }
  });
  test('a teacher quiz sent 8 days ago is not pinned: it competes as a new quiz', () => {
    const r = NO.rank('after_quiz', [quizPin({ sent_at: daysAgo(8) }), video], base(), FILE);
    expect(r.meta.rule).toBe('none');
    expect(r.next.rank_src).not.toBe('pinned');
  });
});

describe('rule 2 — the first 2 home opens of a month: the unplayed stop', () => {
  test('opens 1 and 2 → the stop (rank_src rule); open 3 → it competes', () => {
    for (const n of [1, 2]) {
      const r = NO.rank('home', [video, stopRead()], base({ monthOpens: n }), FILE);
      expect(r.next.id).toBe('stop.read');
      expect(r.next.rank_src).toBe('rule');
      expect(r.meta.rule).toBe('month_stop');
    }
    const r3 = NO.rank('home', [video, stopRead()], base({ monthOpens: 3 }), FILE);
    expect(r3.meta.rule).toBe('none');
    expect(r3.next.id).toBe('vid-1');
  });
  test('a stop the server would answer "on its way" is never offered, anywhere', () => {
    const r = NO.rank('home', [stopRead({ on_its_way: true }), game], base({ monthOpens: 1 }), FILE);
    expect(r.next.id).toBe('numbers');
    expect([r.next, ...r.next.alts].map((c) => c.id)).not.toContain('stop.read');
  });
  test('a result card before any home open this month (0 opens) → the stop too (the 1st-of-month finish)', () => {
    const r = NO.rank('after_quiz', [video, again, stopRead()], base({ monthOpens: 0 }), FILE);
    expect(r.next.id).toBe('stop.read');
    expect(r.meta.rule).toBe('month_stop');
  });
  test('after a weak read, never another read-aloud (a listening story / video / game instead)', () => {
    const r = NO.rank('after_read_weak', [stopRead({ read_aloud: true }), { ...story('l1', daysAgo(1)), read_aloud: false }, game], base({ monthOpens: 1 }), FILE);
    expect([r.next, ...r.next.alts].map((c) => c.id)).not.toContain('stop.read');
  });
  test('rule 1 beats rule 2', () => {
    const r = NO.rank('home', [stopRead(), quizPin()], base({ monthOpens: 1 }), FILE);
    expect(r.meta.rule).toBe('teacher_quiz');
  });
});

describe('rule 1b — resume beats new, at most once a PKT day', () => {
  test('a half-finished storybook comes before the ranked list, then not again today', () => {
    const r = NO.rank('after_quiz', [video, again, book], base(), FILE);
    expect(r.next.id).toBe('sb-7');
    expect(r.next.rank_src).toBe('rule');
    expect(r.meta.rule).toBe('resume');
    const r2 = NO.rank('after_quiz', [video, again, book], base({ resumeToday: true }), FILE);
    expect(r2.next.id).not.toBe('sb-7');
  });
  test('rule 2 beats resume; rule 1 beats both', () => {
    expect(NO.rank('home', [book, stopRead()], base({ monthOpens: 2 }), FILE).meta.rule).toBe('month_stop');
    expect(NO.rank('home', [book, stopRead(), quizPin()], base({ monthOpens: 2 }), FILE).meta.rule).toBe('teacher_quiz');
  });
});

describe('the ranked list — the scores file per ctx', () => {
  test('after_quiz: video and play-again are the significant rows; story (null score) after scored kinds', () => {
    const r = NO.rank('after_quiz', [story('en.read.1.k01', daysAgo(1)), invite, again, video, game], base({ seed: 'no-rotate' }), FILE);
    const ids = [r.next.id, ...r.next.alts.map((a) => a.id)];
    expect(['vid-1', 'qk-again']).toContain(ids[0]);
    expect(r.next.rank_src).toBe('significant');
    expect(r.next.score_v).toBe(FILE.v);
    expect(r.meta.order.indexOf('en.read.1.k01')).toBeGreaterThan(r.meta.order.indexOf('numbers'));
  });
  test('home: no significant row → every ranked slot is "prior"', () => {
    const r = NO.rank('home', [video, again, game, story('s1', daysAgo(1))], base(), FILE);
    expect(r.next.rank_src).toBe('prior');
    r.next.alts.forEach((a) => expect(['prior']).toContain(a.rank_src));
  });
  test('an unknown ctx falls back to the home table, never throws', () => {
    const r = NO.rank('teacher_home', [game, video], base(), FILE);
    expect(r.next).toBeTruthy();
  });
  test('the VALUE override replaces the file: a table that puts the game first wins', () => {
    const W = { v: 'override-1', contexts: { after_quiz: [{ kind: 'game', score: 50, ci: [40, 60], n: 9, evidence: 'significant' }, { kind: 'video', score: 1, ci: null, n: 1, evidence: 'prior' }] } };
    const r = NO.rank('after_quiz', [video, game], base(), W);
    expect(r.next.id).toBe('numbers');
    expect(r.next.score_v).toBe('override-1');
    expect(r.next.score).toBe(50);
  });
  test('ties → the newest unseen first', () => {
    const r = NO.rank('home', [story('old', daysAgo(9)), story('seenNew', daysAgo(1), true), story('new', daysAgo(2))], base({ seed: 'x' }), { v: 't', contexts: { home: [{ kind: 'story', score: null, ci: null, n: 0, evidence: 'prior' }] } });
    expect(r.meta.order).toEqual(['new', 'old', 'seenNew']);
  });
  test('a pos-0 shown twice in a row and not tapped drops one place', () => {
    const W = { v: 't', contexts: { home: [{ kind: 'video', score: 9, ci: null, n: 1, evidence: 'prior' }, { kind: 'game', score: 3, ci: null, n: 1, evidence: 'prior' }] } };
    expect(NO.rank('home', [video, game], base({ streak: { id: 'vid-1', n: 1 } }), W).next.id).toBe('vid-1');
    const r = NO.rank('home', [video, game], base({ streak: { id: 'vid-1', n: 2 } }), W);
    expect(r.next.id).toBe('numbers');
    expect(r.next.alts[0].id).toBe('vid-1');
  });
  test('overlapping CIs rotate the top two, stable within a day (seeded by child key + day)', () => {
    const W = { v: 't', contexts: { home: [{ kind: 'video', score: 10, ci: [5, 15], n: 9, evidence: 'significant' }, { kind: 'game', score: 8, ci: [4, 12], n: 9, evidence: 'significant' }] } };
    const firsts = new Set();
    for (let d = 0; d < 40; d += 1) {
      const a = NO.rank('home', [video, game], base({ seed: `kid-1|${d}` }), W).next.id;
      const b = NO.rank('home', [video, game], base({ seed: `kid-1|${d}` }), W).next.id;
      expect(a).toBe(b);
      firsts.add(a);
    }
    expect(firsts).toEqual(new Set(['vid-1', 'numbers']));
    // non-overlapping CIs never rotate
    const W2 = { v: 't', contexts: { home: [{ kind: 'video', score: 20, ci: [16, 24], n: 9, evidence: 'significant' }, { kind: 'game', score: 3, ci: [1, 5], n: 9, evidence: 'significant' }] } };
    for (let d = 0; d < 20; d += 1) expect(NO.rank('home', [video, game], base({ seed: `k|${d}` }), W2).next.id).toBe('vid-1');
  });
});

describe('eligibility', () => {
  test('never a video to a child with no class root (409 no_class)', () => {
    const r = NO.rank('after_quiz', [video, again], base({ has_root: false }), FILE);
    expect([r.next, ...r.next.alts].map((c) => c.kind)).not.toContain('video');
  });
  test('no candidates → null (the caller keeps today\'s lantern)', () => {
    expect(NO.rank('home', [], base(), FILE)).toBeNull();
    expect(NO.rank('home', [{ kind: 'story', id: 'x' }], base(), FILE)).toBeNull(); // no href/title: not offerable
  });
  test('alts: at most 2, never the primary again', () => {
    const r = NO.rank('after_quiz', [video, again, game, invite, story('s', daysAgo(1))], base(), FILE);
    expect(r.next.alts.length).toBeLessThanOrEqual(2);
    expect(r.next.alts.map((a) => a.id)).not.toContain(r.next.id);
  });
});

describe('the arm', () => {
  test('armOf is per child per PKT day, 70 / 20 / 10', () => {
    const n = { rank: 0, rand: 0, ctrl: 0 };
    for (let i = 0; i < 5000; i += 1) n[NO.armOf(`kid-${i}`, 20742)] += 1;
    expect(n.rank / 5000).toBeGreaterThan(0.66); expect(n.rank / 5000).toBeLessThan(0.74);
    expect(n.rand / 5000).toBeGreaterThan(0.17); expect(n.rand / 5000).toBeLessThan(0.23);
    expect(n.ctrl / 5000).toBeGreaterThan(0.08); expect(n.ctrl / 5000).toBeLessThan(0.12);
    expect(NO.armOf('kid-1', 20742)).toBe(NO.armOf('kid-1', 20742));
  });
  test('rand: the primary kind is drawn among the eligible kinds and says rank_src rand', () => {
    const kinds = new Set();
    for (let d = 0; d < 60; d += 1) {
      const r = NO.rank('after_quiz', [video, again, game, story('s', daysAgo(1))], base({ arm: 'rand', seed: `k|${d}` }), FILE);
      expect(r.next.rank_src).toBe('rand');
      expect(r.next.arm).toBe('rand');
      kinds.add(r.next.kind);
    }
    expect(kinds).toEqual(new Set(['video', 'quiz', 'game', 'story']));
    expect(NO.rank('after_quiz', [video, again, game], base({ arm: 'rand' }), FILE).meta.elig).toEqual(['game', 'quiz', 'video']);
  });
  test('ctrl: today\'s lantern candidate is the primary', () => {
    const lantern = { ...story('s-lantern', daysAgo(1)), lantern: true };
    const r = NO.rank('home', [video, again, lantern], base({ arm: 'ctrl' }), FILE);
    expect(r.next.id).toBe('s-lantern');
    expect(r.next.arm).toBe('ctrl');
    expect(r.next.rank_src).toBe('rule');
  });
});

describe('the committed weights file', () => {
  test('is the contracts file v1 shape with evidence on every row and a source line', () => {
    expect(FILE._source).toMatch(/next_offer_scores/);
    expect(typeof FILE.v).toBe('string');
    Object.values(FILE.contexts).forEach((rows) => rows.forEach((r) => expect(['significant', 'prior']).toContain(r.evidence)));
    expect(Object.keys(FILE.contexts)).toEqual(expect.arrayContaining(['after_quiz', 'home', 'ftue', 'after_read', 'after_read_weak', 'after_quiz_low', 'after_game', 'after_story', 'after_video']));
  });
});

describe('the table\'s variant names', () => {
  test('home: a teacher quiz scores as the `teacher` row, play again as the `last` row', () => {
    const r = NO.rank('home', [{ ...quizPin({ rule: undefined }), variant: 'new' }, again], base(), FILE);
    const home = FILE.contexts.home;
    const all = [r.next, ...r.next.alts];
    expect(all.find((x) => x.id === 'qk-pin').score).toBe(home.find((x) => x.variant === 'teacher').score);
    expect(all.find((x) => x.id === 'qk-again').score).toBe(home.find((x) => x.variant === 'last').score);
  });
});
