'use strict';
/**
 * bd-m8zwt1.1 — a grades 1–5 goal plan whose first goal check fails gets ONE fix: the goal gate hands the band's
 * rewrite the fix instruction as a plain string. The K-5 change lane only knew {part, text}, so every such fix threw
 * "k5EditMessages: unknown part undefined" and the teacher got "Couldn't make it" (4 of 4 runs on the test sites).
 */
const { k5EditMessages } = require('../../bot/shared/services/lp-own-edit-instruction');
const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');

const script = {
  goal: 'Add numbers up to 4 digits.',
  hook: { minutes: 5, text: 'Show 2 baskets.' },
  iDo: { minutes: 10, text: 'I add 23 + 14.' },
  weDo: { minutes: 10, text: 'We add 31 + 25.' },
  youDo: { minutes: 10, text: 'You add 42 + 36.' },
  wrap: { minutes: 5, text: 'Say one sum.' },
};
const FIX = 'Fix these and keep everything else: 1. The example 23 + 14 = 38 is wrong.';

describe('grades 1–5 goal fix (whole-plan instruction)', () => {
  test('k5EditMessages takes a fix instruction string instead of throwing', () => {
    const msgs = k5EditMessages({ script, edit: FIX, lang: 'en', grade: 3, subject: 'Maths' });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toContain('23 + 14 = 38 is wrong');
    expect(msgs[1].content).toContain(JSON.stringify(script));
  });

  test('a part change still works, and an unknown part still throws', () => {
    expect(k5EditMessages({ script, edit: { part: 'hook', text: 'use mangoes' }, lang: 'en', grade: 3 })[1].content).toContain('hook');
    expect(() => k5EditMessages({ script, edit: { part: 'nope', text: 'x' }, lang: 'en', grade: 3 })).toThrow(/unknown part/);
    expect(() => k5EditMessages({ script, edit: '   ', lang: 'en', grade: 3 })).toThrow(/unknown part/);
  });

  test('rewriteK5 with a string fix reaches the model (no throw before the call)', async () => {
    const calls = [];
    const client = { chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content: 'not json' } }] }; } } } };
    await rewriteK5({ script, edit: FIX, lang: 'en', grade: 3, subject: 'Maths', client, model: 'test-model' }).catch(() => null);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].messages[1].content).toContain('23 + 14 = 38 is wrong');
  });
});
