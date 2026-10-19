/**
 * The class table's tie note on an Urdu page reads as a sentence, under both Urdu copy sets: the second set
 * (ui.ur2) once said «برابر اسکور = برابر نمبر», and a child reads "=" as maths, not words.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq.js'), 'utf8');
const LINE = 'صرف پہلے نام۔ برابر اسکور والوں کا نمبر ایک ہے۔';

describe('class table tie note, Urdu', () => {
  test('every Urdu firstOnly is the native-read sentence', () => {
    const notes = [...SRC.matchAll(/firstOnly:\s*'([^']*)'/g)].map((m) => m[1]).filter((s) => /[؀-ۿ]/.test(s));
    expect(notes.length).toBeGreaterThanOrEqual(2);
    for (const n of notes) expect(n).toBe(LINE);
  });
  test('no "=" in the Urdu tie note', () => {
    expect(SRC).not.toContain('برابر اسکور =');
  });
});
