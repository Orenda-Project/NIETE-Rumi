'use strict';
/**
 * A one-word slash command that is a slip of the finger away from exactly one real command is that command.
 *
 * Production, 20 Oct 2026: a teacher typed "/assesments", then "/assesment". Every command door compares the exact
 * string, so neither reached the assessment generator; both were answered by the general AI chat, which first said
 * it was "not a command I can act on" and then offered to write an assessment in chat itself.
 *
 * canonicalizeSlashCommand already rewrites the BROKEN FORMS of a known command ("Menu/", "/ menu", "\menu"). This
 * pins the next step in the same place: a word close to one known command by edit distance (a swapped pair of
 * letters counts as one edit) is rewritten to it, so the real door runs. No list of typos — a distance.
 *
 * What must NOT happen is pinned just as hard: an exact command, a real command that is not a rewrite target
 * (/stats is not /status, /quizz is a slip of /quiz, which has its own door), a tie, a far or short word, and
 * anything that is not one bare word all pass through unchanged.
 */

const { canonicalizeSlashCommand } = require('../../bot/shared/utils/slash-command');

describe('a slip of the finger reaches the real command', () => {
  test.each([
    ['/assesments', '/assessments'], // the production case — one letter missing
    ['/assesment', '/assessment'], // and her second try
    ['/Assesments', '/assessments'], // case is not a difference
    ['  /assesments  ', '/assessments'],
    ['/exma', '/exam'], // two letters swapped = one edit
    ['/exmas', '/exams'],
    ['/trainig', '/training'],
    ['/certficate', '/certificate'],
    ['/clas', '/class'],
    ['/menue', '/menu'],
    ['/cancle', '/cancel'],
    ['/assesmnt', '/assessment'], // two edits are allowed on a word of six letters or more
    // The most common slips that reached the AI chat in one production week (13–20 Oct 2026):
    ['/menue', '/menu'],
    ['/manu', '/menu'],
    ['/memu', '/menu'],
    ['/attendence', '/attendance'],
    ['/attandance', '/attendance'],
    ['/couching', '/coaching'],
    ['/coching', '/coaching'],
    ['/coachin', '/coaching'],
    ['assesments/', '/assessments'], // the broken forms the canonicaliser already reads still apply
    ['/ assesments', '/assessments'],
  ])('%j → %j', (typed, command) => {
    expect(canonicalizeSlashCommand(typed)).toEqual({ text: command, form: 'similar' });
  });
});

describe('everything else passes through unchanged', () => {
  test.each([
    ['/assessments'], // already exact: nothing to repair
    ['/stats'], // a real command one edit from /status — never rewritten into another command
    ['/quizz'], // closest to /quiz, which has its own door: not this canonicaliser's to rewrite
    ['/exas'], // one edit from /exam AND from /exams: a tie is not a match
    ['/rost'], // two edits from /roster is too many for a four-letter word
    ['/exm'], // under four letters — too short to judge
    ['/xyzzy'], // near nothing
    ['assesments'], // no slash: words are not commands
    ['/assesments please'], // not one bare word
    ['/لپ'], // not a Latin word; left to the classifier
  ])('%j', (typed) => {
    const out = canonicalizeSlashCommand(typed);
    expect(out.form).not.toBe('similar');
    expect(out.text).toBe(out.form ? out.text : typed);
  });
});
