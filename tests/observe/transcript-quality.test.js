/**
 * FICO17 v6 — the transcript quality gate (spec §6, §10.1 "Quality gate"; bd-qix9oh.1).
 *
 * A deterministic check that runs after transcription and before any scoring, on both the DC and the
 * /observe2 moments path. It says whether the transcript covers the lesson (`ok`), covers part of it
 * (`partial`, with the gaps named for the prompt), or cannot be used (`broken`, no scoring call).
 *
 * Every transcript here is synthetic (spec §0.6): invented Urdu-script and English classroom lines in
 * the `[MM:SS] Speaker (LANG): text` shape the transcriber writes. Real: the module. Mocked: nothing
 * (it has no I/O).
 */
const fs = require('fs');
const path = require('path');
const tq = require('../../bot/shared/services/observe/transcript-quality');

const MODULE = path.join(__dirname, '../../bot/shared/services/observe/transcript-quality.js');

const pad = (n) => String(n).padStart(2, '0');
const clock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
const sec = (mm, ss = 0) => mm * 60 + ss;

// Neighbouring lines always differ, so ordinary teaching never reads as a loop.
const SAY = {
  UR: [
    'بچو، آج ہم جمع کے سوال حل کریں گے۔',
    'جی استاد جی',
    'اس تصویر میں کیا نظر آ رہا ہے؟',
    'درخت کے نیچے تین بکریاں ہیں',
    'شاباش، اب اپنی کاپی کھولو۔',
    'دو اور تین کتنے ہوتے ہیں؟',
    'پانچ ہوتے ہیں',
    'کس نے دوسرا طریقہ سوچا؟',
  ],
  EN: [
    'Open your books to page twelve.',
    'Yes teacher',
    'What do you see in the picture?',
    'A boy with a red kite.',
    'Why do you think he is happy?',
    'Because the wind is strong today.',
    'Good, who can add to that?',
    'Write one sentence about the kite.',
  ],
};

/** A lesson: one line every `step` seconds from `from` to `to`, minus `skip`, with `say(s)` replacing a line. */
function lesson({ from = 30, to = sec(39, 30), step = 30, lang = 'UR', skip = () => false, say = () => null } = {}) {
  const lines = [];
  let i = 0;
  for (let s = from; s <= to; s += step) {
    if (skip(s)) continue;
    const speaker = i % 2 ? 'Student' : 'Teacher';
    const text = say(s) || SAY[lang][i % SAY[lang].length];
    lines.push(`[${clock(s)}] ${speaker} (${lang}): ${text}`);
    i += 1;
  }
  return lines.join('\n\n');
}

// One Urdu word, written the ways a transcriber varies it: the same word once marks are stripped.
const HAAN = ['ہاں', 'ہاں۔', 'ہَاں،', 'ہاں؟', 'ہاں ہاں'];
const urduLoop = (a, b) => (s) => (s >= a && s <= b ? HAAN[(s / 30) % HAAN.length] : null);

