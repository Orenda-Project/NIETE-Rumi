/**
 * The queue's reasons: the code's list, the migration's CHECK and the schema mirror's CHECK name the same set.
 * 'blind_solve' rows come from a blind solve of bank items that never met a key check (written by a reviewed SQL
 * go item, not by the nightly job); without it in the CHECK, that insert fails.
 */
const fs = require('fs');
const path = require('path');
const Review = require('../../shared/services/quiz/quiz-key-review.service');

const MIGRATION = path.join(__dirname, '../../database/migrations/qfix_keys_quiz_item_reviews.sql');
const MIRROR = path.join(__dirname, '../../../infrastructure/supabase/00_complete-schema.sql');

function reasonCheck(sql) {
  const table = /CREATE TABLE IF NOT EXISTS public\.quiz_item_reviews \(([\s\S]*?)\n\);/.exec(sql);
  if (!table) return null;
  const m = /reason\s+text[^\n]*CHECK \(reason IN \(([^)]*)\)\)/.exec(table[1]);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort() : null;
}

describe('quiz_item_reviews reasons', () => {
  test('the code knows the nightly reason and the blind-solve reason', () => {
    expect(Review.REASONS).toEqual(['dominant_wrong_option', 'blind_solve']);
    expect(Review.REASONS).toContain(Review.REASON);
  });

  test('the migration CHECK admits exactly the code\'s reasons', () => {
    expect(reasonCheck(fs.readFileSync(MIGRATION, 'utf8'))).toEqual([...Review.REASONS].sort());
  });

  test('the schema mirror CHECK matches the migration', () => {
    expect(reasonCheck(fs.readFileSync(MIRROR, 'utf8'))).toEqual([...Review.REASONS].sort());
  });
});
