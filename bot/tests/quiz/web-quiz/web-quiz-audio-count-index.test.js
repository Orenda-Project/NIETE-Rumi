'use strict';
/**
 * The daily-cap count is answered from an index, not a scan of every quiz (bd-ehz254.12.1).
 *
 * recordingAllowed counts quizzes whose meta.web.audio_day (or meta.web_one.audio_day) is today. With no index on
 * those paths Postgres reads and unpacks the meta JSON of every quiz (26.5k on prod, 17 Nov): 2.5-8.7 s through
 * PostgREST, and past the API statement time limit the count is cancelled and answered 500 with no body
 * (prod niete-logs 10-17 Nov: 23 settings_failed, every one 9.3-9.6 s after the audio job started). Two expression
 * indexes let the planner answer it from the index (a BitmapOr of the two). An expression index is only used when
 * the query's expression is the same, so this test ties the store's filters to the migration's index expressions.
 */

const fs = require('fs');
const path = require('path');
const Store = require('../../../shared/services/quiz/web-quiz-audio-store');

const MIGRATION = path.join(__dirname, '../../../database/migrations/web_quiz_audio_day_index_concurrently.sql');
const QUIZ = '33333333-3333-4333-8333-333333333333';

// PostgREST turns the filter path meta->web->>audio_day into ((meta -> 'web'::text) ->> 'audio_day'::text).
function sqlOf(restPath) {
  const m = /^(\w+)((?:->\w+)*)->>(\w+)$/.exec(restPath);
  if (!m) throw new Error(`not a json text path: ${restPath}`);
  const inner = m[2].split('->').filter(Boolean).reduce((acc, k) => `(${acc} -> '${k}')`, m[1]);
  return `(${inner} ->> '${m[3]}')`;
}
const norm = (s) => s.replace(/::text/g, '').replace(/\s+/g, '');

// The filter paths the cap count uses, read off a fake client, with and without the one-voice slot.
async function countPaths(countOne) {
  const paths = [];
  const db = {
    from(table) {
      const api = {
        select() { return api; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        eq(col) {
          if (table !== 'quizzes') return api;
          paths.push(col);
          return Promise.resolve({ count: 0, error: null, status: 200 });
        },
        or(expr) {
          for (const part of expr.split(',')) paths.push(part.replace(/\.eq\..*$/, ''));
          return Promise.resolve({ count: 0, error: null, status: 200 });
        },
      };
      return api;
    },
  };
  Store.resetSettingsCache();
  await Store.recordingAllowed({ db, quizId: QUIZ, logEvent: jest.fn(), logError: jest.fn(), countOne });
  return paths;
}

function indexExpressions(sql) {
  // ON public.quizzes (<expr>) [WHERE ...]; — only live statements (a commented-out line starts with --).
  const re = /^CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+public\.quizzes\s*\((\(.+?\))\)(?:\s+WHERE\s[^;]+)?;/gim;
  return [...sql.matchAll(re)].map((m) => norm(m[1]));
}

describe('the daily-cap count has an index for each path it filters on', () => {
  test('the migration builds the indexes concurrently, outside a transaction', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(indexExpressions(sql).length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/^\s*BEGIN\b/im);
  });

  test.each([[false], [true]])('every filter path (countOne=%s) is an index expression', async (countOne) => {
    const indexed = indexExpressions(fs.readFileSync(MIGRATION, 'utf8'));
    const paths = await countPaths(countOne);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(indexed).toContain(norm(sqlOf(p)));
  });
});
