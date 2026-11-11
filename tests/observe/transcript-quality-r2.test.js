/**
 * FICO17 v6 r2 — the transcript quality gate after the red team and the replay (bd-qix9oh fix-gate; RULINGS R20,
 * R21; CONTRACTS §11.1).
 *
 *   T8.1  a loop interleaved with punctuation-only lines read `ok`: every zero-token line ended the loop run.
 *   T8.2  a stray earlier line at the end read `short` from that line: the last line was taken, not the latest.
 *   T8.3  a later line first read `late_start`: the first line was taken, not the earliest.
 *   R20   a `gap` is no speech, not no line start: back-to-back speech by one speaker is one line stamped at its start
 *         (spec §1.2), so the gap runs from the previous line's estimated end of speech. On the 30 replay lessons
 *         every gap followed a teacher line of 399-4,195 characters (line median 14).
 *   R21   a loop that covers less than half the period stays `partial` (spec §6.2), and the prompt asks for IE.
 *
 * Synthetic transcripts only (spec §0.6). Real: the module. Mocked: nothing (it has no I/O).
 */
const tq = require('../../bot/shared/services/observe/transcript-quality');

const pad = (n) => String(n).padStart(2, '0');
const clock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const sec = (mm, ss = 0) => mm * 60 + ss;

const SAY = [
  'بچو، آج ہم جمع کے سوال حل کریں گے۔',
  'جی استاد جی',
  'اس تصویر میں کیا نظر آ رہا ہے؟',
  'درخت کے نیچے تین بکریاں ہیں',
  'شاباش، اب اپنی کاپی کھولو۔',
  'دو اور تین کتنے ہوتے ہیں؟',
  'پانچ ہوتے ہیں',
  'کس نے دوسرا طریقہ سوچا؟',
];
const HAAN = ['ہاں', 'ہاں۔', 'ہَاں،', 'ہاں؟', 'ہاں ہاں'];

const line = (s, i, text) => `[${clock(s)}] ${i % 2 ? 'Student' : 'Teacher'} (UR): ${text ?? SAY[i % SAY.length]}`;

/** One line every `step` seconds from `from` to `to`, minus `skip`, with `say(s)` replacing a line's words. */
function lesson({ from = 30, to = sec(39, 30), step = 30, skip = () => false, say = () => null } = {}) {
  const out = [];
  for (let s = from, i = 0; s <= to; s += step) {
    if (skip(s)) continue;
    out.push(line(s, i, say(s)));
    i += 1;
  }
  return out;
}
const loopAt = (a, b) => (s) => (s >= a && s <= b ? HAAN[(s / 30) % HAAN.length] : null);
/** A teacher talking without a break: `n` characters of ordinary Urdu, one transcript line. */
const monologue = (n) => SAY[0].repeat(Math.ceil(n / SAY[0].length)).slice(0, n);

const assess = (lines, periodMinutes = 40, env = {}) => tq.assess({ transcript: lines.join('\n'), periodMinutes, env });

describe('T8.1: zero-token lines inside a loop neither end it nor count toward it', () => {
  test('a loop interleaved with punctuation-only lines 12:00-40:00 is broken', () => {
    const lines = lesson({ from: 10, to: sec(11, 30) });
    for (let s = sec(12), i = 0; s <= sec(40); s += 15, i += 1) lines.push(line(s, i, i % 2 ? '...' : 'شکریہ'));
    const q = assess(lines);
    expect(q.status).toBe('broken');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '40:00' }]);
  });

  test('control: the same loop without the punctuation lines is broken', () => {
    const lines = lesson({ from: 10, to: sec(11, 30) });
    for (let s = sec(12), i = 0; s <= sec(40); s += 15, i += 1) lines.push(line(s, i, 'شکریہ'));
    const q = assess(lines);
    expect(q.status).toBe('broken');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '40:00' }]);
  });

  test('a punctuation-only line right after a loop does not stretch it', () => {
    const lines = lesson({ say: loopAt(sec(12), sec(16)) });
    const after = lines.findIndex((l) => l.startsWith('[16:30]'));
    lines.splice(after, 0, '[16:15] Student (UR): ۔۔۔');
    expect(assess(lines).issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });

  test('punctuation-only lines among ordinary speech are not a loop', () => {
    const lines = lesson({ say: (s) => (s >= sec(12) && s <= sec(20) && (s / 30) % 2 ? '؟' : null) });
    expect(assess(lines).status).toBe('ok');
  });
});

