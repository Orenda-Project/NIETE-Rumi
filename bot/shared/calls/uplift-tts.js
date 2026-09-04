'use strict';
/**
 * Uplift AI streaming TTS over Socket.IO — the assistant's "mouth" on the
 * `uplift` voice path (bd-oxu2q, ported from Danish's bd-neeyat work).
 *
 * WHAT THIS DOES AND DOES NOT CHANGE. OpenAI realtime still does STT, reasoning
 * and every tool call; on this path it emits TEXT instead of audio, and that
 * text is streamed here sentence by sentence. So the assistant's CAPABILITIES
 * are identical on both voice paths by construction — the tool layer is not
 * touched. Only the mouth changes. Urdu comes out markedly more natural than the
 * realtime voice, which is the whole reason for the swap.
 *
 * Used ONLY when VOICE_PROVIDER=uplift AND connect succeeds; otherwise the call
 * falls back to the OpenAI voice for that call and nothing else changes. That
 * fallback is per-call, not per-deploy.
 *
 * Protocol (https://docs.upliftai.org/websocket-tts, verified 2026-09-04):
 *   connect  → server emits `message {type:'ready', sessionId}`
 *   emit 'synthesize' {type, requestId, text, voiceId, outputFormat}
 *   emit 'cancel'     {type, requestId}
 *   server   → `message {type:'audio_start'|'audio'|'audio_end'|'error', requestId, …}`
 * Documented limits: 60 synthesis requests/min per connection, 10,000 chars per
 * request, ~300 ms to first audio chunk.
 *
 * The socket.io client is lazy-required so unit tests (and the message bot) never
 * pull it in, matching how rtc-peer/realtime-client defer their native deps.
 */

const UPLIFT_RATE = 22050;
const DEFAULT_WS_URL = 'wss://api.upliftai.org/text-to-speech/multi-stream';
// The conversational Urdu voice calls speak with. calls-config resolves the real
// value from UPLIFT_VOICE_ID; this is only the floor for a directly-constructed
// session. NOT v_8eelc901 — that is the retired Urdu voice-note voice (bd-2375).
const DEFAULT_VOICE_ID = 'v_meklc281';
const CONNECT_TIMEOUT_MS = 5000;
// How long a synthesis request may produce NO audio before we call it failed.
// Documented first-chunk latency is ~300ms, so this is generous by an order of
// magnitude — it is a liveness check, not a latency budget.
const FIRST_AUDIO_TIMEOUT_MS = 4000;
const MAX_TEXT_CHARS = 10000; // documented hard limit; over it the request errors

class UpliftTtsSession {
  /**
   * @param {object}   opts
   * @param {string}   opts.apiKey
   * @param {string}   [opts.voiceId]
   * @param {string}   [opts.wsUrl]
   * @param {object}   opts.callbacks  { onPcm(Int16Array@22050), onError }
   * @param {Function} [opts.ioFactory] (url, opts) => socket — injectable for tests
   */
  constructor({
    apiKey, voiceId, wsUrl, callbacks = {}, ioFactory,
    firstAudioTimeoutMs = FIRST_AUDIO_TIMEOUT_MS,
  } = {}) {
    this.apiKey = apiKey;
    this.firstAudioTimeoutMs = firstAudioTimeoutMs;
    this.voiceId = voiceId || DEFAULT_VOICE_ID;
    this.wsUrl = wsUrl || DEFAULT_WS_URL;
    this.cb = callbacks;
    this.ioFactory = ioFactory || ((url, o) => {
      // eslint-disable-next-line global-require
      const { io } = require('socket.io-client');
      return io(url, o);
    });

    this._socket = null;
    this._ready = false;
    this._seq = 0;
    this._generation = 0;          // bumped on cancel() so late chunks are ignored
    this._active = new Set();      // requestIds whose audio we still want
    // In-order playback: audio for sentence N is held until N-1 finishes, so
    // pipelined (concurrent) synth requests never interleave/overlap.
    this._order = [];              // requestIds in send order
    this._head = 0;                // index in _order currently playing
    this._buffed = new Map();      // chunks buffered for not-yet-head reqs
    this._ended = new Set();       // requestIds that received audio_end
    this._watchdogs = new Map();   // requestId → timer awaiting its first audio
  }

  /**
   * Fail a request that produced no audio at all.
   *
   * PROBED AGAINST THE LIVE API 2026-09-04: an unknown voiceId does NOT come back
   * as {type:'error'}. The server accepts `synthesize` and simply never sends
   * audio — `ready=yes, 0 bytes, no error`. So the protocol-error branch does not
   * cover the single most likely misconfiguration, and without this a wrong
   * UPLIFT_VOICE_ID is a completely silent assistant with a clean log: the caller
   * hears a dead line, and every signal we have says the call is fine.
   */
  _armFirstAudioWatchdog(requestId) {
    const t = setTimeout(() => {
      this._watchdogs.delete(requestId);
      if (this._ended.has(requestId) || !this._active.has(requestId)) return;
      // Advance playout — the sentences behind this one must not wait forever.
      this._ended.add(requestId);
      this._active.delete(requestId);
      this._drain();
      if (this.cb.onError) {
        const err = new Error(
          `uplift produced no audio for ${this.firstAudioTimeoutMs}ms `
          + `(voiceId ${this.voiceId} — check it is a real voice)`,
        );
        err.code = 'no_audio';
        err.requestId = requestId;
        this.cb.onError(err);
      }
    }, this.firstAudioTimeoutMs);
    if (t.unref) t.unref();
    this._watchdogs.set(requestId, t);
  }

