/**
 * Composer-level integration for the four post-generation validators.
 *
 * Pins the reject-and-swap semantics + the grouping pass — these are the
 * pieces that touch the sampler, not the pure validator module.
 */

jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));

const {
  sampleBucketValidated,
  applySourceGrouping,
} = require('../../bot/shared/services/exam/exam-composer.service');

// ─── sampleBucketValidated — reject-and-swap ───────────────────────────────

describe('sampleBucketValidated — rejects invalid picks and swaps in valid ones', () => {
  it('swaps out an MCQ with only 3 options for one with 4', () => {
    const pool = [
      mcqRow('bad-1',  { category: 'SEEN', opts: 3 }),
      mcqRow('bad-2',  { category: 'SEEN', opts: 3 }),
      mcqRow('good-1', { category: 'SEEN', opts: 4 }),
      mcqRow('good-2', { category: 'SEEN', opts: 4 }),
      mcqRow('good-3', { category: 'SEEN', opts: 4 }),
    ];
    const picked = sampleBucketValidated(pool, 3, 100, 0);
    expect(picked.length).toBe(3);
    for (const q of picked) {
      expect(q.answer_options.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('returns fewer than requested when the pool has no valid alternatives', () => {
    // Only 2 valid rows exist — asking for 5 should return 2, not loop forever
    // and not throw.
    const pool = [
      mcqRow('bad-1',  { category: 'SEEN', opts: 2 }),
      mcqRow('bad-2',  { category: 'SEEN', opts: 2 }),
      mcqRow('good-1', { category: 'SEEN', opts: 4 }),
      mcqRow('good-2', { category: 'SEEN', opts: 4 }),
    ];
    const picked = sampleBucketValidated(pool, 5, 100, 0);
    expect(picked.length).toBe(2);
    for (const q of picked) {
      expect(q.answer_options.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('honours the seen/unseen split when picks are valid', () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => mcqRow(`s-${i}`, { category: 'SEEN',   opts: 4 })),
      ...Array.from({ length: 5 }, (_, i) => mcqRow(`u-${i}`, { category: 'UNSEEN', opts: 4 })),
    ];
    const picked = sampleBucketValidated(pool, 4, 50, 50);
    const seen = picked.filter(q => q.category === 'SEEN').length;
    const unseen = picked.filter(q => q.category === 'UNSEEN').length;
    expect(seen + unseen).toBe(4);
    expect(seen).toBe(2);
    expect(unseen).toBe(2);
  });
});

// ─── applySourceGrouping — same-source contiguity ──────────────────────────

describe('applySourceGrouping — clusters same-source questions', () => {
  it('groups two questions sharing an image url next to each other', () => {
    // Interleave input; grouper should cluster same-image rows.
    const q1 = shortAns('q1', { imageUrl: 'https://cdn/A.png' });
    const q2 = shortAns('q2', { imageUrl: 'https://cdn/B.png' });
    const q3 = shortAns('q3', { imageUrl: 'https://cdn/A.png' });
    const q4 = shortAns('q4', { imageUrl: 'https://cdn/B.png' });

    const grouped = applySourceGrouping([q1, q2, q3, q4]);
    const ids = grouped.map(q => q.id);

    // A-then-A and B-then-B should be adjacent — either A-cluster first or
    // B-cluster first, but no cluster split.
    expect(adjacent(ids, ['q1', 'q3']) || adjacent(ids, ['q3', 'q1'])).toBe(true);
    expect(adjacent(ids, ['q2', 'q4']) || adjacent(ids, ['q4', 'q2'])).toBe(true);
  });

  it('preserves group_ref groups as atomic clusters', () => {
    const g = 'grp-uuid-1';
    const q1 = shortAns('q1', { groupRef: g });
    const q2 = shortAns('q2');
    const q3 = shortAns('q3', { groupRef: g });

    const grouped = applySourceGrouping([q1, q2, q3]);
    const ids = grouped.map(q => q.id);
    expect(adjacent(ids, ['q1', 'q3']) || adjacent(ids, ['q3', 'q1'])).toBe(true);
  });

  it('does not shuffle questions that have distinct source hashes', () => {
    const q1 = shortAns('q1');
    const q2 = shortAns('q2');
    const q3 = shortAns('q3');
    const grouped = applySourceGrouping([q1, q2, q3]);
    // No cluster to enforce → order is stable.
    expect(grouped.map(q => q.id)).toEqual(['q1', 'q2', 'q3']);
  });
});

// ─── helpers ───────────────────────────────────────────────────────────────

function mcqRow(id, { category = 'SEEN', opts = 4 } = {}) {
  return {
    id,
    type: 'MCQs',
    category,
    question_statement: `What is ${id}?`,
    question_media: [],
    answer_options: Array.from({ length: opts }, (_, i) => ({
      statement: `opt-${i}`,
      is_correct: i === 0,
    })),
    chapter_index: 1,
    index_in_chapter: 1,
  };
}

function shortAns(id, { imageUrl = null, groupRef = null } = {}) {
  return {
    id,
    type: 'Short Answer',
    category: 'SEEN',
    question_statement: `Q ${id}`,
    question_media: imageUrl ? [{ url: imageUrl }] : [],
    answer_options: [],
    chapter_index: 1,
    index_in_chapter: 1,
    group_ref: groupRef,
  };
}

function adjacent(arr, pair) {
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] === pair[0] && arr[i + 1] === pair[1]) return true;
  }
  return false;
}
