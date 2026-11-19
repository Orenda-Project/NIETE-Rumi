'use strict';
/**
 * bd-snkn32.58.2 (queue #155 B) — the guard's blocked words, on the server, for both paths:
 *   a goal start's typed topic with a blocked word is refused even if a forged request skips the portal;
 *   the Check screen's free-text note with a blocked word is dropped (never sent to the model), and the answers say so.
 */
const { parseOwnAnswers } = require('../../bot/shared/services/lp612-own-instruction');

const base = { size: '31_50', level: 'on_track', way: 'games', resources: [] };

describe('blocked words on the server', () => {
  it('a typed topic with a blocked word is refused', () => {
    const r = parseOwnAnswers({ ...base, goal: { kind: 'topic', text: 'counting guns' } });
    expect(r.ok).toBe(false);
  });
  it('an official goal or an ordinary topic still passes', () => {
    expect(parseOwnAnswers({ ...base, goal: { kind: 'topic', text: 'multiply by 2' } }).ok).toBe(true);
  });
  it('a note with a blocked word is dropped and flagged; an ordinary note is kept', () => {
    const dropped = parseOwnAnswers({ ...base, note: 'add a gun game at the end' });
    expect(dropped.ok).toBe(true);
    expect(dropped.answers.note).toBe('');
    expect(dropped.answers.noteDropped).toBe(true);
    const kept = parseOwnAnswers({ ...base, note: 'use the playground' });
    expect(kept.answers.note).toBe('use the playground');
    expect(kept.answers.noteDropped).toBeUndefined();
  });
});

describe('the dropped note is reported back (bd-snkn32.58.2)', () => {
  const { createOwnService } = require('../../bot/shared/services/lp612-own.service');
  const SEG = 'grade_8_science.c02.p010-013';
  const deps = () => ({
    templateVersion: () => 'v9.1', segmentExists: async () => true, readStoredDoc: async () => ({ sections: {} }),
    requestParent: async () => ({ outcome: 'queued' }), insertOwn: async () => ({ id: 'own-1' }), patchOwn: jest.fn(),
    queueJob: async () => {}, countToday: async () => 0, goalStartOn: async () => true, now: () => Date.now(), log: jest.fn(),
  });
  const A = { size: '51_70', resources: [], level: 'mixed', way: 'worked' };

  it('queued with noteDropped when her note had a blocked word; not otherwise', async () => {
    const svc = createOwnService(deps());
    expect(await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...A, note: 'a gun game' } }))
      .toEqual(expect.objectContaining({ outcome: 'queued', noteDropped: true }));
    expect((await svc.requestOwn({ userId: 'u1', segmentId: SEG, answers: { ...A, note: 'outside' } })).noteDropped).toBeUndefined();
  });
});
