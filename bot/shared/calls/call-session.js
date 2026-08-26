'use strict';
/**
 * One live call: the WhatsApp peer on one side, the Realtime model on the other
 * (bd-1hae7.1, .16).
 *
 * Audio path
 *   caller --(Opus/SRTP)--> rtc-peer --(PCM16 @24k)--> Realtime
 *   Realtime --(PCM16 @24k)--> rtc-peer --(48k, jitter-buffered)--> caller
 *
 * Both sides are injected, so this whole orchestration — including the clocks —
 * is unit-tested without a native module or a socket.
 *
 * Two clocks run on every call:
 *  - **The cap** (bd-1hae7.16): a warm wrap-up instruction at 4:30 and a hard
 *    terminate at 5:00. The wrap-up is a nudge to the model, not a cut — being
 *    hung up on mid-sentence is a worse experience than a short goodbye.
 *  - **The silence watchdog**: WhatsApp relays audio continuously and ICE stays
 *    connected after a caller drops, so neither can detect a hangup. Mutual
 *    silence is the reliable signal. A caller who is merely LISTENING is not
 *    silence — the assistant's own speech resets the clock — so a live call is
 *    never cut.
 */

const DEFAULTS = {
  maxSeconds: 300,          // 5 minutes, hard
  wrapUpSeconds: 270,       // 4:30, warm
  silenceTimeoutMs: 60000,  // 60s of MUTUAL silence → caller is gone
  watchdogTickMs: 5000,
};

// Deliberately English-framed like the rest of the prompt stack: the model
// follows it in whatever language the call is running in.
const WRAP_UP_INSTRUCTION = `
# Time check — WRAP UP NOW
This call is nearly at its limit. Finish your current thought, then warmly close:
tell her the time for today's call is up, that she can message you on WhatsApp
any time and you will keep helping there. Do not start a new topic. Keep it to a
sentence or two.`;

const FALLBACK_INSTRUCTIONS = 'You are Neeyat Assistant, a warm, friendly, cheerful '
  + 'female AI assistant for NIETE teachers. Speak Urdu unless the caller speaks English. '
  + 'Be brief, warm and helpful.';

class CallSession {
  constructor({
    callId, from, callerName,
    createPeer, createRealtime, buildInstructions,
    callsApi, hooks = {}, logger, config = {},
  }) {
    this.callId = callId;
    this.from = from;
    this.callerName = callerName;
    this.ctx = { callId, from, callerName };

    this._createPeer = createPeer;
    this._createRealtime = createRealtime;
    this._buildInstructions = buildInstructions;
    this._callsApi = callsApi;
    this._hooks = hooks;
    this.log = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this.config = { ...DEFAULTS, ...config };

    this.startedAt = new Date();
    this.onClose = null;

    this._peer = null;
    this._realtime = null;
    this._transcript = [];
    this._closed = false;
    this._lastActivityAt = Date.now();
    this._watchdog = null;
    this._wrapUpTimer = null;
    this._capTimer = null;
  }

  /** Ordered transcript of the call, both roles, each line timestamped. */
  getTranscript() {
    return this._transcript;
  }

  /** The exact instructions the model ran with — persisted as context_snapshot. */
  getContextSnapshot() {
    return this._realtime && this._realtime.getInstructions ? this._realtime.getInstructions() : null;
  }

