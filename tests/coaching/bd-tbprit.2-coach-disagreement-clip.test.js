'use strict';
/**
 * bd-tbprit.2 — the disputed step, cut on the server: a 60-second mp3 starting 15 seconds before the
 * grader's timestamp, streamed to the assigned coach only. Recordings are ogg/webm, so it is ffmpeg, not a
 * byte range. The recording link is presigned for five minutes and never reaches the browser.
 */
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { windowOf, parseAt, ffmpegArgs, openClip, ffmpegBinary } = require('../../dashboard/services/coach-disagreement-clip');

describe('windowOf / parseAt', () => {
  it('60 seconds from 15 before the timestamp, never before the start', () => {
    expect(windowOf(190)).toEqual({ start: 175, length: 60 });
    expect(windowOf(5)).toEqual({ start: 0, length: 60 });
  });

  it('at is whole seconds within six hours; anything else is null', () => {
    expect(parseAt('190')).toBe(190);
    expect(parseAt('0')).toBe(0);
    ['', '-1', '1.5', 'abc', '21601', undefined, ['1']].forEach((v) => expect(parseAt(v)).toBeNull());
  });
});

describe('ffmpegArgs', () => {
  it('seeks before the input, drops video, mono mp3 to stdout', () => {
    const a = ffmpegArgs('https://r2/x.ogg?sig', { start: 175, length: 60 });
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 2)).toEqual(['-ss', '175']);
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'));
    expect(a[a.indexOf('-i') + 1]).toBe('https://r2/x.ogg?sig');
    expect(a).toEqual(expect.arrayContaining(['-t', '60', '-vn', '-ac', '1', '-f', 'mp3']));
    expect(a[a.length - 1]).toBe('pipe:1');
  });
});

describe('ffmpegBinary', () => {
  it('FFMPEG_PATH wins, then the bundled binary, then ffmpeg on PATH', () => {
    expect(ffmpegBinary({ FFMPEG_PATH: '/x/ffmpeg' }, () => '/bundled')).toBe('/x/ffmpeg');
    expect(ffmpegBinary({}, () => '/bundled')).toBe('/bundled');
    expect(ffmpegBinary({}, () => { throw new Error('not installed'); })).toBe('ffmpeg');
  });
});

function fakeProc() {
  const p = new EventEmitter();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.kill = jest.fn();
  return p;
}

describe('openClip', () => {
  it('resolves the stdout stream once the first bytes arrive', async () => {
    const proc = fakeProc();
    const spawn = jest.fn(() => proc);
    const pending = openClip('https://r2/x.ogg', 190, { spawn, bin: 'ff' });
    proc.stdout.write(Buffer.from('ID3'));
    const out = await pending;
    expect(spawn).toHaveBeenCalledWith('ff', expect.arrayContaining(['-ss', '175']), expect.any(Object));
    expect(out.stream).toBeDefined();
    expect(out.first.toString()).toBe('ID3');
  });

  it('ffmpeg missing or exiting before any audio rejects, so the route can answer 503', async () => {
    const proc = fakeProc();
    const pending = openClip('https://r2/x.ogg', 10, { spawn: () => proc, bin: 'ff' });
    proc.emit('error', new Error('ENOENT'));
    await expect(pending).rejects.toThrow();

    const p2 = fakeProc();
    const pending2 = openClip('https://r2/x.ogg', 10, { spawn: () => p2, bin: 'ff' });
    p2.emit('close', 1);
    await expect(pending2).rejects.toThrow();
  });

  it('no audio within the time limit: ffmpeg is killed and it rejects', async () => {
    const proc = fakeProc();
    await expect(openClip('https://r2/x.ogg', 10, { spawn: () => proc, bin: 'ff', firstByteMs: 20 })).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalled();
  });
});
