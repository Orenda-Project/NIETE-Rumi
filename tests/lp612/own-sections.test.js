'use strict';
/**
 * bd-snkn32.19 (unified spec item 7, screen 9) — her made plan as section cards, read from the JSON stored beside the
 * PDF. 1–5: the script's hook / iDo / weDo / youDo / wrap; 6–12: objectives and the plan's sections, in that order.
 * After a change, the changed section carries its text from the plan before.
 */
const { sectionsOf, ownSections } = require('../../bot/shared/services/lp-own-sections');
const BASE = require('./__fixtures__/v9_gate_base.lp.json');

const SCRIPT = { goal: 'Count', meta: { day: 3 }, hook: { say: 'Sing' }, iDo: { steps: ['Show 3', 'Show 4'] }, weDo: { say: 'Count caps' }, youDo: { say: 'Count sticks' }, wrap: { say: 'Bye' } };

describe('sectionsOf', () => {
  it('1–5: the five parts in order, text only', () => {
    const s = sectionsOf(SCRIPT, 'k5');
    expect(s.map((x) => x.part)).toEqual(['hook', 'i_do', 'we_do', 'you_do', 'wrap']);
    expect(s[1].text).toBe('Show 3\nShow 4');
  });
  it('6–12: objectives then the plan\'s sections in the guard\'s order; ids, types and minutes are not text', () => {
    const s = sectionsOf(BASE, 'g612');
    expect(s.map((x) => x.part)).toEqual(['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework']);
    const act = s.find((x) => x.part === 'activity').text;
    expect(act).toMatch(/We do — together on the board/);
    expect(act).not.toMatch(/faded_example|wedo\b/);
  });
  it('nothing usable is no cards', () => {
    expect(sectionsOf(null, 'k5')).toEqual([]);
    expect(sectionsOf({ sections: 'x' }, 'g612')).toEqual([]);
  });
});

describe('ownSections', () => {
  const ROOT = { id: 'root', user_id: 'u1', parent_own_id: null, status: 'ready', lesson_id: 'g3_d4', r2_key: 'own/root.pdf', edit_round: 0 };
  const ONE = { id: 'one', user_id: 'u1', parent_own_id: 'root', status: 'ready', lesson_id: 'g3_d4', r2_key: 'own/one.pdf', edit_round: 1, edit_request: { part: 'we_do', text: 'Make it a game' } };
  const docs = { 'own/root.json': SCRIPT, 'own/one.json': { ...SCRIPT, weDo: { say: 'Game with caps' } } };
  const deps = (row) => ({
    selectOwn: jest.fn(async (id, userId) => (id === row.id && userId === row.user_id ? row : null)),
    listChain: jest.fn(async () => [ROOT, ONE]),
    readJson: jest.fn(async (key) => docs[key] || null),
  });

  it('a made plan: its cards, nothing changed', async () => {
    const out = await ownSections(deps(ROOT), { ownId: 'root', userId: 'u1' });
    expect(out).toMatchObject({ outcome: 'ok', band: 'k5', changed: null });
    expect(out.sections).toHaveLength(5);
  });
  it('a change: the changed card has the text from before', async () => {
    const out = await ownSections(deps(ONE), { ownId: 'one', userId: 'u1' });
    expect(out.changed).toBe('we_do');
    const we = out.sections.find((s) => s.part === 'we_do');
    expect(we).toEqual({ part: 'we_do', text: 'Game with caps', before: 'Count caps' });
    expect(out.sections.find((s) => s.part === 'hook').before).toBeUndefined();
  });
  it('not hers, not ready, or no stored document is not found', async () => {
    expect((await ownSections(deps(ROOT), { ownId: 'root', userId: 'u2' })).outcome).toBe('not_found');
    expect((await ownSections(deps({ ...ROOT, status: 'authoring' }), { ownId: 'root', userId: 'u1' })).outcome).toBe('not_found');
    expect((await ownSections(deps({ ...ROOT, r2_key: 'own/none.pdf' }), { ownId: 'root', userId: 'u1' })).outcome).toBe('not_found');
    expect((await ownSections(deps(ROOT), { ownId: '', userId: 'u1' })).outcome).toBe('not_found');
  });
});
