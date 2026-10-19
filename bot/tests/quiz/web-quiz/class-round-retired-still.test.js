'use strict';
/**
 * `jg.round.c_still` ("Still to play:") is retired in copy.v2.json: the class round's page never prints it, so its
 * T table no longer carries it (EN or UR). Every screen the page renders, EN and UR, is byte-identical to the page
 * before the key left: the digests in __golden__/class-round-pages.json were written by this file on the unchanged
 * template with GOLDEN_WRITE=1. The UR teacher screen and its paused form were retaken when the round count moved to
 * Urdu digits: their HTML differs from the earlier page in those digits only. They were retaken again when each name
 * on the Urdu list became an isolate (U+2068 … U+2069): class-round-paused-continue.test.js proves that HTML, the
 * isolates taken out, is the earlier digest byte for byte.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Page = require('../../../shared/templates/class-round.page');
const COPY = require('../../../shared/config/copy.v2.json');

const GOLDEN = path.join(__dirname, '__golden__', 'class-round-pages.json');
const TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
const ROWS = [
  { pos: 1, name: 'Asha Testwala', s: 'done' },
  { pos: 2, name: 'Bilal Testwala', s: 'absent' },
  { pos: 3, name: 'Chanda Testwala', s: 'declined' },
  { pos: 4, name: 'Dawood Testwala', s: 'todo', now: true },
  { pos: 5, name: 'Esha Testwala', s: 'todo' },
];
const digest = (html) => ({ sha256: crypto.createHash('sha256').update(html).digest('hex'), bytes: Buffer.byteLength(html) });

function pages() {
  const out = {};
  for (const lang of ['en', 'ur']) {
    const o = { lang, token: TOKEN };
    out[`${lang}/card`] = Page.renderCard(o);
    out[`${lang}/card-started`] = Page.renderCard({ ...o, started: true });
    out[`${lang}/card-early`] = Page.renderCard({ ...o, early: true });
    out[`${lang}/start`] = Page.renderRound({ mode: 'start', rows: ROWS }, o);
    out[`${lang}/teacher`] = Page.renderRound({ mode: 'teacher', rows: ROWS }, o);
    out[`${lang}/teacher-paused`] = Page.renderRound({ mode: 'teacher', rows: ROWS, paused: true }, o);
    out[`${lang}/child`] = Page.renderRound({ mode: 'child', rows: [], current: { name: 'Dawood Testwala' } }, { ...o, turnHref: '/h/tok?from=round' });
    out[`${lang}/handback`] = Page.renderRound({ mode: 'handback', rows: [] }, o);
    out[`${lang}/thanks`] = Page.renderThanks({ lang });
  }
  return out;
}

test('the retired "Still to play:" line is not in the page\'s T table (EN or UR)', () => {
  expect(COPY['jg.round.c_still'].retired).toBe(true);
  for (const lang of ['en', 'ur']) {
    expect(Object.keys(Page.T[lang])).not.toContain('cStill');
    expect(Object.values(Page.T[lang])).not.toContain(COPY['jg.round.c_still'][lang]);
  }
});

test('golden: every screen, EN and UR, is byte-identical to the page before the key left', () => {
  const got = Object.fromEntries(Object.entries(pages()).map(([k, html]) => [k, digest(html)]));
  if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
  expect(got).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  // and no screen ever carried the retired line
  Object.entries(pages()).forEach(([k, html]) => {
    const lang = k.split('/')[0];
    expect([k, html.includes(COPY['jg.round.c_still'][lang])]).toEqual([k, false]);
  });
});
