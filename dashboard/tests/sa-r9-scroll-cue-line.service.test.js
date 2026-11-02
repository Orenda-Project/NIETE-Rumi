'use strict';
/**
 * Round 9 item 7 (the reviewer's 2 Nov list): when a screen runs past the bottom, Jugnu says once per screen type that
 * there is more below. The line is lines.r9_scroll_cue, added only with sa_r9_scroll_cue ON (SWITCHES name r9ScrollCue),
 * in the battery's language, keyed as the builder keys a line; OFF leaves the battery as it was.
 */
const { LINES, applyR7a, keyOf } = require('../routes/sa-r7a-content');

const battery = (lang) => ({ lang, lines: { welcome: { text: 'Hi', audio: keyOf(lang, 'Hi') } }, tasks: [{ id: 't' }] });

describe('lines.r9_scroll_cue', () => {
  test('ON: the line in the battery\'s language, with its own clip key', () => {
    for (const lang of ['en', 'ur']) {
      const out = applyR7a(battery(lang), { r9ScrollCue: true });
      expect(out.lines.r9_scroll_cue).toEqual({ text: LINES.r9_scroll_cue[lang], audio: keyOf(lang, LINES.r9_scroll_cue[lang]) });
    }
  });

  test('OFF (or the switch unknown): the battery is the same object', () => {
    const b = battery('ur');
    expect(applyR7a(b, {})).toBe(b);
    expect(applyR7a(b, { r9ScrollCue: false })).toBe(b);
  });

  test('words for children: Urdu in Urdu script, no Latin letters; English names no button', () => {
    expect(LINES.r9_scroll_cue.ur).not.toMatch(/[A-Za-z]/);
    expect(LINES.r9_scroll_cue.en).toMatch(/below/);
  });
});
