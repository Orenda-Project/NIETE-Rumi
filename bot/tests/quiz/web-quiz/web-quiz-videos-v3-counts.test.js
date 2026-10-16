'use strict';
/**
 * scripts/web-quiz/counts/web_quiz_videos_v3.js: the read-only per-(grade, subject) table of what the video library
 * lists for an English and an Urdu child (all / switch off / switch on), and a non-zero exit when a subject listed
 * with the switch off lists nothing for a child with it on. The database is the in-memory fake the library tests use.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const supabase = require('../../../shared/config/supabase');
const Lib = require('../../../shared/services/quiz/web-quiz-library');
const F = require('./videos-v3-fixture');
const Counts = require('../../../../scripts/web-quiz/counts/web_quiz_videos_v3');

const ON = [{ key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_v3', value: true }];
const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };
const ENV = { SUPABASE_URL: 'https://refsandbox.supabase.co' };

beforeEach(() => { Lib._reset(); jest.restoreAllMocks(); });

test('one row per grade and subject: every current video, listed with the switch off, listed on for each child', async () => {
  F.seed(supabase, ON);
  const rows = (await Counts.table()).map((r) => [r.grade, r.subject, r.all, r.off, r.on.en, r.on.ur]);
  expect(rows).toEqual([
    ['KG', 'English', 1, 1, 1, 1],
    ['3', 'English', 1, 1, 1, 1],
    // 1 Urdu video of 5: too thin to filter for the Urdu child, who sees all five.
    ['3', 'Maths', 5, 5, 4, 5],
    // One video has no ready quiz yet: counted in all, never listed.
    ['3', 'Science', 4, 3, 2, 2],
    ['3', 'Urdu', 3, 3, 3, 3],
    ['4', 'Science', 1, 1, 1, 1],
  ]);
});

test('prints the table and totals with no id or title; exit 0 when nothing is emptied', async () => {
  F.seed(supabase, ON);
  const o = io();
  expect(await Counts.main({ argv: ['--expect-ref', 'refsandbox'], env: ENV, io: o })).toBe(0);
  const text = o.out.join('');
  expect(text).toContain('3 | Maths | 5 | 5 | 4 | 5\n');
  expect(JSON.parse(o.out[o.out.length - 1])).toEqual({ subjects: 6, all: 15, off: 14, on_en: 12, on_ur: 13, emptied: 0 });
  expect(text).not.toMatch(/Adding|Leaves|[0-9a-f]{8}-[0-9a-f]{4}/);
});

test('exit 1 and the subject marked when a subject listed off lists nothing for a child on', async () => {
  F.seed(supabase, ON);
  const real = Lib.inLanguage;
  jest.spyOn(Lib, 'inLanguage').mockImplementation(async (ix, lang) => {
    const out = await real(ix, lang);
    return lang === 'ur' ? { ...out, rows: out.rows.filter((r) => r.subject !== 'Urdu') } : out;
  });
  const o = io();
  expect(await Counts.main({ argv: ['--expect-ref', 'refsandbox'], env: ENV, io: o })).toBe(1);
  expect(o.out.join('')).toContain('3 | Urdu | 3 | 3 | 3 | 0 | EMPTIED\n');
});

test('refuses without the expected database on the command line', async () => {
  const o = io();
  expect(await Counts.main({ argv: [], env: ENV, io: o })).toBe(2);
  expect(await Counts.main({ argv: ['--expect-ref', 'other'], env: ENV, io: o })).toBe(2);
  expect(o.err.join('')).toContain('REFUSED: not sandbox');
});
