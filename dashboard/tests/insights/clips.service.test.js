'use strict';
/** NIGHTLY_JOB §4 stage 11, §10: the clip key, the cut through a temp file, the upload, and which moments need a cut.
 * spawn and putObject are mocked; the real temp-file path runs. No network, no R2. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const C = require('../../lib/insights/clips');

const SID = '0a1b2c3d-0000-4000-8000-00000000abcd';
const KEY_CHECK = /^coachip\/clips\/(sandbox|staging|production)\/[0-9a-f-]{36}\/[0-9]+-[0-9]+\.mp3$/;
const SRC = 'https://example.invalid/presigned/fictional.ogg?sig=abc';

function fakeSpawn({ code = 0, write = true, error = null } = {}) {
  const calls = [];
  const spawn = (bin, args) => {
    calls.push({ bin, args });
    const proc = new EventEmitter();
    proc.kill = () => {};
    proc.stderr = new EventEmitter();
    proc.stderr.resume = () => {};
    setImmediate(() => {
      if (error) { proc.emit('error', error); return; }
      if (write) fs.writeFileSync(args[args.length - 1], Buffer.from('fake mp3 bytes'));
      proc.emit('close', code);
    });
    return proc;
  };
  return { spawn, calls };
}

describe('clipKey', () => {
  test('matches the coachip_moments CHECK', () => {
    const k = C.clipKey('sandbox', SID, 480, 570);
    expect(k).toBe(`coachip/clips/sandbox/${SID}/480-570.mp3`);
    expect(k).toMatch(KEY_CHECK);
    expect(C.clipKey('production', SID, 0, 45)).toMatch(KEY_CHECK);
  });

  test('refuses anything the CHECK would refuse', () => {
    expect(() => C.clipKey('prod', SID, 0, 10)).toThrow();
    expect(() => C.clipKey('sandbox', 'not-a-uuid', 0, 10)).toThrow();
    expect(() => C.clipKey('sandbox', SID, 10, 10)).toThrow();
    expect(() => C.clipKey('sandbox', SID, -1, 10)).toThrow();
    expect(() => C.clipKey('sandbox', SID, 1.5, 10)).toThrow();
  });
});

describe('cutAndUpload', () => {
  let tmpDir;
  let logSpies;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coachip-clip-test-'));
    logSpies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => {
    const said = logSpies.flatMap((s) => s.mock.calls.map((c) => c.join(' '))).join('\n');
    expect(said).not.toContain('example.invalid');
    expect(said).not.toContain('coachip/clips');
    logSpies.forEach((s) => s.mockRestore());
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const key = C.clipKey('sandbox', SID, 480, 570);

  test('ffmpeg with the coach-disagreement-clip parameters into a temp file, then putObject; the temp file is removed', async () => {
    const { spawn, calls } = fakeSpawn();
    const putObject = jest.fn().mockResolvedValue({});
    const out = await C.cutAndUpload({ srcUrl: SRC, fromS: 480, toS: 570, key, deps: { spawn, bin: 'ffmpeg', tmpDir, putObject, bucket: 'rumi-sandbox' } });
    expect(out).toBe('ready');
    const { args } = calls[0];
    expect(args.slice(0, 11)).toEqual(['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', '480', '-i', SRC, '-t', '90', '-vn']);
    expect(args.slice(11, 18)).toEqual(['-ac', '1', '-b:a', '64k', '-f', 'mp3', args[17]]);
    expect(args[17].startsWith(tmpDir)).toBe(true);
    expect(putObject).toHaveBeenCalledTimes(1);
    const p = putObject.mock.calls[0][0];
    expect(p).toMatchObject({ Bucket: 'rumi-sandbox', Key: key, ContentType: 'audio/mpeg' });
    expect(Buffer.isBuffer(p.Body)).toBe(true);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('an ffmpeg failure returns failed, never uploads, and still removes the temp file', async () => {
    const { spawn } = fakeSpawn({ code: 1 });
    const putObject = jest.fn();
    const out = await C.cutAndUpload({ srcUrl: SRC, fromS: 0, toS: 45, key, deps: { spawn, bin: 'ffmpeg', tmpDir, putObject, bucket: 'rumi-sandbox' } });
    expect(out).toBe('failed');
    expect(putObject).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('a spawn error returns failed and leaves nothing behind', async () => {
    const { spawn } = fakeSpawn({ error: new Error(`spawn ENOENT ${SRC}`) });
    const putObject = jest.fn();
    const log = jest.fn();
    const out = await C.cutAndUpload({ srcUrl: SRC, fromS: 0, toS: 45, key, deps: { spawn, bin: 'ffmpeg', tmpDir, putObject, bucket: 'rumi-sandbox', log } });
    expect(out).toBe('failed');
    expect(fs.readdirSync(tmpDir)).toEqual([]);
    const said = log.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(said).not.toContain('example.invalid');
    expect(said).not.toContain('coachip/clips');
  });

  test('an R2 error returns failed and removes the temp file', async () => {
    const { spawn } = fakeSpawn();
    const putObject = jest.fn().mockRejectedValue(new Error(`denied ${key}`));
    const out = await C.cutAndUpload({ srcUrl: SRC, fromS: 0, toS: 45, key, deps: { spawn, bin: 'ffmpeg', tmpDir, putObject, bucket: 'rumi-sandbox' } });
    expect(out).toBe('failed');
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });

  test('an empty output is failed, never an empty object in R2', async () => {
    const { spawn } = fakeSpawn({ write: false });
    const putObject = jest.fn();
    const out = await C.cutAndUpload({ srcUrl: SRC, fromS: 0, toS: 45, key, deps: { spawn, bin: 'ffmpeg', tmpDir, putObject, bucket: 'rumi-sandbox' } });
    expect(out).toBe('failed');
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('planClips', () => {
  const m = (id, extra = {}) => ({ id, session_id: SID, from_s: 10, to_s: 50, confidence: 'high', clip_status: 'pending', ...extra });

  test('only moments that will be shown, not yet ready or expired, with a second to cut on', () => {
    const moments = [m('a'), m('b', { clip_status: 'ready' }), m('c', { clip_status: 'expired' }), m('d', { confidence: 'none' }),
      m('e'), m('f', { clip_status: 'failed' }), m('g', { confidence: 'medium' })];
    const out = C.planClips(moments, new Set(['a', 'b', 'c', 'd', 'f', 'g']));
    expect(out.map((x) => x.id)).toEqual(['a', 'f', 'g']);
    expect(C.planClips(moments, ['a']).map((x) => x.id)).toEqual(['a']);
    expect(C.planClips(moments, [])).toEqual([]);
  });
});
