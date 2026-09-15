'use strict';
/**
 * bd-b3pop.5 — fidelity pre-flight: deterministic facts about the RECORDING (timestamps, where the transcript stops
 * against the audio, one collapsed block) and the plan's content anchors. Pure module, no mocks.
 */
const { describeRecording, planAnchorHits } = require('../../../bot/shared/services/coaching/fidelity/fidelity-preflight');

describe('fidelity-preflight · describeRecording', () => {
  const T = '[00:03] Teacher (UR): السلام علیکم\n\n[10:20] Teacher (UR): اب کاپی میں کریں\n\n[15:00] Teacher (UR): سوال\n\n[20:20] Teacher (UR): تھینک یو';

  test('counts the stamps and finds where the transcript ends', () => {
    expect(describeRecording(T, 1256)).toEqual({
      stamps: 4, no_timestamps: false, last_stamp_s: 1220, ends_at: '20:20',
      audio_s: 1256, transcript_short_of_audio: false, collapsed_block: false,
    });
  });

  test('a transcript that stops more than 90 s before the audio ends is short of the audio', () => {
    expect(describeRecording(T, 2138).transcript_short_of_audio).toBe(true);
    expect(describeRecording(T, 1310).transcript_short_of_audio).toBe(false); // exactly 90 s: not flagged
    expect(describeRecording(T, 1311).transcript_short_of_audio).toBe(true);
  });

  test('an unknown, zero or junk audio duration never flags the tail', () => {
    for (const a of [null, undefined, 0, -5, 'abc']) {
      const r = describeRecording(T, a);
      expect(r.audio_s).toBe(null);
      expect(r.transcript_short_of_audio).toBe(false);
    }
  });

  test('one timestamped block holding at least 40% of the text is a collapsed block', () => {
    const big = '[00:10] a\n\n[08:04] ' + 'x'.repeat(4000) + '\n\n[42:40] end';
    expect(describeRecording(big, 2565).collapsed_block).toBe(true);
  });

  test('no timestamps is reported, never thrown', () => {
    expect(describeRecording('no stamps here', 900)).toMatchObject({
      stamps: 0, no_timestamps: true, last_stamp_s: null, ends_at: null, transcript_short_of_audio: false, collapsed_block: false,
    });
    expect(describeRecording(null, null).stamps).toBe(0);
  });
});

describe('fidelity-preflight · planAnchorHits', () => {
  test('multi-digit numbers, page references and double-quoted phrases, split into found and missing', () => {
    const moves = [{ move_id: 'm1', text: 'Model 30,000 ÷ 5 on the board; reference p.52; say "Division means equal sharing"' }];
    const a = planAnchorHits(moves, '[01:00] Teacher: 30000 bottles ... page 52 ...');
    expect(a).toEqual({ total: 3, found: ['30000', '52'], missing: ['Division means equal sharing'] });
  });

  test('an Urdu page reference is an anchor (JS \\b is ASCII-only, so the Urdu words cannot sit behind one)', () => {
    const a = planAnchorHits([{ move_id: 'm1', text: 'طلبہ صفحہ نمبر 7 کھولیں' }], '[00:10] صفحہ 7 کھولیں');
    expect(a).toEqual({ total: 1, found: ['7'], missing: [] });
  });

  test('apostrophes are not quotation marks', () => {
    expect(planAnchorHits([{ move_id: 'm1', text: "the teacher's book and the class's copy" }], '').total).toBe(0);
  });

  test('empty inputs give no anchors', () => {
    expect(planAnchorHits([], '')).toEqual({ total: 0, found: [], missing: [] });
    expect(planAnchorHits(null, null)).toEqual({ total: 0, found: [], missing: [] });
  });
});
