'use strict';
/**
 * Round 28's clips (the letter-sound prompts, the story questions' read-out options, the two new task intros) live under
 * dashboard/sa/v5/<lang>/<sha1(lang|text)[:12]>.mp3. The picker and the MCQ play them clip-only (SPEC A-13, B-17: never a
 * browser voice), so a key a battery names without its file on disk is a question the child can never hear. Every key
 * a committed battery names has its mp3 here, every mp3 here is named by a battery, and the lock covers each one, so a
 * phone's offline copy (sw.js prepare) holds all of them.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const DASH = path.join(__dirname, '..');
const V5 = path.join(DASH, 'sa', 'v5');
const NAMES = fs.readdirSync(BATTERIES).filter((n) => /^sa\.(coach|game)\..+\.(en|ur)\.json$/.test(n));
const KEY = /^sa\/v5\/(en|ur)\/[0-9a-f]{12}\.mp3$/;

/** Every sa/v5 clip key in a battery, with the text it says where the battery carries one. */
function v5Keys() {
  const out = new Map();
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    if (typeof x.prompt_audio === 'string' && KEY.test(x.prompt_audio)) out.set(x.prompt_audio, x.prompt_text);
    if (Array.isArray(x.option_audio)) x.option_audio.forEach((k, i) => { if (KEY.test(k)) out.set(k, (x.options || [])[i]); });
    if (typeof x.audio === 'string' && KEY.test(x.audio)) out.set(x.audio, x.text);
    if (x.audio && typeof x.audio === 'object') for (const [lang, k] of Object.entries(x.audio)) if (KEY.test(k)) out.set(k, x[lang]);
    Object.values(x).forEach(walk);
  };
  for (const n of NAMES) walk(JSON.parse(fs.readFileSync(path.join(BATTERIES, n), 'utf8')));
  return out;
}

const isMp3 = (buf) => buf.length > 800 && ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));

describe('round 28 clips under sa/v5', () => {
  const keys = v5Keys();

  it('the batteries name round 28 clips at all (the picker prompts and the MCQ options)', () => {
    expect(keys.size).toBeGreaterThan(50);
  });

  it('every sa/v5 key a battery names is an mp3 on disk', () => {
    const missing = [...keys.keys()].filter((k) => !fs.existsSync(path.join(DASH, k)) || !isMp3(fs.readFileSync(path.join(DASH, k))));
    expect(missing).toEqual([]);
  });

  it('each key is the hash of the words it says, so one clip serves every task that says them', () => {
    const wrong = [...keys].filter(([k, text]) => text != null
      && crypto.createHash('sha1').update(`${k.split('/')[2]}|${text}`).digest('hex').slice(0, 12) !== path.basename(k, '.mp3'));
    expect(wrong).toEqual([]);
  });

  it('no clip under sa/v5 that no battery names', () => {
    const files = ['en', 'ur'].flatMap((l) => (fs.existsSync(path.join(V5, l)) ? fs.readdirSync(path.join(V5, l)) : []).map((f) => `sa/v5/${l}/${f}`));
    // a timing file beside a named clip is that clip's record (the two spliced picker intros: A08 in sa-tester-fixes)
    expect(files.filter((f) => !keys.has(f) && !(f.endsWith('.json') && keys.has(f.replace(/\.json$/, '.mp3'))))).toEqual([]);
  });

  it('the clips lock covers every sa/v5 clip, so the phone keeps it offline', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'clips.lock.json'), 'utf8'));
    expect([...keys.keys()].filter((k) => !lock.files[`dashboard/${k}`])).toEqual([]);
  });

  // SPEC A.5: tap_ms = tap - speech_end_ms (negative during the sound); tap_before_sound when the tap lands before
  // speech_start_ms + 150. A prompt without an entry falls back to the clip-end rule, so every prompt needs one.
  it('prompt_timings.json gives every picker prompt where its sound starts and ends inside the file', () => {
    const prompts = new Set();
    const walk = (x) => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (!x || typeof x !== 'object') return;
      if (typeof x.prompt_audio === 'string' && KEY.test(x.prompt_audio)) prompts.add(x.prompt_audio);
      Object.values(x).forEach(walk);
    };
    for (const n of NAMES) walk(JSON.parse(fs.readFileSync(path.join(BATTERIES, n), 'utf8')));
    const file = path.join(V5, 'prompt_timings.json');
    const t = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const bad = [...prompts].filter((k) => {
      const e = t[k];
      return !e || !Number.isInteger(e.speech_start_ms) || !Number.isInteger(e.speech_end_ms) || e.speech_start_ms < 0
        || e.speech_end_ms <= e.speech_start_ms + 100 || !Number.isInteger(e.dur_ms) || e.speech_end_ms > e.dur_ms;
    });
    expect({ prompts: prompts.size > 0, bad }).toEqual({ prompts: true, bad: [] });
    const lock = JSON.parse(fs.readFileSync(path.join(DASH, 'sa', 'clips.lock.json'), 'utf8'));
    expect(Boolean(lock.files['dashboard/sa/v5/prompt_timings.json'])).toBe(true);
  });
});
