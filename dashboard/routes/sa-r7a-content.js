'use strict';
/**
 * Round 7b, the child's screens: the words and the clip the switches add to a served battery (sa-battery-switches.js).
 * Each switch OFF leaves the battery exactly as it was; ON adds only its own lines (in the battery's language, as
 * { text, audio } like the battery's other lines) or, for the T sound, swaps one clip.
 *
 *   sa_say_then_next  lines.r7_say_next  a task read aloud one at a time: say it, then press Next
 *                     lines.r7_say_done  a question answered aloud: say the answer, then press Done
 *   sa_story_scroll   lines.r7_scroll    the story goes on below: slide the page up to read all of it
 *   sa_tick_prompt    lines.r7_type_tick a typed number: type it, then press the tick
 *   sa_t_sound_ta     the English letter sound of T: "ta" (its own clip, under a new key), not "tuh"
 *
 * Words for children: Urdu in Urdu script, gender-neutral (imperatives in -یں), the button names as the screen shows them
 * («آگے», «ہو گیا»). The clip keys follow the battery builder's rule (sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3); the clips
 * are in dashboard/sa/v1 and v2 (bot/scripts/child-test/record-sa-voice.js --extra).
 */
const crypto = require('crypto');

const keyOf = (lang, text) => `sa/v1/${lang}/${crypto.createHash('sha1').update(`${lang}|${text}`).digest('hex').slice(0, 12)}.mp3`;

const LINES = Object.freeze({
  r7_say_next: Object.freeze({
    en: 'Say each one out loud, then press Next.',
    ur: 'ہر ایک کو اونچی آواز میں بولیں، پھر «آگے» کا بٹن دبائیں۔',
  }),
  r7_say_done: Object.freeze({
    en: 'Say your answer out loud, then press Done.',
    ur: 'اپنا جواب اونچی آواز میں بتائیں، پھر «ہو گیا» کابٹن دبائیں۔',
  }),
  r7_scroll: Object.freeze({
    en: 'The story goes on below. Slide the page up with your finger to read all of it.',
    ur: 'کہانی نیچے بھی ہے۔ پوری کہانی پڑھنے کے لیے صفحے کو انگلی سے اوپر کھسکائیں۔',
  }),
  r7_type_tick: Object.freeze({
    en: 'Type the number, then press the tick.',
    ur: 'نمبر لکھیں، پھر صحیح کے نشان والا بٹن دبائیں۔',
  }),
});

// The switch (sa-battery-switches.js SWITCHES name) that adds each line.
const LINE_SWITCH = Object.freeze({ r7_say_next: 'sayThenNext', r7_say_done: 'sayThenNext', r7_scroll: 'storyScroll', r7_type_tick: 'tickPrompt' });

const T_SOUND = Object.freeze({ from: 'sa/v1/en/a6fe1df9b4aa.mp3', fromText: 'tuh', text: 'ta', to: keyOf('en', 'ta') });

/** The English letter-sound tasks (on an English or an Urdu page) with T said "ta" from its own clip. Nothing else. */
function withTa(battery) {
  if (!battery || !Array.isArray(battery.tasks)) return battery;
  let changed = false;
  const tasks = battery.tasks.map((t) => {
    if (!t || t.subtask !== 'letter_sound_identification' || t.lang !== 'en') return t;
    const before = JSON.stringify(t);
    const after = before.split(`"${T_SOUND.from}"`).join(`"${T_SOUND.to}"`).split(`"${T_SOUND.fromText}"`).join(`"${T_SOUND.text}"`);
    if (after === before) return t;
    changed = true;
    return JSON.parse(after);
  });
  return changed ? { ...battery, tasks } : battery;
}

/** The battery with the round-7b child-screen content its switches ask for (on: the SWITCHES-named booleans). Pure. */
function applyR7a(battery, on = {}) {
  if (!battery || !Array.isArray(battery.tasks)) return battery;
  let out = on.tSoundTa === true ? withTa(battery) : battery;
  const lang = out.lang === 'ur' ? 'ur' : 'en';
  const add = Object.keys(LINES).filter((k) => on[LINE_SWITCH[k]] === true);
  if (add.length) {
    out = { ...out, lines: { ...(out.lines || {}), ...Object.fromEntries(add.map((k) => [k, { text: LINES[k][lang], audio: keyOf(lang, LINES[k][lang]) }])) } };
  }
  return out;
}

module.exports = { LINES, LINE_SWITCH, T_SOUND, keyOf, applyR7a };
