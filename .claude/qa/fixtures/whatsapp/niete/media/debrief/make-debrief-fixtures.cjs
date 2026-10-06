#!/usr/bin/env node
/* Generates the two SYNTHETIC debrief recordings the observe mock lane uploads after a FICO form:
 *   debrief_respectful.ogg — a coach debriefing the fractions lesson in hameeda_16min.m4a the way the
 *                            debrief guide asks: intent, two specific strengths with evidence, a
 *                            reflective question, ONE improvement, a commitment, a return date.
 *   debrief_harmful.ogg    — the same visit debriefed badly: blame, comparison, a threat, no praise.
 *
 * Why synthetic: there is no real coach-teacher debrief we may ship in a public repo. These are
 * text-to-speech renderings of the scripts below, two voices, so the bot's real pipeline transcribes
 * and judges them (recorded once into the cassette library like any vendor answer). Nothing about the
 * verdict is scripted: the debrief judge decides from the transcript. Regenerate with
 *   OPENAI_API_KEY=… node make-debrief-fixtures.cjs
 * (needs ffmpeg). The scripts are fiction; no real teacher or coach is named. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
// The key: OPENAI_API_KEY, or read from a keys file (KEYS_FILE=keys/niete-record.env) — never printed.
const fromFile = () => {
  try { const m = fs.readFileSync(process.env.KEYS_FILE, 'utf8').match(/^OPENAI_API_KEY=["']?([^"'\n]+)/m); return m && m[1]; } catch (_) { return null; }
};
const KEY = process.env.OPENAI_API_KEY || (process.env.KEYS_FILE && fromFile());
if (!KEY) { console.error('OPENAI_API_KEY (or KEYS_FILE with it) is required'); process.exit(2); }
const VOICE = { coach: 'alloy', teacher: 'nova' };

const SCRIPTS = {
  debrief_respectful: [
    ['coach', 'Thank you for having me in your class today. I am here to support you, not to judge. Can we talk for a few minutes about the fractions lesson?'],
    ['teacher', 'Yes, of course. Thank you for coming.'],
    ['coach', 'Two things really worked. First, when a student gave an answer, you asked "why?" and waited, and she explained her reasoning about the shaded parts. That pushed the whole class to think.'],
    ['teacher', 'I was not sure if that was useful.'],
    ['coach', 'It was. Second, your definition of the numerator was very clear. You pointed at the shaded parts on the board and said the top number counts them, and the students repeated it correctly.'],
    ['teacher', 'Thank you. I practised that explanation.'],
    ['coach', 'What did you notice about how many students were talking during the lesson?'],
    ['teacher', 'Honestly, mostly the same few students answered. The others were quiet.'],
    ['coach', 'That is a good observation. One thing to try next time: after you ask a question, give everyone ten seconds to think, then have them tell a partner before anyone answers. That way more students speak.'],
    ['teacher', 'I can try think, pair, share in the next fractions lesson.'],
    ['coach', 'Great. So your commitment is to use think, pair, share at least twice in your next lesson. I will come back in two weeks to see how it goes. Is that alright?'],
    ['teacher', 'Yes, that is fine. Thank you.'],
  ],
  debrief_harmful: [
    ['coach', 'Your lesson today was very poor. Honestly I do not know what you were doing.'],
    ['teacher', 'I tried to explain fractions with the board.'],
    ['coach', 'Tried, yes, but you failed. The teacher in the next room is much better than you. Your students learned nothing.'],
    ['teacher', 'I did ask them questions.'],
    ['coach', 'Your questions were useless. If I see a lesson like this again I will report you to the district office and you can look for another job.'],
    ['teacher', 'Okay.'],
    ['coach', 'Just do better. That is all I have to say.'],
  ],
};

async function tts(text, voice, out) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'debrief-'));
  for (const [name, lines] of Object.entries(SCRIPTS)) {
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      const [who, text] = lines[i];
      const f = path.join(tmp, `${name}-${String(i).padStart(2, '0')}.mp3`);
      await tts(text, VOICE[who], f);
      parts.push(f);
    }
    const list = path.join(tmp, `${name}.txt`);
    fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
    const out = path.join(HERE, `${name}.ogg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', out]);
    console.log('wrote', path.relative(process.cwd(), out), fs.statSync(out).size, 'bytes');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
