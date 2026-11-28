'use strict';
/**
 * bd-snkn32.58.18 (queue #412) — after #381 went live, 2 of the 15 re-runs of real refused goals were still refused.
 * The checker lines below are copied from those runs (q381-runs/v2):
 *
 *   Grade 2 long vowels   the first check listed a line it withdrew itself ("… this is acceptable - RETRACT"), and the
 *                         re-check refused the fixed plan only because "blue" and "snow" were "never taught … before
 *                         this point" — the checker's own rules say something not taught earlier is not an error.
 *                         A wrong refusal: the fixed plan had no false statement.
 *   Grade 3 vowel sounds  both checks found a real wrong sound in the example word "bazaar" (first "zaar = long a", then,
 *                         after the fix, "ba = short a"). Refusing that plan is right; the fix kept the word and only
 *                         re-labelled it, so the fix is now told to swap a wrong example for a simple one that fits.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const A = require('../../bot/shared/services/lp612-own-accuracy');
const C = require('../../bot/shared/services/lp-own-goal-check');

const reply = (errors) => JSON.stringify({ accurate: false, on_goal: true, off_goal: [], errors });

describe('Grade 2 long vowels: lines that are not errors do not refuse the plan', () => {
  it('a line the checker withdrew itself ("RETRACT") is not counted', () => {
    const r = A.parseGoalCheck(reply([
      "gate, bee, kite, blue, snow are long; bat, cat, mug, frog stay short -> 'blue' does not contain a single-letter vowel "
        + "saying its name in the same a_e/ee sense being taught, but it is still a long vowel word, so this is acceptable - RETRACT",
    ]));
    expect(r).toEqual({ accurate: true, errors: [], onGoal: true, offGoal: [] });
  });

  it('"never taught before this point" is not an error (the re-check that refused the fixed plan)', () => {
    const r = A.parseGoalCheck(reply([
      "gate, bee, kite, blue, snow are long; bat, cat, mug, frog stay short -> 'blue' and 'snow' were never taught as "
        + "long-vowel patterns (ue, ow) before this point in iDo/weDo, but since youDo ahead task already references ow/ue as "
        + "'patterns you already know', this creates inconsistency: 'blue' uses 'ue' ",
    ]));
    expect(r).toEqual({ accurate: true, errors: [], onGoal: true, offGoal: [] });
  });

  it('the same in Urdu: a word "never taught" in the lesson is not an error', () => {
    const r = A.parseGoalCheck(reply([
      "cfu میں 'عیب زدہ' کا پوچھا جانا -> یہ لفظ کہیں بھی چارٹ، keyWords یا سبق میں پڑھایا نہیں گیا، بچوں سے ایسا لفظ پوچھنا جو سکھایا ہی نہیں گیا",
    ]));
    expect(r.errors).toEqual([]);
    expect(r.accurate).toBe(true);
  });

  it('a wrong sound still refuses, next to a dismissed line', () => {
    const wrong = "bazaar — 'zaar = long a (ar) sound' -> the 'aar' in bazaar is an r-controlled vowel sound (as in 'car'), not the long a sound (as in 'cake')";
    const r = A.parseGoalCheck(reply([wrong, "'snow' was never taught before this point"]));
    expect(r.accurate).toBe(false);
    expect(r.errors).toEqual([wrong]);
  });

  it('the whole gate: a fixed plan whose re-check only says "never taught" is given to her', async () => {
    const checks = [
      A.parseGoalCheck(reply(["b-e-e -> /b/ /e-e/ -> wrong segmentation: 'bee' has only two phonemes /b/ /ee/"])),
      A.parseGoalCheck(reply(["'blue' and 'snow' were never taught as long-vowel patterns (ue, ow) before this point"])),
    ];
    const r = await C.checkBeforeReady({ doc: { v: 1 }, check: async () => checks.shift(), fix: async () => ({ doc: { v: 2 } }) });
    expect(r).toEqual({ verdict: 'fixed', doc: { v: 2 }, findings: 1 });
  });
});

describe('Grade 3 vowel sounds: the fix swaps a wrong example instead of re-labelling it', () => {
  it('the fix instruction says to replace a wrong example word with a simple one that fits', () => {
    const text = C.fixInstruction({ errors: ["bazaar 'zaar = long a' -> it is an r-controlled vowel"], offGoal: [] }, { text: 'vowel sounds' });
    expect(text).toMatch(/example/i);
    expect(text).toMatch(/replace it with a simple one/i);
  });
});