describe('the six §10.1 fixtures', () => {
  describe.each(['UR', 'EN'])('%s transcript', (lang) => {
    test('40-min period, lines to 39:30 → ok', () => {
      const q = tq.assess({ transcript: lesson({ lang }), periodMinutes: 40, env: {} });
      expect(q.status).toBe('ok');
      expect(q.issues).toEqual([]);
      expect(q.coverage).toBeCloseTo(39.5 / 40, 4);
    });

    test('last line 24:00 → partial, short from 24:00', () => {
      const q = tq.assess({ transcript: lesson({ lang, to: sec(24) }), periodMinutes: 40, env: {} });
      expect(q.status).toBe('partial');
      expect(q.issues).toEqual([{ type: 'short', from: '24:00' }]);
      expect(q.coverage).toBeCloseTo(0.6, 4);
    });

    test('first line 05:00 → partial, late_start to 05:00', () => {
      const q = tq.assess({ transcript: lesson({ lang, from: sec(5) }), periodMinutes: 40, env: {} });
      expect(q.status).toBe('partial');
      expect(q.issues).toEqual([{ type: 'late_start', to: '05:00' }]);
    });

    test('no lines 18:00-23:00 → partial, gap from the 18:00 line\'s end of speech to 23:00', () => {
      // The 18:00 line has 27 (UR) or 22 (EN) characters: 2 s at TRANSCRIPT_CHARS_PER_SEC 16 (RULINGS R20).
      const transcript = lesson({ lang, skip: (s) => s > sec(18) && s < sec(23) });
      const q = tq.assess({ transcript, periodMinutes: 40, env: {} });
      expect(q.status).toBe('partial');
      expect(q.issues).toEqual([{ type: 'gap', from: '18:02', to: '23:00' }]);
    });
  });

  test('one Urdu word repeated 12:00-40:00 → broken (loop 28 min > half of 40)', () => {
    const transcript = lesson({ to: sec(40), say: urduLoop(sec(12), sec(40)) });
    const q = tq.assess({ transcript, periodMinutes: 40, env: {} });
    expect(q.status).toBe('broken');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '40:00' }]);
  });

  test('the same word repeated 12:00-16:00 → partial, loop 12:00-16:00', () => {
    const transcript = lesson({ say: urduLoop(sec(12), sec(16)) });
    const q = tq.assess({ transcript, periodMinutes: 40, env: {} });
    expect(q.status).toBe('partial');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });

  test('an English word repeated 12:00-40:00 → broken', () => {
    const say = (s) => (s >= sec(12) ? ['okay', 'Okay.', 'OKAY!', 'okay, okay'][(s / 30) % 4] : null);
    const q = tq.assess({ transcript: lesson({ lang: 'EN', to: sec(40), say }), periodMinutes: 40, env: {} });
    expect(q.status).toBe('broken');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '40:00' }]);
  });
});

describe('the loop check', () => {
  test('one token making up ≥ 80% of the tokens across consecutive lines is a loop, though no two lines match', () => {
    const say = (s) => (s >= sec(12) && s <= sec(16)
      ? ['ہاں ہاں ہاں ہاں جی', 'ہاں ہاں ہاں ہاں ٹھیک', 'ہاں ہاں ہاں ہاں اچھا'][(s / 30) % 3]
      : null);
    const q = tq.assess({ transcript: lesson({ say }), periodMinutes: 40, env: {} });
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });

  test('a token at 60% of the tokens is not a loop', () => {
    const say = (s) => (s >= sec(12) && s <= sec(16)
      ? ['ہاں ہاں ہاں جی بیٹا', 'ہاں ہاں ہاں ٹھیک ہے', 'ہاں ہاں ہاں اچھا بچو'][(s / 30) % 3]
      : null);
    const q = tq.assess({ transcript: lesson({ say }), periodMinutes: 40, env: {} });
    expect(q.status).toBe('ok');
    expect(q.issues).toEqual([]);
  });

  test('Urdu punctuation (، ۔ ؟) and diacritics (U+064B-0652, U+0670) are stripped before lines are compared', () => {
    // Three words, so no single token reaches 80%: only a same-line match makes this a loop.
    const variants = ['یہ کیا ہے؟', 'یہ کیا ہے۔', 'یِہ کیا ہَے،', 'یہ کِیا ہٰے', 'یہ  کیا   ہےٌ'];
    const say = (s) => (s >= sec(12) && s <= sec(16) ? variants[(s / 30) % variants.length] : null);
    const q = tq.assess({ transcript: lesson({ say }), periodMinutes: 40, env: {} });
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });

  test('English case and punctuation are stripped too', () => {
    const variants = ['Thank you, teacher.', 'thank you teacher!', 'THANK YOU TEACHER', 'Thank you... teacher?'];
    const say = (s) => (s >= sec(12) && s <= sec(16) ? variants[(s / 30) % variants.length] : null);
    const q = tq.assess({ transcript: lesson({ lang: 'EN', say }), periodMinutes: 40, env: {} });
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '16:00' }]);
  });

  test('a repeat shorter than 3 minutes is not a loop', () => {
    const q = tq.assess({ transcript: lesson({ say: urduLoop(sec(12), sec(14, 30)) }), periodMinutes: 40, env: {} });
    expect(q.status).toBe('ok');
  });

  test('a long loop ends at its last repeating line, not inside the speech after it', () => {
    // 18 minutes of one word: a short ordinary line after it is still under 20% of the run's tokens.
    const q = tq.assess({ transcript: lesson({ say: urduLoop(sec(12), sec(30)) }), periodMinutes: 40, env: {} });
    expect(q.status).toBe('partial');
    expect(q.issues).toEqual([{ type: 'loop', from: '12:00', to: '30:00' }]);
  });

  test('loops add up: two 11-minute loops in a 40-minute period are broken', () => {
    const say = (s) => urduLoop(sec(2), sec(13))(s) || urduLoop(sec(20), sec(31))(s);
    const q = tq.assess({ transcript: lesson({ say }), periodMinutes: 40, env: {} });
    expect(q.status).toBe('broken');
    expect(q.issues).toEqual([
      { type: 'loop', from: '02:00', to: '13:00' },
      { type: 'loop', from: '20:00', to: '31:00' },
    ]);
  });
});

