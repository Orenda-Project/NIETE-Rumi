'use strict';
/**
 * bd-tbprit.12 — Rifat's "✓ Mark as done" / "Move back to To do" (20 Oct): Done can be undone.
 *
 *   markDone     her own open row reads visited, stamped now (the tracker's visited_7d = visited AND updated_at
 *                within 7 days of created_at); her voice note is KEPT, so an undo loses nothing
 *   markUndone   her own visited row goes back to what it was: sent when the ping went out, failed when it did not
 *                — so visited_7d reads false again until she marks it done again
 *   purgeDoneNotes  a note is deleted once its card has stood Done for 24 hours (the privacy rule moves from
 *                "at Done" to "a day after Done"); a card undone in time keeps it
 */
const { markDone, markUndone, purgeDoneNotes } = require('../../dashboard/services/coach-disagreements.service');

const NOW = new Date('2026-10-26T10:00:00Z');
const H = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

/** supabase-js stand-in: the filters and writes these three make. */
function fakeSupabase(rows) {
  const from = () => {
    const q = { filters: [], patch: null };
    const keep = (r) => q.filters.every(([op, k, v]) => (
      op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : op === 'lt' ? r[k] < v : op === 'notnull' ? r[k] != null : true));
    const run = () => {
      const hit = rows.filter(keep);
      if (q.patch) hit.forEach((r) => Object.assign(r, q.patch));
      return hit;
    };
    const chain = {
      select() { return chain; },
      update(p) { q.patch = p; return chain; },
      eq(k, v) { q.filters.push(['eq', k, v]); return chain; },
      in(k, v) { q.filters.push(['in', k, v]); return chain; },
      lt(k, v) { q.filters.push(['lt', k, v]); return chain; },
      not(k) { q.filters.push(['notnull', k]); return chain; },
      maybeSingle() { return Promise.resolve({ data: run()[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    return chain;
  };
  return { from };
}
const ROW = (extra) => ({
  id: 'r1', coach_user_id: 'me', status: 'sent', wa_message_id: 'wamid.1', voice_note_key: 'coach-visit-notes/r1.m4a',
  created_at: H(48), updated_at: H(48), ...extra,
});
const visited7d = (r) => r.status === 'visited' && Date.parse(r.updated_at) <= Date.parse(r.created_at) + 7 * 86400000;

describe('markDone', () => {
  it('her open card reads visited, stamped now, and her voice note stays', async () => {
    const row = ROW();
    expect(await markDone(fakeSupabase([row]), 'me', 'r1', NOW)).toBe(true);
    expect(row).toMatchObject({ status: 'visited', updated_at: NOW.toISOString(), voice_note_key: 'coach-visit-notes/r1.m4a' });
    expect(visited7d(row)).toBe(true);
  });

  it("another coach's card is not touched", async () => {
    const row = ROW({ coach_user_id: 'someone' });
    await markDone(fakeSupabase([row]), 'me', 'r1', NOW);
    expect(row.status).toBe('sent');
  });

  it('a second tap does not move the done time', async () => {
    const row = ROW({ status: 'visited', updated_at: H(5) });
    expect(await markDone(fakeSupabase([row]), 'me', 'r1', NOW)).toBe(true);
    expect(row.updated_at).toBe(H(5));
  });
});

describe('markUndone', () => {
  it('back to sent when the ping went out; the tracker no longer counts it', async () => {
    const row = ROW({ status: 'visited', updated_at: H(2) });
    expect(await markUndone(fakeSupabase([row]), 'me', 'r1', NOW)).toBe(true);
    expect(row.status).toBe('sent');
    expect(visited7d(row)).toBe(false);
  });

  it('back to failed when the ping never went out', async () => {
    const row = ROW({ status: 'visited', wa_message_id: null });
    await markUndone(fakeSupabase([row]), 'me', 'r1', NOW);
    expect(row.status).toBe('failed');
  });

  it("an open card, or another coach's, is left as it is", async () => {
    const open = ROW();
    const theirs = ROW({ id: 'r2', coach_user_id: 'someone', status: 'visited' });
    const db = fakeSupabase([open, theirs]);
    expect(await markUndone(db, 'me', 'r1', NOW)).toBe(true);
    await markUndone(db, 'me', 'r2', NOW);
    expect([open.status, theirs.status]).toEqual(['sent', 'visited']);
  });

  it('done, undone, done again: counted once more, from the new done time', async () => {
    const row = ROW();
    const db = fakeSupabase([row]);
    await markDone(db, 'me', 'r1', new Date(NOW.getTime() - 3600000));
    await markUndone(db, 'me', 'r1', NOW);
    await markDone(db, 'me', 'r1', NOW);
    expect(row).toMatchObject({ status: 'visited', updated_at: NOW.toISOString() });
  });
});

describe('purgeDoneNotes', () => {
  it('a note on a card Done for over 24 hours is deleted; a newer Done, or an open card, keeps its note', async () => {
    const old = ROW({ status: 'visited', updated_at: H(25) });
    const fresh = ROW({ id: 'r2', status: 'visited', updated_at: H(2), voice_note_key: 'k2' });
    const open = ROW({ id: 'r3', voice_note_key: 'k3' });
    const gone = [];
    await purgeDoneNotes(fakeSupabase([old, fresh, open]), 'me', async (k) => { gone.push(k); }, NOW);
    expect(gone).toEqual(['coach-visit-notes/r1.m4a']);
    expect([old.voice_note_key, fresh.voice_note_key, open.voice_note_key]).toEqual([null, 'k2', 'k3']);
  });

  it('a delete that fails keeps the key for the next pass, and never throws', async () => {
    const old = ROW({ status: 'visited', updated_at: H(30) });
    await expect(purgeDoneNotes(fakeSupabase([old]), 'me', async () => { throw new Error('r2 down'); }, NOW)).resolves.toBeUndefined();
    expect(old.voice_note_key).toBe('coach-visit-notes/r1.m4a');
  });
});
