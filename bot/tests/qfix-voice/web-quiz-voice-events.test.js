/**
 * The page's voice events reach the logs with the fields that name a root cause (web-quiz.service.js cleanEvent).
 *
 * Bug (Nov 2026): web_quiz.audio_fallback carried only its reason, so a stalled clip could not be told apart by host,
 * time to failure, part, view state or format; the relay kept only allow-listed props, so a page that sent them would
 * still have lost them.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key-not-used';

const { cleanEvent } = require('../../shared/services/quiz/web-quiz.service');

const QID = '99999991-9999-4999-8999-999999999999';

test('audio_fallback keeps part, question, host, format, time to failure, view state, gesture age and media error', () => {
  const out = cleanEvent({ n: 'audio_fallback', reason: 'stalled', part: 'q', qid: QID, host: 'r2', fmt: 'ogg', ms: 5000, vis: 'visible', gms: 1200, net: '3g', err: 'media_err_2' }, { rich: true });
  expect(out.props).toMatchObject({ reason: 'stalled', part: 'q', qid: QID, host: 'r2', fmt: 'ogg', ms: 5000, vis: 'visible', gms: 1200, net: '3g', err: 'media_err_2' });
});

test('audio_retry keeps its part, question, outcome and time; audio_format keeps what the phone can play', () => {
  expect(cleanEvent({ n: 'audio_retry', part: 'opt', qid: QID, ok: true, ms: 800 }).props).toMatchObject({ part: 'opt', qid: QID, ok: true, ms: 800 });
  expect(cleanEvent({ n: 'audio_format', fmt: 'mp3', can: 'ogg0mp31' }).props).toMatchObject({ fmt: 'mp3', can: 'ogg0mp31' });
});

test('a host, format or view state outside its fixed shape is dropped (never a URL, never free text)', () => {
  const out = cleanEvent({ n: 'audio_fallback', reason: 'error', host: 'https://acct.r2.cloudflarestorage.com/b/k.ogg', fmt: 'audio/ogg; codecs=opus', vis: 'Hidden!', gms: 'soon' });
  expect(out.props).toEqual({ reason: 'error' });
});

test('the new fields are the voice events\' only: another event carrying them keeps none of them', () => {
  const out = cleanEvent({ n: 'answer', host: 'r2', fmt: 'ogg', vis: 'visible', gms: 12, can: 'ogg1mp31' });
  expect(out.props).toEqual({});
});

test('audio_slow keeps its start time, part, question, host, format and view state', () => {
  expect(cleanEvent({ n: 'audio_slow', ms: 6200, part: 'q', qid: QID, host: 'r2', fmt: 'ogg', vis: 'visible' }).props).toMatchObject({ ms: 6200, part: 'q', qid: QID, host: 'r2', fmt: 'ogg', vis: 'visible' });
});

test('audio_probe keeps the failed clip\'s facts and what a 2-byte fetch of it got back (fst: the status, fct: the bare content-type)', () => {
  const QID2 = '99999992-9999-4999-8999-999999999999';
  expect(cleanEvent({ n: 'audio_probe', err: 'media_err_4', part: 'opt', qid: QID2, host: 'r2', fmt: 'ogg', vis: 'visible', net: '4g', ms: 1800, gms: 900, fst: '206', fct: 'audio/ogg' }).props)
    .toMatchObject({ err: 'media_err_4', part: 'opt', qid: QID2, host: 'r2', fmt: 'ogg', vis: 'visible', net: '4g', ms: 1800, gms: 900, fst: '206', fct: 'audio/ogg' });
  for (const fst of ['403', 'opaque', 'net', 'timeout', 'err']) expect(cleanEvent({ n: 'audio_probe', fst }).props.fst).toBe(fst);
  expect(cleanEvent({ n: 'audio_probe', fst: 'https://acct.r2.cloudflarestorage.com/b/k.ogg', fct: 'text/html; charset=utf-8', host: 'https://x.test' }).props).toEqual({});
  expect(cleanEvent({ n: 'answer', fst: '206', fct: 'audio/mpeg' }).props).toEqual({});
});

test('a stall keeps what the element held (rs readyState 0-4, ns networkState 0-3, buf seconds buffered) on audio_fallback and audio_slow only', () => {
  expect(cleanEvent({ n: 'audio_fallback', reason: 'stalled', rs: 0, ns: 2, buf: 0 }).props).toMatchObject({ reason: 'stalled', rs: 0, ns: 2, buf: 0 });
  expect(cleanEvent({ n: 'audio_slow', reason: 'stalled', rs: 4, ns: 1, buf: 2.5 }).props).toMatchObject({ rs: 4, ns: 1, buf: 2.5 });
  expect(cleanEvent({ n: 'audio_fallback', reason: 'stalled', rs: 7, ns: -1, buf: 99999 }).props).toEqual({ reason: 'stalled' });
  expect(cleanEvent({ n: 'audio_fallback', reason: 'stalled', rs: '2', ns: 1.5, buf: 'lots' }).props).toEqual({ reason: 'stalled' });
  expect(cleanEvent({ n: 'audio_retry', rs: 1, ns: 1, buf: 1 }).props).toEqual({});
  expect(cleanEvent({ n: 'answer', rs: 1, ns: 1, buf: 1 }).props).toEqual({});
});
