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

const { StreamResampler, WHATSAPP_RATE } = require('./pcm');
const { UPLIFT_RATE } = require('./uplift-tts');

const DEFAULTS = {
  maxSeconds: 300,          // 5 minutes, hard
  wrapUpSeconds: 270,       // 4:30, warm
  silenceTimeoutMs: 60000,  // 60s of MUTUAL silence → caller is gone
  watchdogTickMs: 5000,
  // Which call languages the external TTS may speak (bd-oxu2q). Uplift models
  // Urdu/Sindhi/Balochi; handing it an English reply produces an Urdu-accented
  // mangling of English. Language is data, not code — so this is a list, not an
  // `if`, and a deployment can widen it without a code change.
  upliftLanguages: ['ur'],
};

/**
 * Split streamed text into speakable sentences, keeping the unfinished tail.
 *
 * Urdu sentence enders (۔ ؟) count alongside the Latin ones — without them an
 * entire Urdu reply is one "sentence" and nothing is spoken until the model
 * finishes, which throws away the whole point of streaming.
 */
function splitSentences(buf) {
  const sentences = [];
  const re = /[^.!?۔؟\n]*[.!?۔؟\n]+/g;
  let m;
  let lastIdx = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(buf)) !== null) {
    sentences.push(m[0].trim());
    lastIdx = re.lastIndex;
  }
  let rest = buf.slice(lastIdx);
  if (rest.length > 180) { // no punctuation for a long time — flush what we have
    sentences.push(rest.trim());
    rest = '';
  }
  return { sentences: sentences.filter(Boolean), rest };
}

/**
 * Added to the prompt ONLY on the external-TTS path, and only for a call already
 * running in Urdu.
 *
 * It tells the model that its written words ARE the audio, so it must write the
 * script the voice can pronounce. Note what it deliberately does NOT do: it does
 * not decide the call's language. The upstream version ordered an Urdu reply
 * "even if the caller speaks English", which would override a teacher's own
 * `preferred_language` — language is a fact about the teacher, not about which
 * voice engine we happen to be running (language-protocol §2). We instead keep
 * Uplift off non-Urdu calls entirely, so this directive only ever reinforces the
 * language the call was already in.
 */
const UPLIFT_URDU_OUTPUT_DIRECTIVE = `
# HOW YOUR REPLY IS SPOKEN — READ CAREFULLY
You are NOT speaking directly on this call. Your written reply is passed, word for
word, to an Urdu text-to-speech voice that reads it aloud. Therefore:
- Write every reply in natural Urdu script (اردو). Never Roman/Latin Urdu — the
  voice cannot pronounce it.
- If an English term is unavoidable (a proper noun, an app name), write it in Urdu
  script so it is pronounced correctly.
- Plain spoken sentences only — NO emoji, asterisks, markdown, bullet points,
  headings, or stage directions; they would be read out loud. Ordinary punctuation
  is good, it shapes the speech. Write numbers out in Urdu words where it reads
  naturally.`;

// Deliberately English-framed like the rest of the prompt stack: the model
// follows it in whatever language the call is running in.
const WRAP_UP_INSTRUCTION = `
# Time check — WRAP UP NOW
This call is nearly at its limit. Finish your current thought, then warmly close:
tell her the time for today's call is up, that she can message you on WhatsApp
any time and you will keep helping there. Do not start a new topic. Keep it to a
sentence or two.`;

const FALLBACK_INSTRUCTIONS = 'You are Neeyat (نیت) — say your name as the Urdu word نیت '
  + '("nee-yat"), which is also how NIETE is pronounced. You are a warm, friendly female AI '
  + 'assistant for NIETE teachers. Speak Urdu unless the caller speaks English. Be brief, warm '
  + 'and genuine — never perform cheerfulness.';

