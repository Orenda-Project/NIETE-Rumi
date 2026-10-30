'use strict';
/**
 * The topic importer loads ANOTHER curriculum's topics as data (V1.8.6, bd-97daxo.4).
 *
 * `--curriculum nbf_snc` writes rows tagged 'nbf_snc' with `nbf_snc_` ids, checks pages against NBF's contents
 * page, and never retires an ICT topic; an ICT run (the default) writes and reads exactly as
 * before and never retires a GB topic.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../../fixtures/memory-supabase');
  return createMemorySupabase({});
});

const db = require('../../../bot/shared/config/supabase');
const { run, toCsv } = require('../../../bot/scripts/import-assessment-topics');
const sample = require('./fixtures/matrix-sample.json');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-cur-'));
  fs.writeFileSync(path.join(dir, 'English.csv'), toCsv(sample.english));
  db.reset({ assessment_topics: [], textbook_toc: [] });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const opts = { client: db, log: () => {}, env: {}, now: '2026-10-29T00:00:00.000Z' };
const argv = (...extra) => [dir, '--matrix-version', 'v1', '--allow-page-errors', ...extra];

it('a GB load tags its rows and ids, and leaves every ICT topic current', async () => {
  await run(argv(), opts);
  const ict = db.rows('assessment_topics').map((r) => ({ ...r }));
  expect(ict.length).toBeGreaterThan(0);
  expect(ict.every((r) => r.curriculum === undefined && !String(r.topic_id).startsWith('nbf_snc_'))).toBe(true);

  const out = await run(argv('--curriculum', 'nbf_snc'), opts);
  expect(out.retire).toBe(0);
  const rows = db.rows('assessment_topics');
  const gb = rows.filter((r) => r.curriculum === 'nbf_snc');
  expect(gb.length).toBe(ict.length);
  expect(gb.every((r) => String(r.topic_id).startsWith('nbf_snc_'))).toBe(true);
  expect(rows.filter((r) => r.curriculum !== 'nbf_snc').every((r) => r.is_current !== false)).toBe(true);

  // And an ICT re-run sees only ICT rows: nothing of GB's is retired.
  const again = await run(argv(), opts);
  expect(again.retire).toBe(0);
  expect(db.rows('assessment_topics').filter((r) => r.curriculum === 'nbf_snc').every((r) => r.is_current !== false)).toBe(true);
});
