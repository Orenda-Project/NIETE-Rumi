'use strict';

/**
 * record-sa-voice.js --set v4: the Urdu lines the content owner marked wrong on the listening list (16 Nov) are voiced from
 * the input that fixed them (UR_LINE_SAID: exact screen text → { say, model? }). A line the eleven_v3 voice kept saying
 * wrong is asked of the multilingual model, same voice. The screen keeps its text and the clip keeps its key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');

async function record(argv) {
  const sent = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4line-'));
  await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return sent;
}

test('lineSaid: a listed Urdu line gives its voice input (and model); anything else gives null', () => {
  expect(P.lineSaid('دال', 'ur')).toEqual({ say: 'دال۔', model: 'eleven_multilingual_v2' });
  expect(P.lineSaid('یہ حرف ثے ہے۔', 'ur')).toEqual({ say: 'یہ حرف «سے» ہے۔' });
  expect(P.lineSaid('بے', 'ur')).toBeNull();
  expect(P.lineSaid('دال', 'en')).toBeNull();
});

test('requestFor: ElevenLabs uses the job model when one is given, eleven_v3 otherwise', () => {
  const job = { provider: 'elevenlabs', voice: 'v', speed: null, lang: 'ur', text: 'x' };
  expect(P.requestFor(job, 'k').body.model_id).toBe('eleven_v3');
  expect(P.requestFor({ ...job, model: 'eleven_multilingual_v2' }, 'k').body.model_id).toBe('eleven_multilingual_v2');
});

test('v4: the marked lines are sent with their fix; a listed line wins over the letter-name respelling', async () => {
  const sent = await record(['--set', 'v4', '--lang', 'ur']);
  const by = (t) => sent.filter((j) => j.text === t);
  expect(by('دال۔')[0].model).toBe('eleven_multilingual_v2');
  expect(by('یہ حرف «سے» ہے۔').length).toBe(1);
  expect(by('کِلاس صاف ہونے کے بعد استاد خوش کیوں ہوئے؟').length).toBe(1);
  expect(sent.filter((j) => j.text === 'یہ حرف سے ہے۔')).toEqual([]);
  expect(sent.find((j) => j.text === 'بے').model).toBeUndefined();
});
