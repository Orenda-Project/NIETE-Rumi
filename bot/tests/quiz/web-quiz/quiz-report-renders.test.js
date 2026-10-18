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
const hashes = (out) => out.split('\n=====\n').map((r) => crypto.createHash('sha256').update(r).digest('hex'));

test('every quiz report render matches the golden, byte for byte', () => {
  const got = hashes(renders(page));
  if (process.env.GOLDEN_WRITE === '1') fs.writeFileSync(FILE, `${JSON.stringify(got, null, 1)}\n`);
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  expect(got.length).toBeGreaterThan(70);
  expect(got).toEqual(want);
});
