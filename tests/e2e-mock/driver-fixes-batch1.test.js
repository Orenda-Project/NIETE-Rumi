/**
 * Three mock-lane driver bugs found by the profiler's traces (bd-yuur1a).
 *
 * 1. training.cjs answered every quiz question by matching its text against the answer key, taking the
 *    first line that is not exactly "Qn/N". Since the Meta bill cut the feedback for the previous answer
 *    and the header of the next question are ONE line — "✗ Not correct · Q2/20" — so that line was taken
 *    as the question, no key entry matched, and T05 / T16 / T21 died at Q2 with NO_KEY_ENTRY.
 * 2. status.cjs STA06 expected "کچھ شروع کرنے کے لیے /menu بھیجیں"; the bot wraps /menu in U+2066…U+2069
 *    (LRI/PDI, so the slash command reads left-to-right inside Urdu), and the regex never matched.
 * 3. training.cjs T15 sent "/teacher training" while the previous scenario's menu wait was still open,
 *    so the bot matched it to the "Teacher Training" row by words (menu_match.row) and opened the Flow.
 *    The spec describes a chat with no menu wait; the driver now ends the wait first.
 *
 * Red-first: fails on the branch — neither helper is exported, and T15 sends straight away.
 */
const fs = require('fs');
const path = require('path');
const QA = path.resolve(__dirname, '..', '..', '.claude', 'qa', 'shared');

describe('training.cjs questionLineOf — the question line, never the merged feedback header', () => {
  const { questionLineOf } = require(path.join(QA, 'features', 'training.cjs'));
  test('a feedback + header line is skipped', () => {
    expect(questionLineOf('✗ Not correct · Q2/20\nYou teach a combined Grade 2–3 class with 50 students.\nA. Pair them\nB. Wait')).toBe('You teach a combined Grade 2–3 class with 50 students.');
    expect(questionLineOf('✅ Correct · Q2/3\nWhich routine helps transitions?\nA. Discuss\nB. Yell')).toBe('Which routine helps transitions?');
  });
  test('a preamble BEFORE the header is never the question — the question is the line after the header (bd-1r3k2h, T21)', () => {
    expect(questionLineOf('📝 Establishing classroom routines — 3 questions\nQ1/3\nWhat is a routine?\nA. x')).toBe('What is a routine?');
  });
  test('the bold module title under the header is not the question either (run 20261027-050355, T21)', () => {
    expect(questionLineOf('Module check · Q1/3\n📝 *Module check — "Establishing classroom routines"*\nWhat do end-of-lesson routines do?\nA. x')).toBe('What do end-of-lesson routines do?');
  });
  test('the module check intro — title, blank, "N questions. You need *100%* …" — is skipped whole (run 20261027-1017, T21)', () => {
    expect(questionLineOf('Module check · Q1/3\n📝 *Module check — "Establishing classroom routines"*\n\n3 questions. You need *100%* to unlock the next module — if you miss it you can retry straight away.\n\nWhat do end-of-lesson routines do?\nA. x')).toBe('What do end-of-lesson routines do?');
  });
  test('a bare header line is skipped as before', () => {
    expect(questionLineOf('Q1/20\nWhat is a routine?\nA. x')).toBe('What is a routine?');
  });
  test('option lines, "required" and "Select all that apply" are never the question', () => {
    expect(questionLineOf('Q3/5\nA. first\nrequired')).toBe('');
    expect(questionLineOf('Q4/5 (Select all that apply)\nPick the two routines (Select all that apply)\nA. one')).toBe('Pick the two routines');
  });
});

describe('status.cjs isUrduIdleReply — the Urdu idle copy with bidi isolates around /menu', () => {
  const { isUrduIdleReply } = require(path.join(QA, 'features', 'status.cjs'));
  test('the bot\'s exact string matches', () => {
    expect(isUrduIdleReply('اس وقت کچھ نہیں چل رہا۔ کچھ شروع کرنے کے لیے ⁦/menu⁩ بھیجیں۔')).toBe(true);
    expect(isUrduIdleReply('اس وقت کچھ نہیں چل رہا۔ کچھ شروع کرنے کے لیے /menu بھیجیں۔')).toBe(true);
  });
  test('the English idle copy does not', () => {
    expect(isUrduIdleReply("Nothing's running right now. Send /menu to start something.")).toBe(false);
  });
});

describe('training.cjs T15 clears the menu wait before sending', () => {
  test('the block parks the conversation state first', () => {
    const src = fs.readFileSync(path.join(QA, 'features', 'training.cjs'), 'utf8');
    const block = src.slice(src.indexOf("if (want('T15'))"), src.indexOf("if (want('T18'))"));
    expect(block).toMatch(/setUser\(\{ conversation_state: null, conversation_state_expires_at: null \}\)/);
    expect(block.indexOf('setUser(')).toBeLessThan(block.indexOf("sendWait('/teacher training')"));
  });
});