class CallSession {
  constructor({
    callId, from, callerName,
    createPeer, createRealtime, createTts, buildInstructions,
    callsApi, hooks = {}, logger, config = {},
  }) {
    this.callId = callId;
    this.from = from;
    this.callerName = callerName;
    this.ctx = { callId, from, callerName };

    this._createPeer = createPeer;
    this._createRealtime = createRealtime;
    this._createTts = createTts || null;
    this._buildInstructions = buildInstructions;
    this._callsApi = callsApi;
    this._hooks = hooks;
    this.log = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this.config = { ...DEFAULTS, ...config };

    this.startedAt = new Date();
    this.onClose = null;

    this._peer = null;
    this._realtime = null;
    // External-TTS voice path (bd-oxu2q); all null on the OpenAI voice path.
    this._tts = null;
    this._ttsResampler = null;   // stateful 22.05k → 48k, so chunk seams do not click
    this._textBuf = '';          // text deltas accumulating until a sentence is ready
    this._responseText = '';     // the whole reply, for the transcript
    this._speechStoppedAt = 0;   // latency clock; on this path first audio is Uplift's
    this._voiceUsed = null;      // set once the engine is settled; null = OpenAI voice
    this._transcript = [];
    this._closed = false;
    this._lastActivityAt = Date.now();
    this._watchdog = null;
    this._wrapUpTimer = null;
    this._capTimer = null;
  }

