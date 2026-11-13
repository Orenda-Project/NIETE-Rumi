/**
 * bd-pw1ccr.39 — the card tap's write (services/held-topic-nudge.service.js skipHeldTopicNudge).
 *
 * On prod 2-13 Nov every tap (65 of 65) returned 502: the route required the bot's teacher-nudges.store, which loads
 * dotenv, pino and @supabase/supabase-js from the bot tree, and the portal build installs none of the bot's packages.
 * The tap now writes through the portal's own Supabase client: the same guarded skip the bot store does
 * (pending → skipped, context merged with skip_reason 'card_used', a row already claimed is left alone).
 */
const fs = require('fs');
const path = require('path');
const { skipHeldTopicNudge } = require('../../dashboard/services/held-topic-nudge.service');

const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

function fakeSupabase({ rows = [], readError = null, updateError = null, claimed = [] } = {}) {
  const calls = [];
  const from = (table) => {
    const q = { table, op: 'select', filters: [], patch: null };
    calls.push(q);
    const b = {
      select(cols) { if (q.op === 'select') q.cols = cols; return b; },
      update(patch) { q.op = 'update'; q.patch = patch; return b; },
      eq(col, val) { q.filters.push([col, val]); return b; },
      then(resolve, reject) {
        let r;
        if (q.op === 'select') r = { data: readError ? null : rows, error: readError };
        else {
          const id = (q.filters.find(([c]) => c === 'id') || [])[1];
          r = { data: updateError ? null : (claimed.includes(id) ? [] : [{ id }]), error: updateError };
        }
        return Promise.resolve(r).then(resolve, reject);
      },
    };
    return b;
  };
  return { from, calls };
}

test('skips her pending topic-end rows for that topic, merging card_used into context', async () => {
  const db = fakeSupabase({ rows: [{ id: 'r1', context: { topic_id: 'b', grade: 1, skip_reason: 'window_closed' } }] });
  expect(await skipHeldTopicNudge(db, TEACHER, 'b')).toBe(1);

  const [read, write] = db.calls;
  expect(read.table).toBe('teacher_nudges');
  expect(read.filters).toEqual(expect.arrayContaining([
    ['user_id', TEACHER], ['kind', 'topic_end_nudge'], ['status', 'pending'], ['context->>topic_id', 'b'],
  ]));
  expect(write.table).toBe('teacher_nudges');
  expect(write.patch).toMatchObject({ status: 'skipped', context: { topic_id: 'b', grade: 1, skip_reason: 'card_used' } });
  expect(typeof write.patch.updated_at).toBe('string');
  expect(write.filters).toEqual(expect.arrayContaining([['id', 'r1'], ['status', 'pending']]));
});

test('a row the sweeper already claimed is not counted', async () => {
  const db = fakeSupabase({ rows: [{ id: 'r1', context: { topic_id: 'b' } }, { id: 'r2', context: { topic_id: 'b' } }], claimed: ['r2'] });
  expect(await skipHeldTopicNudge(db, TEACHER, 'b')).toBe(1);
});

test('nothing pending: 0; no teacher or no topic: 0 and nothing asked', async () => {
  expect(await skipHeldTopicNudge(fakeSupabase(), TEACHER, 'b')).toBe(0);
  const db = fakeSupabase();
  expect(await skipHeldTopicNudge(db, null, 'b')).toBe(0);
  expect(await skipHeldTopicNudge(db, TEACHER, '')).toBe(0);
  expect(db.calls).toHaveLength(0);
});

test('a read or write error is thrown, never read as nothing to skip', async () => {
  await expect(skipHeldTopicNudge(fakeSupabase({ readError: { message: 'down' } }), TEACHER, 'b')).rejects.toThrow('down');
  const db = fakeSupabase({ rows: [{ id: 'r1', context: {} }], updateError: { message: 'nope' } });
  await expect(skipHeldTopicNudge(db, TEACHER, 'b')).rejects.toThrow('nope');
});

test('the portal card code loads nothing from the bot tree (the portal build does not install its packages)', () => {
  for (const f of ['dashboard/routes/portal-topic-paper.routes.js', 'dashboard/services/held-topic-nudge.service.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    expect({ f, botRequires: src.match(/require\(\s*['"][./]*bot\//g) }).toEqual({ f, botRequires: null });
  }
});