describe('T8.2/T8.3: timestamps out of order are read in time order', () => {
  test('a stray earlier line at the end does not make a full lesson "short"', () => {
    const lines = lesson({ from: 10 }).concat([line(sec(10), 3)]);
    const q = assess(lines);
    expect(q.issues.filter((i) => i.type === 'short')).toEqual([]);
    expect(q.last_ts).toBe('39:10');
    expect(q.status).toBe('ok');
  });

  test('a later line first does not make an on-time lesson "late_start"', () => {
    const lines = [line(sec(5), 4)].concat(lesson({ from: 10 }));
    const q = assess(lines);
    expect(q.issues.filter((i) => i.type === 'late_start')).toEqual([]);
    expect(q.first_ts).toBe('00:10');
    expect(q.status).toBe('ok');
  });

  test('a stray line does not hide a real gap, nor make one', () => {
    const lines = lesson({ skip: (s) => s > sec(18) && s < sec(23) });
    const shuffled = [lines[lines.length - 1], ...lines.slice(0, -1)];
    expect(assess(shuffled)).toEqual(assess(lines));
  });

  test('lines with the same timestamp keep their order (stable sort): a loop on equal stamps still reads', () => {
    const lines = lesson({ to: sec(11, 30) });
    for (let s = sec(12); s <= sec(16); s += 30) lines.push(line(s, 0, 'ہاں'), line(s, 1, 'ہاں'));
    lines.push(...lesson({ from: sec(16, 30) }));
    expect(assess(lines).issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });
});

describe('in-order transcripts: output byte-identical to the r1 gate (JSON string)', () => {
  // Captured from the untouched module on origin/sandbox b9b271bb38. Gaps are left out: R20 moves `gap.from` on purpose.
  const IN_ORDER = {
    ok: [lesson(), 40, '{"status":"ok","coverage":0.9875,"issues":[],"period_minutes":40,"first_ts":"00:30","last_ts":"39:30"}'],
    short: [lesson({ to: sec(24) }), 40, '{"status":"partial","coverage":0.6,"issues":[{"type":"short","from":"24:00"}],"period_minutes":40,"first_ts":"00:30","last_ts":"24:00"}'],
    late_start: [lesson({ from: sec(5) }), 40, '{"status":"partial","coverage":0.9875,"issues":[{"type":"late_start","to":"05:00"}],"period_minutes":40,"first_ts":"05:00","last_ts":"39:30"}'],
    loop_partial: [lesson({ say: loopAt(sec(12), sec(16)) }), 40, '{"status":"partial","coverage":0.9875,"issues":[{"type":"loop","from":"12:00","to":"16:00"}],"period_minutes":40,"first_ts":"00:30","last_ts":"39:30"}'],
    loop_broken: [lesson({ to: sec(40), say: loopAt(sec(12), sec(40)) }), 40, '{"status":"broken","coverage":1,"issues":[{"type":"loop","from":"12:00","to":"40:00"}],"period_minutes":40,"first_ts":"00:30","last_ts":"40:00"}'],
    two_loops: [lesson({ say: (s) => loopAt(sec(2), sec(13))(s) || loopAt(sec(20), sec(31))(s) }), 40, '{"status":"broken","coverage":0.9875,"issues":[{"type":"loop","from":"02:00","to":"13:00"},{"type":"loop","from":"20:00","to":"31:00"}],"period_minutes":40,"first_ts":"00:30","last_ts":"39:30"}'],
    late_loop_short: [lesson({ from: sec(4), to: sec(26), say: loopAt(sec(8), sec(12)) }), 35, '{"status":"partial","coverage":0.7429,"issues":[{"type":"late_start","to":"04:00"},{"type":"loop","from":"08:00","to":"12:00"},{"type":"short","from":"26:00"}],"period_minutes":35,"first_ts":"04:00","last_ts":"26:00"}'],
    no_period: [lesson({ to: sec(24) }), null, '{"status":"ok","coverage":1,"issues":[],"period_minutes":null,"first_ts":"00:30","last_ts":"24:00"}'],
    untimed: [['Teacher: no timings here'], 40, '{"status":"broken","coverage":0,"issues":[{"type":"short","from":"00:00"}],"period_minutes":40,"first_ts":null,"last_ts":null}'],
  };
  test.each(Object.entries(IN_ORDER))('%s', (_, [lines, period, golden]) => {
    expect(JSON.stringify(assess(lines, period))).toBe(golden);
  });
});

describe('R20: a gap is measured from the end of the previous line\'s speech', () => {
  test('DEFAULTS carry TRANSCRIPT_CHARS_PER_SEC, calibrated at 16 on the replay lessons', () => {
    expect(tq.DEFAULTS.TRANSCRIPT_CHARS_PER_SEC).toBe(16);
  });

  test('a four-minute teacher monologue, merged into one line, is not a gap', () => {
    // 3,000 characters at 16 a second: speech to 08:08, the next line at 09:00.
    const lines = lesson({ skip: (s) => s > sec(5) && s < sec(9), say: (s) => (s === sec(5) ? monologue(3000) : null) });
    const q = assess(lines);
    expect(q.issues).toEqual([]);
    expect(q.status).toBe('ok');
  });

  test('silence after a short line still flags; `from` is the estimated end, `to` unchanged', () => {
    // 'جی استاد جی' is 11 characters: ceil(11 / 16) = 1 s of speech, so the silence runs 18:01-23:00.
    const lines = lesson({ skip: (s) => s > sec(18) && s < sec(23), say: (s) => (s === sec(18) ? SAY[1] : null) });
    const q = assess(lines);
    expect(q.status).toBe('partial');
    expect(q.issues).toEqual([{ type: 'gap', from: '18:01', to: '23:00' }]);
  });

  test('silence after a monologue flags when what is left is still 3 minutes or more', () => {
    // 541 characters: ceil(541 / 16) = 34 s, speech to 17:28; the next line at 20:34 leaves 3:06.
    const lines = lesson({ to: sec(16, 30) })
      .concat([line(sec(16, 54), 0, monologue(541)), line(sec(20, 34), 1)])
      .concat(lesson({ from: sec(21) }));
    expect(assess(lines).issues).toEqual([{ type: 'gap', from: '17:28', to: '20:34' }]);
  });

  test('a silence of exactly TRANSCRIPT_GAP_MINUTES after the speech ends is a gap; a second less is not', () => {
    const at = (next) => lesson({ to: sec(18) }).concat([line(next, 1)], lesson({ from: next + 30 }));
    // The 18:00 line is SAY[3] for i = 35: 27 characters, 2 s of speech, so it ends at 18:02.
    expect(assess(at(sec(21, 2))).issues).toEqual([{ type: 'gap', from: '18:02', to: '21:02' }]);
    expect(assess(at(sec(21, 1))).issues).toEqual([]);
  });

  test('TRANSCRIPT_CHARS_PER_SEC comes from env; unset or not a positive number = 16', () => {
    const lines = lesson({ skip: (s) => s > sec(5) && s < sec(9), say: (s) => (s === sec(5) ? monologue(3000) : null) });
    expect(assess(lines, 40, { TRANSCRIPT_CHARS_PER_SEC: '1000' }).issues).toEqual([{ type: 'gap', from: '05:03', to: '09:00' }]);
    expect(assess(lines, 40, { TRANSCRIPT_CHARS_PER_SEC: '0' }).issues).toEqual([]);
    expect(assess(lines, 40, { TRANSCRIPT_CHARS_PER_SEC: 'fast' }).issues).toEqual([]);
  });

  test('coverage and short still read the last line\'s start (spec §6.2), not its estimated end', () => {
    const lines = lesson({ to: sec(23, 30) }).concat([line(sec(24), 0, monologue(3000))]);
    const q = assess(lines);
    expect(q.coverage).toBeCloseTo(0.6, 4);
    expect(q.issues).toEqual([{ type: 'short', from: '24:00' }]);
  });
});

describe('R21: a loop under half the period, then an early stop, stays partial', () => {
  test('loop 12:00-23:30, last line 24:30, 35-minute period → partial with loop and short', () => {
    const lines = lesson({ to: sec(24, 30), say: loopAt(sec(12), sec(23, 30)) });
    const q = assess(lines, 35);
    expect(q.status).toBe('partial');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '23:30' }, { type: 'short', from: '24:30' }]);
  });
});