  /**
   * Build the SDP answer, open the model session, and start the clocks.
   * @param {string} offerSdp
   * @returns {Promise<string>} our SDP answer
   */
  async createAnswer(offerSdp) {
    this._peer = this._createPeer({ callId: this.callId });

    // Context is best-effort: a DB blip must degrade the call to a generic
    // assistant, never fail it.
    let instructions = FALLBACK_INSTRUCTIONS;
    try {
      instructions = await this._buildInstructions(this.ctx) || FALLBACK_INSTRUCTIONS;
    } catch (err) {
      this.log.warn('[calls] context build failed — generic prompt for this call', {
        callId: this.callId, error: err.message,
      });
    }

    this._realtime = this._createRealtime({
      instructions,
      callbacks: {
        onAudio: (pcm24k) => {
          if (this._closed) return;
          this._lastActivityAt = Date.now(); // she is speaking = activity
          this._peer.setTyping(false); // she is answering — stop the typing sfx
          this._peer.playAssistantAudio(pcm24k);
        },
        onToolStart: () => {
          if (this._closed) return;
          this._peer.setTyping(true); // she is looking something up
        },
        onBargeIn: () => {
          if (this._closed) return;
          this._peer.flushPlayout();
          this._peer.setTyping(false);
        },
        onTranscript: (role, text) => this._onTranscript(role, text),
        onResponseLatency: (ms) => {
          if (this._hooks.onLatency) {
            this._hooks.onLatency({ waCallId: this.callId, from: this.from, latencyMs: ms });
          }
        },
        onClose: () => this.close(),
        onError: (err) => this.log.warn('[calls] realtime error', {
          callId: this.callId, error: String(err).slice(0, 200),
        }),
      },
    });

    this._peer.onCallerAudio((pcm24k) => {
      if (this._closed || !this._realtime) return;
      this._realtime.appendAudio(pcm24k);
    });

    this._peer.onStateChange((state) => {
      if (state === 'failed' || state === 'closed') this.close();
    });

    this._realtime.connect();

    const sdpAnswer = await this._peer.createAnswer(offerSdp);

    this._lastActivityAt = Date.now();
    this._startWatchdog();
    this._startCapTimers();
    return sdpAnswer;
  }

  close() {
    if (this._closed) return;
    this._closed = true;

    if (this._watchdog) clearInterval(this._watchdog);
    if (this._wrapUpTimer) clearTimeout(this._wrapUpTimer);
    if (this._capTimer) clearTimeout(this._capTimer);
    this._watchdog = null;
    this._wrapUpTimer = null;
    this._capTimer = null;

    try { if (this._realtime) this._realtime.close(); } catch (_) { /* best effort */ }
    try { if (this._peer) this._peer.close(); } catch (_) { /* best effort */ }

    try { if (this.onClose) this.onClose(); } catch (_) { /* best effort */ }
  }

  // ---------------------------------------------------------------- internals

  _onTranscript(role, text) {
    const clean = (text || '').trim();
    if (!clean) return;
    const line = { role, text: clean, at: new Date().toISOString() };
    this._transcript.push(line);
    if (role === 'caller') this._lastActivityAt = Date.now();
    if (this._hooks.onTranscriptLine) {
      try {
        this._hooks.onTranscriptLine({ waCallId: this.callId, from: this.from, ...line });
      } catch (_) { /* persistence must never break the call */ }
    }
  }

  _startCapTimers() {
    const { wrapUpSeconds, maxSeconds } = this.config;

    if (wrapUpSeconds > 0 && wrapUpSeconds < maxSeconds) {
      this._wrapUpTimer = setTimeout(() => {
        if (this._closed || !this._realtime) return;
        this.log.info('[calls] wrap-up mark reached', { callId: this.callId, at: wrapUpSeconds });
        try { this._realtime.appendInstructions(WRAP_UP_INSTRUCTION); } catch (_) { /* noop */ }
      }, wrapUpSeconds * 1000);
    }

    this._capTimer = setTimeout(() => {
      if (this._closed) return;
      this.log.warn('[calls] max duration reached — ending', { callId: this.callId, maxSeconds });
      this._endCall();
    }, maxSeconds * 1000);
  }

  _startWatchdog() {
    this._watchdog = setInterval(() => {
      if (this._closed) return;
      const silenceMs = Date.now() - this._lastActivityAt;
      if (silenceMs >= this.config.silenceTimeoutMs) {
        this.log.warn('[calls] mutual silence — caller appears gone, ending', {
          callId: this.callId, silenceSeconds: Math.round(silenceMs / 1000),
        });
        this._endCall();
      }
    }, this.config.watchdogTickMs);
  }

  /** Hang up from our side, then tear down. */
  _endCall() {
    if (this._callsApi && this._callsApi.terminate) {
      Promise.resolve(this._callsApi.terminate(this.callId)).catch(() => undefined);
    }
    this.close();
  }
}

module.exports = CallSession;
module.exports.WRAP_UP_INSTRUCTION = WRAP_UP_INSTRUCTION;
