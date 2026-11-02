'use strict';

/**
 * Round 9 item 5, every Urdu item: an operation said between two numbers is said in English (Urdu script), not only in the
 * two-number sums withEquals finishes with "equals". The number-representation item «یہ کون سا نمبر ہے؟ ۱۰۰۰ جمع ۳۰۰ جمع ۸۰ جمع ۳»
 * still said «جمع» three times after round 9 (heard on staging). Voice only: the screen text and the clip key stay.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const EXPANDED = 'یہ کون سا نمبر ہے؟ ۱۰۰۰ جمع ۳۰۰ جمع ۸۰ جمع ۳';
const OP_BETWEEN_NUMBERS = /[\d۰-۹]\s+(?:جمع|منفی|ضرب|تقسیم)\s+[\d۰-۹]/;

test('withEnglishOps: every operation between two numbers in English; words and English lines left alone', () => {
  expect(P.withEnglishOps(EXPANDED, 'ur')).toBe('یہ کون سا نمبر ہے؟ ۱۰۰۰ پلس ۳۰۰ پلس ۸۰ پلس ۳');
  expect(P.withEnglishOps('۱۵ منفی ۷', 'ur')).toBe('۱۵ مائنس ۷');
  expect(P.withEnglishOps('واپسی پر بلال نے کیا جمع کیے؟', 'ur')).toBe('واپسی پر بلال نے کیا جمع کیے؟');
  expect(P.withEnglishOps('What number is this? 1,000 + 300 + 80 + 3', 'en')).toBe('What number is this? 1,000 + 300 + 80 + 3');
});

test('v4 Urdu: no item is sent with an Urdu operation between two numbers; the expanded number is sent with plus x3', async () => {
  const sent = [];
  await run(['--set', 'v4', '--lang', 'ur', '--apply', '--max-usd', '100'], {
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4ops-')), out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  expect(voiceManifest(loadBank()).some((r) => r.lang === 'ur' && r.text === EXPANDED)).toBe(true);
  const job = sent.find((j) => j.text.startsWith('یہ کون سا نمبر ہے؟ one thousand'));
  expect(job && job.text).toBe('یہ کون سا نمبر ہے؟ one thousand پلس three hundred پلس eighty پلس three');
  expect(sent.filter((j) => OP_BETWEEN_NUMBERS.test(j.text) || /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+ty|[a-z]+teen|hundred|thousand) (?:جمع|منفی|ضرب|تقسیم) /.test(j.text)).map((j) => j.text)).toEqual([]);
});

// «سبٹریکشن» in Urdu script came out as "separation" / "sab pareeksha" in 3 of 4 lines (staging STT, round 9); «ایڈیشن» and
// «ملٹی پلیکیشن» were heard right every time. The voice is given the English word, as it is given English numbers; the screen keeps
// «سبٹریکشن».
test('v4 Urdu: every line naming subtraction is sent the English word, none the Urdu-script respelling', async () => {
  const sent = [];
  await run(['--set', 'v4', '--lang', 'ur', '--apply', '--max-usd', '100'], {
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4sub-')), out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  const lines = voiceManifest(loadBank()).filter((r) => r.lang === 'ur' && r.text.includes('سبٹریکشن'));
  expect(lines.length).toBeGreaterThanOrEqual(4);
  expect(sent.filter((j) => j.text.includes('سبٹریکشن'))).toEqual([]);
  expect(sent.filter((j) => /\bsubtraction\b/.test(j.text)).length).toBe(lines.length);
  expect(P.withEnglishWords('یہ کچھ سبٹریکشن کے سوال ہیں۔', 'ur')).toBe('یہ کچھ subtraction کے سوال ہیں۔');
  expect(P.withEnglishWords('Some subtraction now.', 'en')).toBe('Some subtraction now.');
});