describe('coverage and boundaries', () => {
  test('coverage = last timestamp in minutes / period', () => {
    const q = tq.assess({ transcript: lesson({ to: sec(27) }), periodMinutes: 30, env: {} });
    expect(q.coverage).toBeCloseTo(0.9, 4);
    expect(q.status).toBe('ok');
    expect(q.period_minutes).toBe(30);
    expect(q.first_ts).toBe('00:30');
    expect(q.last_ts).toBe('27:00');
  });

  test('a first line at exactly 03:00 is not a late start; 3 minutes between line starts, less the speech, is no gap', () => {
    expect(tq.assess({ transcript: lesson({ from: sec(3) }), periodMinutes: 40, env: {} }).status).toBe('ok');
    // The 18:00 line speaks to 18:02, so 18:00-21:00 holds 2:58 of silence (the exact boundary: transcript-quality-r2).
    const q = tq.assess({ transcript: lesson({ skip: (s) => s > sec(18) && s < sec(21) }), periodMinutes: 40, env: {} });
    expect(q.issues).toEqual([]);
  });

  test('several issues are reported in time order', () => {
    const transcript = lesson({ from: sec(5), to: sec(24), skip: (s) => s > sec(10) && s < sec(15) });
    const q = tq.assess({ transcript, periodMinutes: 40, env: {} });
    expect(q.status).toBe('partial');
    expect(q.issues).toEqual([
      { type: 'late_start', to: '05:00' },
      { type: 'gap', from: '10:02', to: '15:00' },
      { type: 'short', from: '24:00' },
    ]);
  });

  test('a transcript with no timed line is broken, coverage 0', () => {
    for (const transcript of ['', null, 'Teacher: no timings here']) {
      const q = tq.assess({ transcript, periodMinutes: 40, env: {} });
      expect(q.status).toBe('broken');
      expect(q.coverage).toBe(0);
      expect(q.issues).toEqual([{ type: 'short', from: '00:00' }]);
    }
  });

  test('without a period, coverage is judged against the transcript itself (no short issue)', () => {
    const q = tq.assess({ transcript: lesson({ to: sec(24) }), periodMinutes: null, env: {} });
    expect(q.status).toBe('ok');
    expect(q.coverage).toBe(1);
    expect(q.period_minutes).toBeNull();
  });
});

