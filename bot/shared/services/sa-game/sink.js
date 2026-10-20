'use strict';
/**
 * The big flight's sink (switch sa_game; the routes in sink.routes.js check the switch first). The engine's
 * putBatch / presignAudio / registerAudio / status for one game run, linked by a run token:
 *
 *   session({ t, kid, part, form, lang, n, device })  the child the hub token + chip name on this phone (kidFromHub) →
 *                                                      one run per child · part · form · PKT day · run number n (the
 *                                                      same five give the same run) → { session_id, st }
 *   batch({ st, session_id, seq_from, seq_to, events, results })  → { ok, acked_to }   (events ≤ 500, results ≤ 50)
 *   presign({ st, task_id, item_id?, mime, bytes })   → { url, key }   (audio ≤ 8 MB, under the run's own prefix)
 *   register({ st, task_id, item_id?, key, bytes, duration_ms })  → { ok }   (a key this run was given, in R2; a
 *                                                      per-item recording is appended to the task's list, never
 *                                                      written over another item's)
 * Each also takes the coach sink's camelCase names (seqFrom, seqTo, taskId, itemId, durationMs); batch answers
 * acked_to and ackedTo.
 *   status({ st })                                     → { status, tasks_done, last_seq }
 *
 * Each answers { status: <http>, body }. The run token st = { k:'sag', sid, m, exp } (12 h): the run's id and which
 * store holds it, never a student id. Keys: child-test/<env>/game/<run id>/<task>[/<item>].<ext> (the child test's
 * env rule; no name, no id but the run's). Storage: store-adapter.js.
 */
const crypto = require('crypto');
const T = require('../quiz/web-quiz-token');

