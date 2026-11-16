'use strict';

/**
 * The plain speech-to-text pass the stricter another-voice check falls back on: the scorer's usual call carries one
 * language hint and the bot's classroom-observation context, and on some real recordings it hears no word where a
 * request with both language hints and no context hears an adult clearly. Only Soniox's HTTP API is a stand-in.
 */

jest.mock('axios');
const axios = require('axios');
const stt = require('../../shared/services/child-test/scoring/stt');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('transcribePlain', () => {
  let file;
  beforeEach(() => {
    jest.resetAllMocks();
    file = path.join(os.tmpdir(), `stt-plain-${process.pid}.mp3`);
    fs.writeFileSync(file, Buffer.from('ID3'));
    axios.post.mockImplementation(async (url) => (url.endsWith('/v1/files') ? { data: { id: 'file-1' } } : { data: { id: 'tr-1' } }));
    axios.get.mockImplementation(async (url) => (url.endsWith('/transcript')
      ? { data: { tokens: [{ text: 'آپ' }, { text: ' کو' }, { text: ' زیادہ' }, { text: ' دکھ' }] } }
      : { data: { status: 'completed' } }));
    axios.delete.mockResolvedValue({ data: {} });
  });
  afterEach(() => { try { fs.unlinkSync(file); } catch (_) { /* gone */ } });

  test('both language hints, language identification, no classroom context, no speaker split', async () => {
    const r = await stt.transcribePlain(file, 4, { pollMs: 1 });
    const body = axios.post.mock.calls.find(([url]) => url.endsWith('/v1/transcriptions'))[1];
    expect(body).toMatchObject({ file_id: 'file-1', language_hints: ['ur', 'en'], enable_language_identification: true });
    expect(body).not.toHaveProperty('context');
    expect(body).not.toHaveProperty('enable_speaker_diarization');
    expect(r.words).toBe(4);
    expect(r.text).toBe('آپ کو زیادہ دکھ');
  });

  test('the transcription and the uploaded file are deleted afterwards (they hold a child\'s voice)', async () => {
    await stt.transcribePlain(file, 4, { pollMs: 1 });
    const gone = axios.delete.mock.calls.map(([url]) => url);
    expect(gone).toEqual(expect.arrayContaining([expect.stringMatching(/\/v1\/transcriptions\/tr-1$/), expect.stringMatching(/\/v1\/files\/file-1$/)]));
  });

  test('an aborted wait rejects with reason timeout, and still cleans up', async () => {
    axios.get.mockImplementation(async () => ({ data: { status: 'processing' } }));
    const ac = new AbortController();
    const p = stt.transcribePlain(file, 4, { signal: ac.signal, pollMs: 5 });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toMatchObject({ reason: 'timeout' });
    expect(axios.delete).toHaveBeenCalled();
  });

  test('a failed transcription is an error, not "no words"', async () => {
    axios.get.mockImplementation(async (url) => (url.endsWith('/transcript') ? { data: { tokens: [] } } : { data: { status: 'error', error_message: 'bad audio' } }));
    await expect(stt.transcribePlain(file, 4, { pollMs: 1 })).rejects.toThrow(/plain_stt_error/);
  });
});