  _clearWatchdog(requestId) {
    const t = this._watchdogs.get(requestId);
    if (t) { clearTimeout(t); this._watchdogs.delete(requestId); }
  }

  get ready() {
    return this._ready;
  }

  /**
   * Connect and resolve once ready. RESOLVES (never rejects) so the caller can
   * check `ready` and fall back to the OpenAI voice on failure — a TTS problem
   * must never fail the call setup.
   */
  connect() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try {
        const socket = this.ioFactory(this.wsUrl, {
          auth: { token: this.apiKey },
          transports: ['websocket'],
        });
        this._socket = socket;
        socket.on('message', (m) => this._onMessage(m, finish));
        socket.on('connect_error', (e) => { if (this.cb.onError) this.cb.onError(e); finish(); });
        socket.on('error', (e) => { if (this.cb.onError) this.cb.onError(e); });
      } catch (err) {
        if (this.cb.onError) this.cb.onError(err);
        finish();
      }
      // Never hang call setup waiting on TTS.
      const t = setTimeout(finish, CONNECT_TIMEOUT_MS);
      if (t.unref) t.unref();
    });
  }

  _onMessage(m, finish) {
    if (!m) return;
    if (m.type === 'ready') {
      this._ready = true;
      if (finish) finish();
      return;
    }

    // A protocol-level error is NOT the same as a socket error, and it is the
    // one that actually happens in service: a rejected voiceId, a text over the
    // 10k limit, a rate-limit trip. Without this branch the sentence simply
    // never arrives and the caller hears silence — a failure that looks like a
    // dead line rather than like a TTS error, and would be diagnosed as such.
    if (m.type === 'error') {
      const err = new Error(`uplift ${m.code || 'error'}: ${m.message || 'unknown'}`);
      err.code = m.code;
      err.requestId = m.requestId;
      // Stop waiting on a request that will never produce audio, or in-order
      // playout would stall behind it for the rest of the call.
      if (m.requestId) {
        this._clearWatchdog(m.requestId);
        this._ended.add(m.requestId);
        this._active.delete(m.requestId);
        this._drain();
      }
      if (this.cb.onError) this.cb.onError(err);
      return;
    }

    if (m.type === 'audio' && m.audio && m.requestId && this._active.has(m.requestId)) {
      this._clearWatchdog(m.requestId);
      const buf = Buffer.from(m.audio, 'base64');
      if (buf.length < 2) return;
      const pcm = new Int16Array(buf.length >> 1);
      for (let i = 0; i < pcm.length; i += 1) pcm[i] = buf.readInt16LE(i * 2);
      if (this._order[this._head] === m.requestId) {
        if (this.cb.onPcm) this.cb.onPcm(pcm); // this sentence is the one playing
      } else {
        // A later sentence finished early — hold its audio in order.
        const arr = this._buffed.get(m.requestId) || [];
        arr.push(pcm);
        this._buffed.set(m.requestId, arr);
      }
    } else if (m.type === 'audio_end' && m.requestId) {
      this._clearWatchdog(m.requestId);
      this._ended.add(m.requestId);
      this._drain();
    }
  }

  /** Queue a piece of text to speak. Audio arrives via onPcm, in send order. */
  speak(text) {
    if (!this._ready || !this._socket || !text || !text.trim()) return;
    const clipped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
    const requestId = `g${this._generation}_${this._seq}`;
    this._seq += 1;
    this._active.add(requestId);
    this._order.push(requestId);
    this._socket.emit('synthesize', {
      type: 'synthesize',
      requestId,
      text: clipped,
      voiceId: this.voiceId,
      outputFormat: 'PCM_22050_16',
    });
    this._armFirstAudioWatchdog(requestId);
  }

  /** Advance playback in send order, flushing buffered audio for the new head. */
  _drain() {
    while (this._head < this._order.length) {
      const id = this._order[this._head];
      const buffered = this._buffed.get(id);
      if (buffered) {
        if (this.cb.onPcm) for (const c of buffered) this.cb.onPcm(c);
        this._buffed.delete(id);
      }
      if (this._ended.has(id)) {
        this._head += 1; // this sentence is done — move to the next
        // eslint-disable-next-line no-continue
        continue;
      }
      break; // head not finished yet — wait for more of its audio
    }
  }

  /**
   * Barge-in: drop all in-flight and buffered audio.
   *
   * Dropping it locally is not enough — the server keeps synthesising every
   * outstanding sentence, and we keep paying for audio nobody will ever hear.
   * A teacher who interrupts mid-answer is the COMMON case on a coaching call,
   * so we tell the server to stop as well. New requests use a new generation, so
   * any chunk that races the cancel is ignored by requestId anyway.
   */
  cancel() {
    for (const id of this._watchdogs.keys()) this._clearWatchdog(id);
    if (this._socket) {
      for (const requestId of this._active) {
        if (this._ended.has(requestId)) continue;
        try {
          this._socket.emit('cancel', { type: 'cancel', requestId });
        } catch (_) { /* a dead socket cancels itself */ }
      }
    }
    this._generation += 1;
    this._active.clear();
    this._order = [];
    this._head = 0;
    this._buffed.clear();
    this._ended.clear();
  }

  close() {
    for (const id of [...this._watchdogs.keys()]) this._clearWatchdog(id);
    try { if (this._socket) this._socket.close(); } catch (_) { /* noop */ }
    this._socket = null;
    this._ready = false;
  }
}

module.exports = {
  UpliftTtsSession, UPLIFT_RATE, DEFAULT_VOICE_ID, MAX_TEXT_CHARS, FIRST_AUDIO_TIMEOUT_MS,
};