describe('promptGaps (CONTRACTS §11.1): the usable share and the IE instruction', () => {
  const quality = {
    status: 'partial',
    coverage: 0.6,
    period_minutes: 40,
    issues: [
      { type: 'late_start', to: '05:00' },
      { type: 'gap', from: '10:01', to: '15:00' },
      { type: 'loop', from: '16:00', to: '20:00' },
      { type: 'short', from: '24:00' },
    ],
  };

  test('the block, line for line', () => {
    // 300 + 299 + 240 + 960 = 1,799 of 2,400 seconds: 75 %.
    expect(tq.promptGaps(quality)).toBe([
      'TRANSCRIPT GAPS:',
      '- no speech before 05:00',
      '- no speech from 10:01 to 15:00',
      '- the same words repeat from 16:00 to 20:00 (not real speech)',
      '- no speech after 24:00 of a 40-minute period',
      'About 75% of the 40-minute period has no usable speech (gaps, loops, a late start or an early end).',
      'For every indicator whose evidence would fall in these gaps, or whose "Couldn\'t tell" line applies because a',
      'large part of the lesson is missing, return "IE" instead of a level. Do not guess a level from the part that remains.',
    ].join('\n'));
  });

  test('no period known: no percentage line', () => {
    const block = tq.promptGaps({ ...quality, period_minutes: null, issues: quality.issues.slice(0, 3) });
    expect(block.split('\n')).toEqual([
      'TRANSCRIPT GAPS:',
      '- no speech before 05:00',
      '- no speech from 10:01 to 15:00',
      '- the same words repeat from 16:00 to 20:00 (not real speech)',
      'For every indicator whose evidence would fall in these gaps, or whose "Couldn\'t tell" line applies because a',
      'large part of the lesson is missing, return "IE" instead of a level. Do not guess a level from the part that remains.',
    ]);
  });

  test('the share is capped at 100 and the period is shown in whole minutes (a DC recording is seconds / 60)', () => {
    const block = tq.promptGaps({ status: 'partial', period_minutes: 2250 / 60, issues: [{ type: 'late_start', to: '30:00' }, { type: 'short', from: '05:00' }] });
    expect(block).toContain('About 100% of the 38-minute period has no usable speech');
    expect(block).toContain('- no speech after 05:00 of a 38-minute period');
  });

  test('end to end: the r1 loop lesson\'s shape asks for IE with its share', () => {
    const q = assess(lesson({ to: sec(24, 30), say: loopAt(sec(12), sec(23, 30)) }), 35);
    // loop 690 s + short (2100 - 1470) 630 s = 1,320 of 2,100: 63 %.
    expect(tq.promptGaps(q)).toContain('About 63% of the 35-minute period has no usable speech');
    expect(tq.promptGaps(q)).toContain('return "IE" instead of a level');
  });

  test('ok: still the empty string', () => {
    expect(tq.promptGaps(assess(lesson()))).toBe('');
  });
});
