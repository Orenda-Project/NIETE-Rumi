'use strict';
/**
 * The teacher's web report of a QUIZ is byte-identical to the base it was recorded on, whatever a storybook send's
 * report adds: 60 quiz renders, the class tab, the message pages and 16 class-tab quiz rows. The pages inline their
 * fonts, so the golden keeps one sha256 per render, not the bytes. Re-record only for an intended quiz-report change:
 * GOLDEN_WRITE=1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const renders = require('./quiz-report-renders.golden');
const page = require('../../../shared/templates/teacher-report.page');

const FILE = path.join(__dirname, '__golden__', 'quiz-report-renders.json');
// Each sha256 is kept as eight 8-character groups split by spaces. Raw hex can hold a phone-shaped digit run by
// chance (the public-repo fixture rule, tests/setup/phone-shaped-fixtures, needs 11 digits in a row); a group never can.
const GROUPED = /^[0-9a-f]{8}( [0-9a-f]{8}){7}$/;
const sha = (r) => crypto.createHash('sha256').update(r).digest('hex').match(/.{8}/g).join(' ');
const hashes = (out) => out.split('\n=====\n').map(sha);

test('every quiz report render matches the golden, byte for byte', () => {
  const got = hashes(renders(page));
  if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(FILE, `${JSON.stringify(got, null, 1)}\n`);
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  expect(got.length).toBeGreaterThan(70);
  expect(want.every((h) => GROUPED.test(h))).toBe(true);
  expect(got).toEqual(want);
});
