'use strict';

/**
 * Three Urdu "your turn" lines were served misspelt: «آواز مین» for «آواز میں» (both story tasks), «کانام» for «کا نام»
 * (letter names) and «آوازبولیں» for «آواز بولیں» (the English letter sounds' Urdu intro). Four "your turn" lines then
 * dropped the postposition: «اونچی/تیز آواز بولیں» for «… آواز میں بولیں» (both word tasks, letter names; the letter
 * sounds' line, which also said «آواز» twice, now says «زور سے بولیں»).
 * They come from the reviewed lines file, laid over the bank by the builder, so this suite runs the builder and reads
 * what every battery serves.
 */

const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));

const SLIPS = [/(^|\s)مین(?=\s|$|[۔،!؟])/, /کانام/, /آوازبولیں/, /(اونچی|تیز) آواز بولیں/];

/** Every string in a JSON value that carries a slip, as "<path>: <text>". */
function slips(x, at = '', out = []) {
  if (Array.isArray(x)) x.forEach((v, i) => slips(v, `${at}[${i}]`, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => slips(v, `${at}.${k}`, out));
  else if (typeof x === 'string' && SLIPS.some((re) => re.test(x))) out.push(`${at}: ${x}`);
  return out;
}

describe('SA Urdu instruction lines are spelt right', () => {
  const files = splitSaBankWithRuntime(buildSaBank({
    v3: read('item-bank.v3.json'),
    extra: read('item-bank.sa-extra.v1.json'),
    w3: read('item-bank.sa-w3.v1.json'),
    r28: read('item-bank.sa-r28.v1.json'),
  }));
  const batteries = Object.keys(files).filter((n) => /^sa\/sa\..+\.(ur|en)\.json$/.test(n)).sort();

  test('the builder emits the served batteries', () => {
    expect(batteries.length).toBeGreaterThanOrEqual(16);
  });

  test.each(batteries)('%s serves none of the slips', (rel) => {
    expect(slips(files[rel])).toEqual([]);
  });

  // A replace row's `from` is the old text it matches, and the line it rewrites keeps that text in the file; both are
  // fixed where they are served (the batteries above).
  test('the reviewed lines file carries none of them either, outside the old texts its replace rows rewrite', () => {
    const reviewed = read('sa-lines-reviewed.v1.json');
    const old = new Set((reviewed.replace || []).map((r) => r.from));
    const { replace, ...rest } = reviewed;
    expect(slips(rest).filter((s) => !old.has(s.slice(s.indexOf(': ') + 2)))).toEqual([]);
    expect(slips((replace || []).map((r) => r.to))).toEqual([]);
  });

  test('the coach-led Grade 2 Urdu battery says the three lines as corrected', () => {
    const tasks = Object.fromEntries(files['sa/sa.coach.G2.A.ur.json'].tasks.map((t) => [t.id, t]));
    const said = (id) => JSON.stringify(tasks[id]);
    expect(said('ur.story_w3')).toContain('اب کہانی کو اونچی آواز میں پڑھنے کی آپ کی باری ہے۔');
    expect(said('ur.letter_names5')).toContain('اب آپ کی باری! ہر حرف کا نام بولیں۔');
    expect(said('en.letter_sounds5')).toContain('اب آپ کی باری! ہر حرف کی آواز بولیں۔');
  });

  test('the four "your turn" lines say «آواز میں بولیں» (letter sounds: «زور سے بولیں»), in every form that serves them', () => {
    const want = {
      'ur.words4': 'اب آپ کی باری! ہر لفظ کو اونچی آواز میں بولیں۔',
      'en.words4': 'اب آپ کی باری! ہر لفظ کو اونچی آواز میں بولیں۔',
      'en.letter_names5': 'اب آپ کی باری! ہر حرف کا نام تیز آواز میں بولیں۔',
      'ur.letter_sounds5': 'اب آپ کی باری! ہر حرف کی آواز زور سے بولیں۔',
    };
    const seen = new Set();
    for (const rel of batteries.filter((n) => n.endsWith('.ur.json'))) {
      for (const t of files[rel].tasks) {
        if (!want[t.id] || !t.script || !t.script.test_intro) continue;
        expect(t.script.test_intro.text).toBe(want[t.id]);
        seen.add(t.id);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(want).sort());
  });
});
