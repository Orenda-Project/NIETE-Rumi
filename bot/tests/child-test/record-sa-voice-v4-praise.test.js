'use strict';

/**
 * record-sa-voice.js --set v4: praise sounds enthusiastic and loving (the content owner, round 8 item 9: "it really
 * matters to kids that the shabash is enthusiastic and loving"). A praise line («شاباش», "Well done", "Yes!", "Very good")
 * goes to ElevenLabs with the [excited] tag in place of the instruction mood tag; nothing else changes, same keys.
 * --praise re-records just those lines over the clips already on disk.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, loadBank } = require('../../scripts/child-test/record-sa-voice');
const P = require('../../scripts/child-test/sa-voice-providers');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const manifest = voiceManifest(loadBank());

async function record(argv, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4pr-'))) {
  const sent = [];
  const res = await run([...argv, '--apply', '--max-usd', '100'], {
    outDir: dir, out: () => {},
    synth: async (job) => { sent.push(job); return { audio: Buffer.alloc(2000, 1) }; },
    level: async (b) => Buffer.concat([b, Buffer.alloc(4000)]),
  });
  return { dir, sent, res };
}

test('isPraise: the praise lines, and nothing else', () => {
  for (const t of ['شاباش!', 'شاباش! یہ لفظ کرسی ہے۔', 'سارے کھیل ختم! بہت اچھی کوشش کی، شاباش!', 'Well done!', 'Yes! This word is cat.',
    'Very good, the first sound in "day" is duh.', 'Stop. Well done for trying.']) expect(P.isPraise(t)).toBe(true);
  for (const t of ['Now it is your turn!', 'اب آپ کی باری! ہر حرف کی آواز بولیں۔', 'Yesterday', 'Is it a good word?']) expect(P.isPraise(t)).toBe(false);
});

test('v4 Chutki: a praise line is sent with [excited] (no other mood tag), sounds kept; --praise re-records only those', async () => {
  for (const lang of ['en', 'ur']) {
    const rows = manifest.filter((r) => r.lang === lang && P.isPraise(r.text));
    expect(rows.length).toBeGreaterThan(20);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-v4pr-'));
    await record(['--set', 'v4', '--lang', lang], dir);
    const { sent, res } = await record(['--set', 'v4', '--lang', lang, '--praise'], dir);
    expect(res.recorded).toBe(rows.length);
    expect(sent.every((j) => j.text.startsWith('[excited] ') && !j.text.includes('[cheerfully]'))).toBe(true);
  }
  const { sent } = await record(['--set', 'v4', '--lang', 'en', '--praise']);
  expect(sent.map((j) => j.text)).toContain('[excited] Yes! The sound of this letter is [slowly] mmmmm.');
  expect(sent.map((j) => j.text)).toContain('[excited] Well done!');
});

test('the other lines keep their tags; Soniox is untouched', async () => {
  const { sent } = await record(['--set', 'v4', '--lang', 'en']);
  expect(sent.some((j) => j.text.startsWith('[cheerfully] '))).toBe(true);
  const so = await record(['--set', 'v4', '--lang', 'en', '--provider', 'soniox']);
  expect(so.sent.some((j) => j.text.includes('[excited]'))).toBe(false);
});
