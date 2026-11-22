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
