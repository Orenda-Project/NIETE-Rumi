/**
 * bd-q261rec (queue #261) — portal_upload_pieces: who sends a recording in pieces (resumes after a drop).
 * The operator 26 Nov (via Godfather): teachers on their own switch; coaches and principals with their flow v2.
 *
 *   no row          coaches/principals on the flow v2: on · teachers: off
 *   true / list     teachers too (everyone / those users.id)
 *   "off"           nobody: the kill switch back to the one-PUT send
 *   a failed read   teachers off (fail-closed), coaches stay on (their default)
 */

const { isUploadPiecesFor, PORTAL_UPLOAD_PIECES_KEY } = require('../../dashboard/lib/feature-flags');

function db(value, { fail = false } = {}) {
  // A fresh object each time: the flag cache is per supabase client.
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (fail) return { data: null, error: { message: 'down' } };
      return { data: value === undefined ? null : { key: PORTAL_UPLOAD_PIECES_KEY, value }, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return { from: () => chain };
}

describe('bd-q261rec — isUploadPiecesFor', () => {
  test.each([
    ['no row, coach on flow v2', undefined, true, true],
    ['no row, teacher', undefined, false, false],
    ['true, teacher', true, false, true],
    ['"true" (text), teacher', 'true', false, true],
    ['list with her, teacher', ['t-1'], false, true],
    ['list without her, teacher', ['t-2'], false, false],
    ['"off", coach on flow v2', 'off', true, false],
    ['"off" as JSON text, coach', '"off"', true, false],
    ['"off", teacher', 'off', false, false],
    ['an object, teacher', { t: 1 }, false, false],
  ])('%s', async (_name, value, leaderFlowV2, want) => {
    expect(await isUploadPiecesFor(db(value), 't-1', { leaderFlowV2 })).toBe(want);
  });

  test('a failed read: teachers off, coaches on (their default)', async () => {
    expect(await isUploadPiecesFor(db(null, { fail: true }), 't-1', { leaderFlowV2: false })).toBe(false);
    expect(await isUploadPiecesFor(db(null, { fail: true }), 'c-1', { leaderFlowV2: true })).toBe(true);
  });

  test('signed out: off', async () => {
    expect(await isUploadPiecesFor(db(true), null, { leaderFlowV2: true })).toBe(false);
  });
});
