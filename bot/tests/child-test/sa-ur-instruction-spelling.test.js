'use strict';

/**
 * Three Urdu "your turn" lines were served misspelt: «آواز مین» for «آواز میں» (both story tasks), «کانام» for «کا نام»
 * (letter names) and «آوازبولیں» for «آواز بولیں» (the English letter sounds' Urdu intro). They come from the reviewed
 * lines file, laid over the bank by the builder, so this suite runs the builder and reads what every battery serves.
 */

const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));

const SLIPS = [/(^|\s)مین(?=\s|$|[۔،!؟])/, /کانام/, /آوازبولیں/];

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

  test.each(batteries)('%s serves none of the three slips', (rel) => {
    expect(slips(files[rel])).toEqual([]);
  });

  test('the reviewed lines file carries none of them either', () => {
    expect(slips(read('sa-lines-reviewed.v1.json'))).toEqual([]);
  });

  test('the coach-led Grade 2 Urdu battery says the three lines as corrected', () => {
    const tasks = Object.fromEntries(files['sa/sa.coach.G2.A.ur.json'].tasks.map((t) => [t.id, t]));
    const said = (id) => JSON.stringify(tasks[id]);
    expect(said('ur.story_w3')).toContain('اب کہانی کو اونچی آواز میں پڑھنے کی آپ کی باری ہے۔');
    expect(said('ur.letter_names5')).toContain('اب آپ کی باری! ہر حرف کا نام بولیں۔');
    expect(said('en.letter_sounds5')).toContain('اب آپ کی باری! ہر حرف کی آواز بولیں۔');
  });
});
