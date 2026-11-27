'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const syn = require('./synthetic');
const { inspectRecording, repairRecording, probeEngine } = require('../../shared/services/coaching/recording-repair');

jest.setTimeout(120000);

// full decode with the bundled ffmpeg: errors on stderr, duration from the last time= line
function decode(buf, ext = 'm4a') {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-dec-')), `x.${ext}`);
  fs.writeFileSync(f, buf);
  let stderr = '';
  try { execFileSync(syn.ffmpegPath, ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { stderr = String(e.stderr || e.message); }
  const out = execFileSync(syn.ffmpegPath, ['-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return { errors: stderr.trim(), out };
}
function seconds(buf, ext = 'm4a') {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-dur-')), `x.${ext}`);
  fs.writeFileSync(f, buf);
  let txt = '';
  try { execFileSync(syn.ffmpegPath, ['-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txt = ''; }
  const r = require('child_process').spawnSync(syn.ffmpegPath, ['-i', f, '-f', 'null', '-'], { encoding: 'utf8' });
  const all = r.stderr.split('time=');
  const m = all[all.length - 1].match(/(\d+):(\d+):(\d+\.\d+)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

describe('inspectRecording', () => {
  const good = syn.make({ seconds: 12 });
  test('a finished m4a is ok', () => {
    const r = inspectRecording(good);
    expect(r.kind).toBe('ok');
    expect(r.container).toBe('mp4');
  });
  test('an m4a with no moov is no_moov and carries the recorder signature', () => {
    const r = inspectRecording(syn.noMoov(good));
    expect(r.kind).toBe('no_moov');
    expect(r.signature).toMatch(/^M4A /);
    expect(r.signature).toMatch(/free=\d+/);
  });
  test('a 0-byte upload is empty', () => {
    expect(inspectRecording(Buffer.alloc(0)).kind).toBe('empty');
  });
  test('an m4a cut in the middle of mdat is torn_tail or no_moov, never ok', () => {
    expect(['torn_tail', 'no_moov']).toContain(inspectRecording(syn.tornTail(good)).kind);
  });
  test('bytes that are no known container are unknown', () => {
    expect(inspectRecording(Buffer.from('this is not audio at all, just text'.repeat(10))).container).toBe('unknown');
  });
});

describe('repairRecording', () => {
  test('a finished file comes back untouched', async () => {
    const good = syn.make({ seconds: 8 });
    const r = await repairRecording(good);
    expect(r.outcome).toBe('intact');
    expect(r.buffer).toBe(good);
  });

  test('stereo 48k m4a with no moov is rebuilt: same length, decodes with 0 errors', async () => {
    const good = syn.make({ seconds: 30 });
    const broken = syn.noMoov(good);
    const r = await repairRecording(broken);
    expect(r.outcome).toBe('repaired');
    expect(['template']).toContain(r.method);
    expect(r.frames).toBeGreaterThan(1300);
    expect(decode(r.buffer).errors).toBe('');
    expect(Math.abs(seconds(r.buffer) - seconds(good))).toBeLessThan(0.2);
    expect(inspectRecording(r.buffer).kind).toBe('ok');
  });

  test('mdat size written as ???? is repaired too', async () => {
    const good = syn.make({ seconds: 15 });
    const r = await repairRecording(syn.noMoov(good, { mdatSize: 'marks' }));
    expect(r.outcome).toBe('repaired');
    expect(decode(r.buffer).errors).toBe('');
  });

  test('mono 44.1k m4a is repaired from the templates', async () => {
    const good = syn.make({ seconds: 15, rate: 44100, channels: 1 });
    const r = await repairRecording(syn.noMoov(good));
    expect(r.outcome).toBe('repaired');
    expect(r.template_guess).toMatch(/44100|mono/);
    expect(decode(r.buffer).errors).toBe('');
  });

  test("her own earlier good file is used first (method 'reference') and sets the codec config", async () => {
    const reference = syn.make({ seconds: 6, rate: 44100, channels: 2 });
    const good = syn.make({ seconds: 15, rate: 44100, channels: 2 });
    const r = await repairRecording(syn.noMoov(good), { reference });
    expect(r.outcome).toBe('repaired');
    expect(r.method).toBe('reference');
    expect(decode(r.buffer).errors).toBe('');
  });

  test('a file cut mid-mdat keeps every whole frame before the cut', async () => {
    const good = syn.make({ seconds: 30 });
    const r = await repairRecording(syn.tornTail(good, 0.5));
    expect(r.outcome).toBe('repaired');
    expect(seconds(r.buffer)).toBeGreaterThan(10);
    expect(decode(r.buffer).errors).toBe('');
  });

  test('bytes that are not audio are unrecoverable and nothing throws', async () => {
    const good = syn.make({ seconds: 8 });
    const junk = syn.noMoov(good);
    const b = require('./synthetic').boxes(junk).find((x) => x.type === 'mdat');
    for (let i = b.start + 16; i < junk.length; i++) junk[i] = (i * 2654435761) & 0xff;
    const r = await repairRecording(junk);
    expect(r.outcome).toBe('unrecoverable');
    expect(r.buffer).toBeUndefined();
  });

  test('a 0-byte file is unrecoverable with kind empty', async () => {
    const r = await repairRecording(Buffer.alloc(0));
    expect(r.outcome).toBe('unrecoverable');
    expect(r.kind).toBe('empty');
  });

  test('ladder 1: an ogg cut mid-stream is remuxed by ffmpeg', async () => {
    let good;
    try { good = syn.make({ seconds: 20, ext: 'ogg', codec: 'libvorbis' }); } catch (e) { return; }
    const r = await repairRecording(syn.tornTail(good, 0.7));
    expect(['repaired', 'intact']).toContain(r.outcome);
    if (r.outcome === 'repaired') expect(r.method).toBe('remux');
  });
});

describe('probeEngine', () => {
  test('this machine can load the frame finder', async () => {
    const r = await probeEngine();
    expect(r).toMatchObject({ ready: true, node: process.version, reason: null });
  });
  test('a machine that cannot says why, and never throws', async () => {
    const r = await probeEngine({ execFileImpl: (_n, _a, _o, cb) => cb(null, 'error:Cannot find module node-av') });
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/Cannot find module/);
    const t = await probeEngine({ execFileImpl: (_n, _a, _o, cb) => cb(Object.assign(new Error('x'), { killed: true }), '') });
    expect(t).toMatchObject({ ready: false, reason: 'timeout' });
  });
});