describe('env overrides come from the env argument', () => {
  const short = lesson({ to: sec(24) });
  test('DEFAULTS are the spec §6.4 values, plus the speaking rate of RULINGS R20', () => {
    expect(tq.DEFAULTS).toEqual({
      RECORDING_FULL_SHARE: 0.8,
      TRANSCRIPT_LATE_START_SEC: 180,
      TRANSCRIPT_LOOP_MINUTES: 3,
      TRANSCRIPT_GAP_MINUTES: 3,
      TRANSCRIPT_BROKEN_SHARE: 0.5,
      TRANSCRIPT_CHARS_PER_SEC: 16,
    });
  });

  test('RECORDING_FULL_SHARE', () => {
    expect(tq.assess({ transcript: short, periodMinutes: 40, env: { RECORDING_FULL_SHARE: '0.5' } }).status).toBe('ok');
  });

  test('TRANSCRIPT_LATE_START_SEC', () => {
    const transcript = lesson({ from: sec(5) });
    expect(tq.assess({ transcript, periodMinutes: 40, env: { TRANSCRIPT_LATE_START_SEC: '400' } }).status).toBe('ok');
  });

  test('TRANSCRIPT_GAP_MINUTES', () => {
    const transcript = lesson({ skip: (s) => s > sec(18) && s < sec(23) });
    expect(tq.assess({ transcript, periodMinutes: 40, env: { TRANSCRIPT_GAP_MINUTES: '6' } }).status).toBe('ok');
  });

  test('TRANSCRIPT_LOOP_MINUTES', () => {
    const transcript = lesson({ say: urduLoop(sec(12), sec(16)) });
    expect(tq.assess({ transcript, periodMinutes: 40, env: { TRANSCRIPT_LOOP_MINUTES: '5' } }).status).toBe('ok');
  });

  test('TRANSCRIPT_BROKEN_SHARE', () => {
    const transcript = lesson({ to: sec(40), say: urduLoop(sec(12), sec(40)) });
    expect(tq.assess({ transcript, periodMinutes: 40, env: { TRANSCRIPT_BROKEN_SHARE: '0.8' } }).status).toBe('partial');
  });

  test('a value that is not a positive number falls back to the default', () => {
    const env = { RECORDING_FULL_SHARE: 'abc', TRANSCRIPT_GAP_MINUTES: '-1', TRANSCRIPT_BROKEN_SHARE: '' };
    expect(tq.assess({ transcript: short, periodMinutes: 40, env }).issues).toEqual([{ type: 'short', from: '24:00' }]);
  });
});

describe('promptGaps (spec §5.3 TRANSCRIPT GAPS block)', () => {
  test('empty when the transcript is ok', () => {
    expect(tq.promptGaps(tq.assess({ transcript: lesson(), periodMinutes: 40, env: {} }))).toBe('');
    expect(tq.promptGaps(null)).toBe('');
  });

  test('one line per issue, in the §5.3 wording, the share with no usable speech, then the IE instruction (CONTRACTS §11.1)', () => {
    const transcript = lesson({ from: sec(5), to: sec(24), skip: (s) => s > sec(10) && s < sec(15), say: urduLoop(sec(16), sec(20)) });
    const block = tq.promptGaps(tq.assess({ transcript, periodMinutes: 40, env: {} }));
    expect(block.split('\n')).toEqual([
      'TRANSCRIPT GAPS:',
      '- no speech before 05:00',
      '- no speech from 10:02 to 15:00',
      '- the same words repeat from 16:00 to 20:00 (not real speech)',
      '- no speech after 24:00 of a 40-minute period',
      'About 75% of the 40-minute period has no usable speech (gaps, loops, a late start or an early end).',
      'For every indicator whose evidence would fall in these gaps, or whose "Couldn\'t tell" line applies because a',
      'large part of the lesson is missing, return "IE" instead of a level. Do not guess a level from the part that remains.',
    ]);
  });
});

describe('stored and purity', () => {
  test('stored() keeps exactly status, coverage and issues', () => {
    const q = tq.assess({ transcript: lesson({ to: sec(24) }), periodMinutes: 40, env: {} });
    expect(tq.stored(q)).toEqual({ status: 'partial', coverage: q.coverage, issues: [{ type: 'short', from: '24:00' }] });
    expect(tq.stored(null)).toBeNull();
  });

  test('the module requires nothing: no I/O, no model', () => {
    expect(fs.readFileSync(MODULE, 'utf8')).not.toMatch(/\brequire\s*\(/);
  });
});