  /**
   * Which voice engine actually spoke, or null for the OpenAI voice.
   *
   * Null rather than the OpenAI voice NAME on purpose: this class does not own
   * that name (it lives in calls-config), and inventing it here would be a second
   * source of truth for the same fact. The caller substitutes config.voice.
   */
  getVoiceUsed() {
    return this._voiceUsed;
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

    // Start the TTS connect NOW so it overlaps the context build — voice setup
    // must never add to how long the caller waits for an answer. connect()
    // resolves rather than rejects, so a dead TTS costs us nothing here.
    let ttsConnect = null;
    if (this._createTts) {
      this._tts = this._createTts({
        callbacks: {
          onPcm: (pcm22k) => this._onTtsPcm(pcm22k),
          onError: (e) => this.log.warn('[calls] uplift error', {
            callId: this.callId, error: String(e && e.message ? e.message : e).slice(0, 160),
          }),
        },
      });
      if (this._tts) ttsConnect = this._tts.connect();
    }

    // Context is best-effort: a DB blip must degrade the call to a generic
    // assistant, never fail it.
    let instructions = FALLBACK_INSTRUCTIONS;
    let language = null;
    try {
      const built = await this._buildInstructions(this.ctx);
      // Accepts a bare string (the original contract) or {instructions, language}.
      // Without a language we cannot tell whether the external voice is the right
      // one for this caller, and we would rather use the known-good voice than
      // guess — so a string means the OpenAI voice.
      if (built && typeof built === 'object') {
        instructions = built.instructions || FALLBACK_INSTRUCTIONS;
        language = built.language || null;
      } else if (built) {
        instructions = built;
      }
    } catch (err) {
      this.log.warn('[calls] context build failed — generic prompt for this call', {
        callId: this.callId, error: err.message,
      });
    }

    // Settle the voice engine now that the caller's language is known.
    const useUplift = await this._settleVoice({ ttsConnect, language });
    // Record it BEFORE anything can fail below: the audit row's whole purpose is
    // answering "what actually happened on this call".
    this._voiceUsed = useUplift ? 'uplift' : null;
    if (useUplift) {
      this._ttsResampler = new StreamResampler(UPLIFT_RATE, WHATSAPP_RATE);
      instructions = `${instructions}\n\n${UPLIFT_URDU_OUTPUT_DIRECTIVE}`;
    }

    this._realtime = this._createRealtime({
      instructions,
      ...(this._createTts ? { outputMode: useUplift ? 'text' : 'audio' } : {}),
      callbacks: {
        onAudio: (pcm24k) => {
          if (this._closed) return;
          this._lastActivityAt = Date.now(); // she is speaking = activity
          this._setTyping(false); // she is answering — stop the typing sfx
          this._peer.playAssistantAudio(pcm24k);
        },
        onToolStart: () => {
          if (this._closed) return;
          this._setTyping(true); // she is looking something up
        },
        // External-TTS path: the caller stopped, so start the latency clock here
        // — on this path the first audio comes back from Uplift, not from OpenAI.
        onSpeechStopped: () => {
          if (this._closed) return;
          this._speechStoppedAt = Date.now();
        },
        // External-TTS path: stream the reply out a sentence at a time, so she
        // starts hearing the answer before the model has finished writing it.
        onTextDelta: (delta) => {
          if (this._closed || !this._tts) return;
          this._responseText += delta;
          this._textBuf += delta;
          const { sentences, rest } = splitSentences(this._textBuf);
          this._textBuf = rest;
          for (const s of sentences) this._tts.speak(s);
        },
        onTextDone: (text) => {
          if (this._closed || !this._tts) return;
          const tail = this._textBuf.trim();
          if (tail) this._tts.speak(tail);
          this._textBuf = '';
          // There is NO audio-transcript event on this path. Record her line here
          // or the call persists only the caller's half — and call_memory, three
          // hops downstream, would summarise a one-sided conversation.
          const full = (this._responseText || text || '').trim();
          this._responseText = '';
          if (full) this._onTranscript('assistant', full);
        },
        onBargeIn: () => {
          if (this._closed) return;
          this._peer.flushPlayout();
          this._setTyping(false);
          if (this._tts) {
            // Drop in-flight and buffered audio, and any half-written sentence —
            // otherwise the tail surfaces later as a stray utterance answering a
            // question she already moved on from.
            this._tts.cancel();
            if (this._ttsResampler) this._ttsResampler.reset();
            this._textBuf = '';
            this._responseText = '';
          }
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
    try { if (this._tts) this._tts.close(); } catch (_) { /* best effort */ }
    try { if (this._peer) this._peer.close(); } catch (_) { /* best effort */ }

    try { if (this.onClose) this.onClose(); } catch (_) { /* best effort */ }
  }

  // ---------------------------------------------------------------- internals

  /**
   * Ambience is an OPTIONAL capability of the peer, not part of its contract.
   * The peer is injectable (that is how this module is testable at all), so a
   * peer without `setTyping` must not throw — and this is called from `onAudio`,
   * the hottest path on the call, where a TypeError would kill her voice for the
   * rest of the conversation.
   */
  _setTyping(on) {
    try {
      if (this._peer && typeof this._peer.setTyping === 'function') this._peer.setTyping(on);
    } catch (_) { /* ambience must never break a call */ }
  }

  /**
   * Decide whether the external TTS speaks this call. Returns false — and tidies
   * the socket away — on every path that keeps the OpenAI voice.
   *
   * Two independent reasons to decline, both per-call rather than per-deploy:
   *   1. the caller's language is not one the voice model speaks
   *   2. the socket did not come up in time
   */
  async _settleVoice({ ttsConnect, language }) {
    if (!this._tts || !ttsConnect) return false;

    const allowed = this.config.upliftLanguages || DEFAULTS.upliftLanguages;
    if (!language || !allowed.includes(language)) {
      this.log.info('[calls] external voice not used for this language — OpenAI voice', {
        callId: this.callId, language: language || 'unknown',
      });
      this._dropTts();
      return false;
    }

    try { await ttsConnect; } catch (_) { /* connect never rejects, but be safe */ }
    if (!this._tts.ready) {
      this.log.warn('[calls] uplift not ready — OpenAI voice this call', { callId: this.callId });
      this._dropTts();
      return false;
    }

    this.log.info('[calls] uplift ready — voice via Uplift', { callId: this.callId, language });
    return true;
  }

  _dropTts() {
    try { if (this._tts) this._tts.close(); } catch (_) { /* best effort */ }
    this._tts = null;
  }

  /**
   * Uplift audio → the wire. Resampled statefully to 48 kHz and pushed straight
   * to the playout buffer, NOT through playAssistantAudio (which would treat it
   * as 24 kHz and resample it a second time).
   */
  _onTtsPcm(pcm22k) {
    if (this._closed) return;
    this._lastActivityAt = Date.now(); // she is speaking = activity
    this._setTyping(false);            // she is answering — stop the typing sfx
    if (this._speechStoppedAt) {
      const ms = Date.now() - this._speechStoppedAt;
      this._speechStoppedAt = 0;       // once per turn
      if (this._hooks.onLatency) {
        this._hooks.onLatency({ waCallId: this.callId, from: this.from, latencyMs: ms });
      }
    }
    if (this._ttsResampler && this._peer && this._peer.playAssistantPcm48k) {
      this._peer.playAssistantPcm48k(this._ttsResampler.process(pcm22k));
    }
  }

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
