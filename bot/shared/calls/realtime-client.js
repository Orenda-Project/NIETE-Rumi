'use strict';
/**
 * OpenAI GA Realtime client over WebSocket (bd-1hae7.1).
 *
 * A server connects with the raw API key to `wss://api.openai.com/v1/realtime`
 * and exchanges base64 PCM16 @ 24 kHz. Two contracts worth stating loudly:
 *
 *  - **No `OpenAI-Beta` header.** Sending `realtime=v1` forces the retired beta
 *    shape and every session dies with `beta_api_shape_disabled`.
 *  - **Both event-name generations are handled** (`response.output_audio.delta`
 *    and the older `response.audio.delta`, and the transcript pair likewise). A
 *    rename on their side must never silently mute the assistant.
 *
 * The socket class is injected (`wsFactory`) so the whole protocol is unit-
 * testable without a network.
 */

const pcm = require('./pcm');

const TRANSCRIBE_MODEL = process.env.CALLS_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const TOOL_ERROR_TEXT = 'That lookup did not work just now.';

class RealtimeClient {
  /**
   * @param {object}   opts
   * @param {string}   opts.instructions  Composed system prompt.
   * @param {string}   opts.apiKey
   * @param {string}   opts.model
   * @param {string}   opts.voice
   * @param {Array}    [opts.tools]       Function-tool definitions.
   * @param {string}   [opts.vad]         'semantic_vad' (default) | 'server_vad'
   * @param {object}   opts.callbacks     onAudio, onTranscript, onBargeIn,
   *                                      onResponseLatency, onToolCall, onOpen,
   *                                      onClose, onError
   * @param {Function} [opts.wsFactory]   (url, opts) => WebSocket — injectable.
   */
  constructor({
    instructions, apiKey, model, voice, tools, vad, callbacks = {}, wsFactory,
  }) {
    this.instructions = instructions || '';
    this.apiKey = apiKey;
    this.model = model;
    this.voice = voice;
    this.tools = tools;
    this.vad = vad || 'semantic_vad';
    this.cb = callbacks;
    // Lazy-require `ws` so unit tests never load it and the module stays cheap.
    this.wsFactory = wsFactory || ((url, opts) => {
      // eslint-disable-next-line global-require
      const WebSocket = require('ws');
      return new WebSocket(url, opts);
    });

    this._ws = null;
    this._ready = false;
    this._closed = false;
    this._toolNames = new Map();   // call_id → tool name (name and args arrive on different events)
    this._speechStoppedAt = null;  // turn-end clock, cleared once we log the turn's latency
  }

  /** The exact instructions the model is running with — the P3.1 context snapshot. */
  getInstructions() {
    return this.instructions;
  }

  connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;
    const ws = this.wsFactory(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    this._ws = ws;

    ws.on('open', () => this._configureSession());
    ws.on('message', (raw) => this._onMessage(raw));
    ws.on('close', () => {
      this._ready = false;
      if (this.cb.onClose) this.cb.onClose();
    });
    ws.on('error', (err) => { if (this.cb.onError) this.cb.onError(err); });
  }

  /**
   * Fold extra context into a live session — used ONCE, early, for anything that
   * was still loading at connect. Before the session is configured it merges
   * into the initial update; after, it pushes a session.update. Either way it
   * lands and never blocks the call.
   */
  appendInstructions(extra) {
    if (!extra || !String(extra).trim()) return;
    this.instructions = `${this.instructions}\n\n${extra}`;
    if (this._ready) {
      this._send({ type: 'session.update', session: { type: 'realtime', instructions: this.instructions } });
    }
  }

  /** Push 24 kHz PCM16 caller audio to the model. */
  appendAudio(pcm24k) {
    if (!this._ready || this._closed) return;
    this._send({ type: 'input_audio_buffer.append', audio: pcm.int16ToBase64(pcm24k) });
  }

  close() {
    this._closed = true;
    this._ready = false;
    try {
      if (this._ws) this._ws.close();
    } catch (_) { /* already gone */ }
    this._ws = null;
  }

  // ---------------------------------------------------------------- internals