const PARTS = Object.freeze(['maths', 'english', 'urdu', 'tower']);
const FORMS = Object.freeze(['game.G1', 'game.G23', 'game.G45']);
const TASK_RX = /^(ma|en|ur)\.[a-z0-9_]+$/;
const ITEM_RX = /^[A-Za-z0-9_.-]{1,60}$/;
const CHIP_RX = /^[0-9a-f]{16}$/;
const MAX_EVENTS = 500;
const MAX_RESULTS = 50;
const MAX_AUDIO = 8 * 1024 * 1024;
const ST_TTL_S = 12 * 60 * 60;
const PRESIGN_TTL_S = 15 * 60;
const MIMES = Object.freeze({ 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3' });
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const ok = (body) => ({ status: 200, body });
const no = (status, error) => ({ status, body: { error } });

function pktDay(now = new Date()) {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** A stable uuid-shaped id for one run (keyed hash: not reversible to the student id). */
function idFor(...parts) {
  const key = T.secret() || Buffer.from('sa-game');
  const h = crypto.createHmac('sha256', key).update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function envSegment() {
  return process.env.CHILD_TEST_R2_ENV || process.env.RAILWAY_ENVIRONMENT || 'local';
}
const prefixOf = (sid) => `child-test/${envSegment()}/game/${sid}/`;
const keyOf = (sid, taskId, itemId, ext) => `${prefixOf(sid)}${taskId}${itemId ? `/${itemId}` : ''}${ext}`;

// The engine's adapter (dashboard/sa/sink-game.js) speaks the coach sink's camelCase wire shapes; both are taken here.
const ALIASES = Object.freeze({ seqFrom: 'seq_from', seqTo: 'seq_to', sessionId: 'session_id', taskId: 'task_id', itemId: 'item_id', durationMs: 'duration_ms' });
function snake(a) {
  const out = { ...(a || {}) };
  for (const [camel, sn] of Object.entries(ALIASES)) if (out[sn] === undefined && out[camel] !== undefined) out[sn] = out[camel];
  return out;
}

const isInt = (n) => Number.isInteger(n) && n >= 0;
const modeOf = (p) => (p.m === 'c' ? 'child_test' : 'runs');

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !isInt(e.seq) || typeof e.type !== 'string' || !e.type) return null;
  if (e.task_id != null && (typeof e.task_id !== 'string' || e.task_id.length > 60)) return null;
  return {
    seq: e.seq,
    t_ms: Number.isFinite(e.t_ms) ? Math.round(e.t_ms) : null,
    at: typeof e.at === 'string' ? e.at.slice(0, 40) : null,
    type: e.type.slice(0, 40),
    task_id: typeof e.task_id === 'string' ? e.task_id : null,
    item_id: typeof e.item_id === 'string' ? e.item_id.slice(0, 60) : null,
    value: e.value === undefined ? null : e.value,
  };
}

function createSink(deps = {}) {
  const d = {
    kidFromHub: deps.kidFromHub || ((...a) => require('../quiz/web-quiz-hub').kidFromHub(...a)), // eslint-disable-line global-require
    r2: deps.r2 || null,
    now: deps.now || (() => new Date()),
    // a game recording is kept only as the Challenge keeps one: web_quiz_challenge_keep_audio ON and a consent on file
    // (the mic notice or a grown-up's yes, web-quiz-trail-page consentFor); anything else, or a failed read: not kept
    keepAudio: deps.keepAudio || (async (body) => {
      try {
        if (!(await require('../quiz/web-quiz-challenge').keepAudioOn())) return false; // eslint-disable-line global-require
        const c = await require('../quiz/web-quiz-trail-page').consentFor({ audio_consent: body && body.audio_consent }); // eslint-disable-line global-require
        return c != null && c !== 'not_asked' && c !== 'kept_no';
      } catch (_) {
        return false;
      }
    }),
  };
  // required where used: loading the sink (the router does, at boot) connects to nothing
  const store = () => deps.store || require('./store-adapter'); // eslint-disable-line global-require
  const r2 = () => d.r2 || require('../../storage/r2'); // eslint-disable-line global-require

  const verifySt = (st) => (typeof st === 'string' ? T.verify(st, 'sag') : null);

  async function session({ t, kid, part, form, lang, n, device } = {}) {
    if (!PARTS.includes(part) || !FORMS.includes(form)) return no(400, 'bad_request');
    const runNo = n == null ? 1 : Number(n);
    if (!Number.isInteger(runNo) || runNo < 1 || runNo > 99) return no(400, 'bad_request');
    if (typeof t !== 'string' || !t || t.length > 1100 || !CHIP_RX.test(String(kid || ''))) return no(401, 'not_child');
    const who = await d.kidFromHub(t, String(kid), device == null ? undefined : String(device));
    if (!who || !who.studentId) return no(401, 'not_child');
    const day = pktDay(d.now());
    const id = idFor('sag', who.studentId, part, form, day, runNo);
    const l = lang === 'en' || lang === 'ur' ? lang : (who.lang === 'en' ? 'en' : 'ur');
    // exposure: the Big flight once per PKT month once finished; every run counts how often this part was met this month
    const ex = await store().exposure({ studentId: who.studentId, form, part, day });
    if (ex && ex.ok && part === 'tower' && ex.flightDone) return no(409, 'flight_done');
    const exposureN = ex && ex.ok ? ex.n + 1 : null;
    const out = await store().createRun({ id, drawId: idFor('sag-draw', id), studentId: who.studentId, grade: who.grade, lang: l, part, form, n: runNo, day, exposureN });
    if (!out || !out.ok) return no(503, 'unavailable');
    const st = T.sign({ k: 'sag', sid: id, m: out.mode === 'child_test' ? 'c' : 'r', exp: Math.floor(d.now().getTime() / 1000) + ST_TTL_S });
    if (!st) return no(503, 'unavailable');
    return ok({ session_id: id, st });
  }

  async function batch(raw = {}) {
    const { st, session_id: sessionId, seq_from: seqFrom, seq_to: seqTo, events = [], results = [] } = snake(raw);
    const p = verifySt(st);
    if (!p) return no(401, 'bad_token');
    if (sessionId !== p.sid) return no(403, 'not_this_session');
    if (!Array.isArray(events) || !Array.isArray(results)) return no(400, 'bad_batch');
    if (events.length > MAX_EVENTS || results.length > MAX_RESULTS) return no(413, 'too_large');
    const clean = events.map(cleanEvent);
    if (clean.includes(null)) return no(400, 'bad_event');
    if (results.some((r) => !r || typeof r !== 'object' || Array.isArray(r) || typeof r.task_id !== 'string' || !TASK_RX.test(r.task_id))) return no(400, 'bad_task');
    if (clean.length) {
      if (!isInt(seqFrom) || !isInt(seqTo) || seqFrom > seqTo || clean.some((e) => e.seq < seqFrom || e.seq > seqTo)) return no(400, 'bad_seq');
    }
    const out = await store().saveBatch({ mode: modeOf(p), sessionId: p.sid, events: clean, results });
    if (!out || !out.ok) return out && out.reason === 'not_found' ? no(404, 'no_session') : no(503, 'unavailable');
    const acked = clean.length ? seqTo : (isInt(seqTo) ? seqTo : (isInt(out.lastSeq) ? out.lastSeq : 0));
    return ok({ ok: true, acked_to: acked, ackedTo: acked });
  }

  function audioArgs(a) {
    const p = verifySt(a.st);
    if (!p) return { err: no(401, 'bad_token') };
    if (typeof a.task_id !== 'string' || !TASK_RX.test(a.task_id)) return { err: no(400, 'bad_task') };
    if (a.item_id != null && a.item_id !== '' && (typeof a.item_id !== 'string' || !ITEM_RX.test(a.item_id) || a.item_id.includes('..'))) return { err: no(400, 'bad_item') };
    return { p, itemId: a.item_id || null };
  }

  async function presign(raw = {}) {
    const a = snake(raw);
    const { p, itemId, err } = audioArgs(a);
    if (err) return err;
    const type = String(a.mime || '').split(';')[0].trim().toLowerCase();
    const ext = MIMES[type];
    if (!ext) return no(400, 'bad_mime');
    const bytes = Number(a.bytes);
    if (!Number.isInteger(bytes) || bytes <= 0) return no(400, 'bad_size');
    if (bytes > MAX_AUDIO) return no(413, 'too_large');
    // not kept in game mode (RULING ⚠️10 c): the engine drops the blob and marks the result audio:'not_kept'
    if (!(await d.keepAudio(a))) return ok({ skip: true, reason: 'audio_off' });
    const key = keyOf(p.sid, a.task_id, itemId, ext);
    const url = await r2().getPresignedUploadUrl(key, type, PRESIGN_TTL_S);
    if (!url) return no(503, 'unavailable');
    return ok({ url, key });
  }

  async function register(raw = {}) {
    const a = snake(raw);
    const { p, itemId, err } = audioArgs(a);
    if (err) return err;
    const key = typeof a.key === 'string' ? a.key : '';
    // only a key this run's presign would mint: its prefix, its task (and item), one of the four extensions
    if (!key.startsWith(prefixOf(p.sid)) || !Object.values(MIMES).some((ext) => keyOf(p.sid, a.task_id, itemId, ext) === key)) return no(403, 'not_your_upload');
    const bytes = Number(a.bytes);
    if (Number.isFinite(bytes) && bytes > MAX_AUDIO) return no(413, 'too_large');
    const head = await r2().headObject(key);
    if (!head || !head.exists) return no(409, 'upload_missing');
    const dur = Number(a.duration_ms);
    const out = await store().registerAudio({
      mode: modeOf(p), sessionId: p.sid, taskId: a.task_id, itemId, key,
      bytes: Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes) : null,
      durationMs: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null,
    });
    if (!out || !out.ok) return out && out.reason === 'not_found' ? no(404, 'no_session') : no(503, 'unavailable');
    return ok({ ok: true });
  }

  async function status({ st } = {}) {
    const p = verifySt(st);
    if (!p) return no(401, 'bad_token');
    const out = await store().readRun({ mode: modeOf(p), sessionId: p.sid });
    if (!out || !out.ok) return out && out.reason === 'not_found' ? no(404, 'no_session') : no(503, 'unavailable');
    return ok({ status: out.status, tasks_done: out.tasksDone || [], last_seq: out.lastSeq == null ? null : out.lastSeq });
  }

  return { session, batch, presign, register, status };
}

module.exports = { ...createSink(), createSink, idFor, pktDay, prefixOf, PARTS, FORMS, TASK_RX, MAX_EVENTS, MAX_RESULTS, MAX_AUDIO };
