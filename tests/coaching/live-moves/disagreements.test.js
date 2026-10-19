'use strict';
/**
 * Live moves (bd-v0toag.31): a D teacher who tapped "I did this" on a move the recording check found
 * not_done gets a short note in her report. Live ticks and taps never change a verdict.
 */
const { disagreementsFor } = require('../../../bot/shared/services/coaching/live-moves/disagreements');

const tap = (idx, choice, at) => ({ idx, choice, at, live_state: 'unticked' });
const live = (taps, moves = [{ idx: 0, covers: ['m1', 'm2'], tickedAtMs: null }]) => ({
  lessonId: 'L1', stamp: 's', liveId: 'x', moves, taps, drops: 0, bytesSent: 0,
});
const fid = (verdicts) => ({
  moves: Object.entries(verdicts).map(([move_id, verdict]) => ({ move_id, verdict, text: `v9 ${move_id}` })),
});
const CARD = { sections: [{ moves: [{ idx: 0, covers: ['m1', 'm2'], do: 'Pairs read aloud.' }] }] };

test('note when last tap did and all covered not_done', () => {
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), fid({ m1: 'not_done', m2: 'not_done' }), CARD))
    .toEqual([{ idx: 0, text: 'Pairs read aloud.' }]);
});

test('without a card the covered v9 move text is used', () => {
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), fid({ m1: 'not_done', m2: 'not_done' })))
    .toEqual([{ idx: 0, text: 'v9 m1' }]);
});

test('no note when tap is not_done', () => {
  expect(disagreementsFor(live([tap(0, 'did_not', 't1')]), fid({ m1: 'not_done', m2: 'not_done' }), CARD)).toEqual([]);
});

test.each(['partial', 'executed', 'not_adjudicable'])('no note when one covered move is %s', (verdict) => {
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), fid({ m1: 'not_done', m2: verdict }), CARD)).toEqual([]);
});

test('no note when a covered move has no verdict at all', () => {
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), fid({ m1: 'not_done' }), CARD)).toEqual([]);
});

test('no note for a move that covers nothing — the recording never checked it', () => {
  const moves = [{ idx: 0, covers: [], tickedAtMs: null }];
  expect(disagreementsFor(live([tap(0, 'did', 't1')], moves), fid({ m1: 'not_done' }), CARD)).toEqual([]);
});

test('uses last tap only', () => {
  const both = fid({ m1: 'not_done', m2: 'not_done' });
  expect(disagreementsFor(live([tap(0, 'did', 't1'), tap(0, 'did_not', 't2')]), both, CARD)).toEqual([]);
  expect(disagreementsFor(live([tap(0, 'did_not', 't1'), tap(0, 'did', 't2')]), both, CARD)).toHaveLength(1);
});

test('a move with no text anywhere is skipped', () => {
  const noText = { moves: [{ move_id: 'm1', verdict: 'not_done' }, { move_id: 'm2', verdict: 'not_done' }] };
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), noText)).toEqual([]);
});

test('null inputs → []', () => {
  expect(disagreementsFor(null, null)).toEqual([]);
  expect(disagreementsFor(live([tap(0, 'did', 't1')]), null)).toEqual([]);
  expect(disagreementsFor(null, fid({ m1: 'not_done' }))).toEqual([]);
  expect(disagreementsFor({ taps: 'x', moves: null }, { moves: 'x' })).toEqual([]);
});