  _configureSession() {
    // semantic_vad is model-based end-of-turn detection — on a noisy classroom
    // line raw server_vad at a low silence threshold produces overlapping,
    // "cluttered" replies. server_vad stays available for tuning.
    const turnDetection = this.vad === 'server_vad'
      ? {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: Number(process.env.CALLS_VAD_SILENCE_MS || 5),
        create_response: true,
        interrupt_response: true,
      }
      : {
        type: 'semantic_vad',
        eagerness: process.env.CALLS_VAD_EAGERNESS || 'auto',
        create_response: true,
        interrupt_response: true,
      };

    const session = {
      type: 'realtime',
      instructions: this.instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: pcm.OPENAI_RATE },
          turn_detection: turnDetection,
          // Transcribe the caller so both sides land in the call transcript
          // (the assistant's own words come back with her audio).
          transcription: { model: TRANSCRIBE_MODEL },
        },
        output: {
          format: { type: 'audio/pcm', rate: pcm.OPENAI_RATE },
          voice: this.voice,
        },
      },
    };

    if (this.tools && this.tools.length) {
      session.tools = this.tools;
      session.tool_choice = 'auto';
    }

    // Low reasoning effort keeps her replies snappy on a live call (matches the
    // Noor tuning). Override with CALLS_REASONING_EFFORT; 'none' leaves it unset.
    const effort = process.env.CALLS_REASONING_EFFORT || 'minimal';
    if (effort && effort !== 'none') session.reasoning = { effort };

    this._send({ type: 'session.update', session });
    this._ready = true;
    if (this.cb.onOpen) this.cb.onOpen();

    // Greet first so the caller hears her immediately after connect.
    this._send({ type: 'response.create' });
  }

  _onMessage(raw) {
    let evt;
    try {
      evt = JSON.parse(String(raw));
    } catch (_) {
      return; // a malformed frame must never crash a live call
    }

    switch (evt.type) {
      case 'session.created':
        break;

      // --- transcripts (both roles, both event-name generations) ---
      case 'conversation.item.input_audio_transcription.completed':
        if (evt.transcript && this.cb.onTranscript) this.cb.onTranscript('caller', evt.transcript);
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (evt.transcript && this.cb.onTranscript) this.cb.onTranscript('assistant', evt.transcript);
        break;

      // --- turn boundaries ---
      case 'input_audio_buffer.speech_started':
        if (this.cb.onBargeIn) this.cb.onBargeIn();
        break;
      case 'input_audio_buffer.speech_stopped':
        this._speechStoppedAt = Date.now();
        break;

      // --- audio out ---
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (this._speechStoppedAt != null) {
          const ms = Date.now() - this._speechStoppedAt;
          this._speechStoppedAt = null; // once per turn
          if (this.cb.onResponseLatency) this.cb.onResponseLatency(ms);
        }
        if (evt.delta && this.cb.onAudio) this.cb.onAudio(pcm.base64ToInt16(evt.delta));
        break;

      // --- function calling: name arrives with the item, args arrive later ---
      case 'response.output_item.added':
        if (evt.item && evt.item.type === 'function_call' && evt.item.call_id) {
          this._toolNames.set(evt.item.call_id, evt.item.name || '');
          // She is about to look something up — cue the typing ambience until
          // her answer audio starts.
          if (this.cb.onToolStart) this.cb.onToolStart();
        }
        break;
      case 'response.function_call_arguments.done':
        return this._handleFunctionCall(evt.call_id || '', evt.name, evt.arguments || '{}');

      case 'error':
        if (this.cb.onError) this.cb.onError(String(raw));
        break;
      default:
        break;
    }
    return undefined;
  }

  async _handleFunctionCall(callId, name, argsJson) {
    const fnName = name || this._toolNames.get(callId) || '';
    this._toolNames.delete(callId);

    let args = {};
    try {
      args = JSON.parse(argsJson || '{}');
    } catch (_) { /* a malformed arg blob still gets the tool a chance */ }

    let output = '';
    try {
      output = (this.cb.onToolCall ? await this.cb.onToolCall(fnName, args) : '') || '';
    } catch (err) {
      if (this.cb.onError) this.cb.onError(err);
      output = TOOL_ERROR_TEXT; // a failing tool must never tear down a live call
    }
    if (!callId) return;

    this._send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    this._send({ type: 'response.create' });
  }

  _send(obj) {
    if (!this._ws || this._closed) return;
    // readyState 1 === OPEN in every ws implementation; compared numerically so
    // an injected fake needs no constants.
    if (this._ws.readyState !== undefined && this._ws.readyState !== 1) return;
    this._ws.send(JSON.stringify(obj));
  }
}

module.exports = RealtimeClient;
