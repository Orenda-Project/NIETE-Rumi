'use strict';

/**
 * The SA bank is public data: what the builder writes (the whole bank, each form, each served battery) and the
 * scripts that write it say why an item or a line is there in product words, never by a private work-tracking name.
 * The matcher is the repo's own added-lines hygiene matcher, so this suite and that gate cannot disagree.
 */

const fs = require('fs');
const path = require('path');
const { tokensIn } = require('../../../tests/setup/added-lines-hygiene-lib');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const SA = path.join(__dirname, '../../shared/services/child-test/sa');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));

/** Every string in a JSON value that carries a hygiene token, as "<path>: <token>". */
function hits(x, at = '', out = []) {
  if (Array.isArray(x)) x.forEach((v, i) => hits(v, `${at}[${i}]`, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => hits(v, `${at}.${k}`, out));
  else if (typeof x === 'string') tokensIn(x).forEach((t) => out.push(`${at}: ${t}`));
  return out;
}

describe('SA bank wording: no private work-tracking names in the public bank', () => {
  const files = splitSaBankWithRuntime(buildSaBank({
    v3: read('item-bank.v3.json'),
    extra: read('item-bank.sa-extra.v1.json'),
    w3: read('item-bank.sa-w3.v1.json'),
    r28: read('item-bank.sa-r28.v1.json'),
  }));

  test('the builder emits the bank, the forms and the served batteries', () => {
    const names = Object.keys(files);
    expect(names).toContain('item-bank.sa.v1.json');
    expect(names.filter((n) => /^sa\/sa\..+\.(ur|en)\.json$/.test(n)).length).toBeGreaterThanOrEqual(16);
  });

  test.each(Object.keys(files).sort())('%s carries none', (rel) => {
    expect(hits(files[rel])).toEqual([]);
  });

  test.each(['build.js', 'build-w3.js', 'scripts.js'])('sa/%s carries none (strings and comments)', (f) => {
    const lines = fs.readFileSync(path.join(SA, f), 'utf8').split('\n');
    const found = lines.flatMap((l, i) => tokensIn(l).map((t) => `${f}:${i + 1}: ${t}`));
    expect(found).toEqual([]);
  });
});
