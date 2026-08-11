/**
 * bd-2531 — /remark command handler: the wiring that makes the feature REAL.
 *
 * Everything else built for this feature (gate, rubric, S_pct, capability,
 * narrative, delivery) is unreachable until a principal typing "/remark" lands
 * somewhere. This is that entry point, mirroring observe-command.handler.js:
 * a handler returning handled?=true/false, so a non-match falls through to
 * normal chat and teacher behaviour is provably unchanged.
 *
 * The three refusals must each be a DIFFERENT sentence — "nothing happened" is
 * the worst outcome for a principal on a phone, and "wrong person" vs "wrong
 * time" are things she can act on differently.
 */
const { handleRemarkCommand } = require('../../shared/handlers/remark-command.handler');

const PRINCIPAL = { id: 'p-1', role: 'principal', preferred_language: 'en' };
const TEACHER_USER = { id: 't-1', role: 'teacher', preferred_language: 'en' };
const CYCLE = { id: 'c-1', name: 'Third Quarter 2026' };
const TEACHERS = [
  { id: 't-1', first_name: 'Ayesha' },
  { id: 't-2', first_name: 'Bilal' },
];

function makeDeps(over = {}) {
  const sent = [];
  return {
    sent,
    deps: {
      hasCapability: async () => true,
      getActiveCycle: async () => CYCLE,
      listSchoolTeachers: async () => TEACHERS,
      getProgress: async () => ({}),
      sendMessage: async (to, text) => { sent.push({ to, text }); },
      ...over,
    },
  };
}

describe('bd-2531 — non-matching messages fall through untouched', () => {
  test('ordinary chat is not handled', async () => {
    const { deps, sent } = makeDeps();
    await expect(handleRemarkCommand(PRINCIPAL, '92300', 'how do I plan a lesson?', deps))
      .resolves.toBe(false);
    expect(sent).toHaveLength(0);
  });

  test('/remarks (prefix collision) is not handled', async () => {
    const { deps } = makeDeps();
    await expect(handleRemarkCommand(PRINCIPAL, '92300', '/remarks', deps)).resolves.toBe(false);
  });
});

describe('bd-2531 — the three refusals are distinct and actionable', () => {
  test('unknown sender → told to register, handled', async () => {
    const { deps, sent } = makeDeps();
    await expect(handleRemarkCommand(null, '92300', '/remark', deps)).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    // Asserts the INTENT (tell her how to get set up), not specific wording —
    // "I don't recognise this number yet" is better copy than "no account".
    expect(sent[0].text).toMatch(/recognise|recognize|account|register|message me/i);
  });

  test('no capability → "for principals", never silence', async () => {
    const { deps, sent } = makeDeps({ hasCapability: async () => false });
    await expect(handleRemarkCommand(TEACHER_USER, '92300', '/remark', deps)).resolves.toBe(true);
    expect(sent[0].text).toMatch(/principal/i);
  });

  test('no open cycle → "not open right now", a DIFFERENT message', async () => {
    const { deps, sent } = makeDeps({ getActiveCycle: async () => null });
    await expect(handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps)).resolves.toBe(true);
    expect(sent[0].text).toMatch(/not open|isn't open|aren't open/i);
    // Must NOT be the role refusal — she is the right person at the wrong time.
    expect(sent[0].text).not.toMatch(/for principals/i);
  });

  test('an unauthorised user learns NOTHING about the window state', async () => {
    // Capability is checked first, so a teacher gets the same answer whether a
    // cycle is open or not.
    const withCycle = makeDeps({ hasCapability: async () => false });
    const without = makeDeps({ hasCapability: async () => false, getActiveCycle: async () => null });
    await handleRemarkCommand(TEACHER_USER, '92300', '/remark', withCycle.deps);
    await handleRemarkCommand(TEACHER_USER, '92300', '/remark', without.deps);
    expect(withCycle.sent[0].text).toBe(without.sent[0].text);
  });
});

describe('bd-2531 — the roster is the entry screen', () => {
  test('the open cycle is NAMED so she knows what she is filling', async () => {
    const { deps, sent } = makeDeps();
    await handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps);
    expect(sent[0].text).toContain('Third Quarter 2026');
  });

  test('every teacher in her school is listed', async () => {
    const { deps, sent } = makeDeps();
    await handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps);
    expect(sent[0].text).toContain('Ayesha');
    expect(sent[0].text).toContain('Bilal');
  });

  test('progress is shown per teacher: done / in-progress / not started', async () => {
    const { deps, sent } = makeDeps({
      getProgress: async () => ({ 't-1': { state: 'done' }, 't-2': { state: 'in_progress', answered: 3 } }),
    });
    await handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps);
    const text = sent[0].text;
    expect(text).toMatch(/✅/);            // Ayesha done
    expect(text).toMatch(/3\s*\/\s*5/);    // Bilal resumable — the session-free resume, surfaced
  });

  test('a principal with NO teachers gets a real message, not an empty list', async () => {
    const { deps, sent } = makeDeps({ listSchoolTeachers: async () => [] });
    await expect(handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps)).resolves.toBe(true);
    expect(sent[0].text).toMatch(/no teachers|not linked|contact/i);
  });

  test('a roster lookup failure degrades to a message, never a silent drop', async () => {
    const { deps, sent } = makeDeps({
      listSchoolTeachers: async () => { throw new Error('supabase down'); },
    });
    await expect(handleRemarkCommand(PRINCIPAL, '92300', '/remark', deps)).resolves.toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/try again|later|wrong/i);
  });
});

describe('bd-2531 — Urdu', () => {
  test('an Urdu principal is answered in Urdu', async () => {
    const { deps, sent } = makeDeps();
    await handleRemarkCommand({ ...PRINCIPAL, preferred_language: 'ur' }, '92300', '/remark', deps);
    expect(sent[0].text).toMatch(/[؀-ۿ]/);
  });

  test('the Urdu refusals are Urdu too, not English fallbacks', async () => {
    const { deps, sent } = makeDeps({ hasCapability: async () => false });
    await handleRemarkCommand({ ...TEACHER_USER, preferred_language: 'ur' }, '92300', '/remark', deps);
    expect(sent[0].text).toMatch(/[؀-ۿ]/);
  });
});
