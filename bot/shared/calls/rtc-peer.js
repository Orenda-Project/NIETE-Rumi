'use strict';
/**
 * The ONLY file in this repo that touches `@roamhq/wrtc` (bd-1hae7.1).
 *
 * Everything above it — the session state machine, the engine, the caps — talks
 * to this interface and is therefore unit-testable with a fake peer:
 *
 *    createAnswer(offerSdp) → Promise<sdpAnswer>
 *    onCallerAudio(cb)         cb(Int16Array @ 24 kHz, model-ready)
 *    onStateChange(cb)         cb('connected'|'disconnected'|'failed'|'closed')
 *    playAssistantAudio(pcm24k)
 *    flushPlayout()            barge-in
 *    close()
 *
 * Rate handling is owned here because the sink is the only thing that knows the
 * true rate: WhatsApp's SDP advertises 48 kHz but decoded frames arrive at
 * 16 kHz in practice, so we resample from `data.sampleRate` every frame rather
 * than from a constant.
 *
 * ICE: WhatsApp is `ice-lite`, so WE initiate the media path outbound and plain
 * STUN over Railway's outbound UDP is enough — no TURN server required (proven
 * on the R&D deployment). TURN_* stays wired as an optional fallback for hosts
 * that block outbound UDP; it is a no-op when unset.
 */

const pcm = require('./pcm');
const PlayoutBuffer = require('./playout-buffer');
const { ambienceReady, AmbienceMixer } = require('./ambience');

const FRAME_MS = 10;
const FRAME_SAMPLES_48K = (pcm.WHATSAPP_RATE * FRAME_MS) / 1000; // 480
const DISCONNECT_GRACE_MS = 10000;
const ICE_GATHER_TIMEOUT_MS = 2000;

/** Lazy-loaded so unit tests and the message bot never pull in the native module. */
function loadWrtc() {
  // eslint-disable-next-line global-require
  const wrtc = require('@roamhq/wrtc');
  return {
    RTCPeerConnection: wrtc.RTCPeerConnection,
    RTCAudioSource: wrtc.nonstandard.RTCAudioSource,
    RTCAudioSink: wrtc.nonstandard.RTCAudioSink,
  };
}

function iceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (turnUrls.length) {
    servers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

class RtcPeer {
  constructor({ callId, logger } = {}) {
    this.callId = callId;
    this.log = logger || { info: () => {}, warn: () => {}, error: () => {} };

    this._pc = null;
    this._source = null;
    this._sink = null;
    this._audioCb = null;
    this._stateCb = null;
    this._closed = false;
    this._playoutTimer = null;
    this._disconnectTimer = null;
    this._buffer = new PlayoutBuffer({ frameSamples: FRAME_SAMPLES_48K });
    // Background ambience (office chatter always; typing during lookups). Shares
    // read-only PCM loaded once at boot; null when ambience is off/unavailable.
    this._ambience = ambienceReady() ? new AmbienceMixer() : null;
  }

  onCallerAudio(cb) { this._audioCb = cb; }

  onStateChange(cb) { this._stateCb = cb; }

  /** Toggle the keyboard-typing ambience (on while she looks something up). */
  setTyping(on) {
    if (this._ambience) this._ambience.setTyping(on);
  }

  /** Queue model audio (24 kHz) for playout, upsampled to the wire rate. */
  playAssistantAudio(pcm24k) {
    if (this._closed) return;
    this._buffer.push(pcm.resampleLinear(pcm24k, pcm.OPENAI_RATE, pcm.WHATSAPP_RATE));
  }

  /** Barge-in: drop everything queued so she stops talking over the caller. */
  flushPlayout() {
    this._buffer.flush();
  }

  async createAnswer(offerSdp) {
    const { RTCPeerConnection, RTCAudioSource, RTCAudioSink } = loadWrtc();

    const pc = new RTCPeerConnection({
      iceServers: iceServers(),
      iceTransportPolicy: process.env.TURN_FORCE_RELAY === 'true' ? 'relay' : 'all',
    });
    this._pc = pc;

    // Outbound: our voice to the caller.
    this._source = new RTCAudioSource();
    pc.addTrack(this._source.createTrack());

    // Inbound: the caller's voice to the model.
    pc.ontrack = (event) => {
      const track = (event.streams && event.streams[0] && event.streams[0].getAudioTracks
        && event.streams[0].getAudioTracks()[0]) || event.track;
      if (!track) return;
      this._sink = new RTCAudioSink(track);
      let loggedFirst = false;
      this._sink.ondata = (data) => {
        if (this._closed || !this._audioCb) return;
        if (!loggedFirst) {
          loggedFirst = true;
          this.log.info('[calls] first caller audio', {
            callId: this.callId, rate: data.sampleRate, channels: data.channelCount || 1,
          });
        }
        const mono = pcm.downmixToMono(data.samples, data.channelCount);
        // Resample from the ACTUAL delivered rate — never a hardcoded 48k.
        this._audioCb(pcm.resampleLinear(mono, data.sampleRate, pcm.OPENAI_RATE));
      };
    };

    pc.oniceconnectionstatechange = () => {
      this.log.info('[calls] ice state', { callId: this.callId, state: pc.iceConnectionState });
    };
    pc.onconnectionstatechange = () => this._onPeerState(pc.connectionState);

    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this._waitForIceGathering(pc);

    this._startPlayout();
    return pc.localDescription.sdp;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    if (this._playoutTimer) clearInterval(this._playoutTimer);
    if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
    this._playoutTimer = null;
    this._disconnectTimer = null;
    this._buffer.flush();
    if (this._ambience) this._ambience.dispose();
    try { if (this._sink) this._sink.stop(); } catch (_) { /* best effort */ }
    try { if (this._pc) this._pc.close(); } catch (_) { /* best effort */ }
    this._sink = null;
    this._pc = null;
    this._source = null;
  }

  // ---------------------------------------------------------------- internals

  _onPeerState(state) {
    this.log.info('[calls] peer state', { callId: this.callId, state });

    if (state === 'connected') {
      if (this._disconnectTimer) clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
    } else if (state === 'disconnected' && !this._disconnectTimer) {
      // Might be a blip — WhatsApp relays media via a Meta server, so a real
      // caller drop usually shows up on the silence watchdog instead.
      this._disconnectTimer = setTimeout(() => {
        this.log.warn('[calls] still disconnected after grace', { callId: this.callId });
        if (this._stateCb) this._stateCb('failed');
      }, DISCONNECT_GRACE_MS);
      return;
    }
    if (this._stateCb) this._stateCb(state);
  }

  /**
   * Emit exactly one 10ms frame per tick — her audio when queued, silence
   * otherwise. An RTC source that stops being fed sounds like a dropped call, so
   * silence frames matter.
   */
  _startPlayout() {
    this._playoutTimer = setInterval(() => {
      if (this._closed || !this._source) return;
      const frame = this._buffer.readFrame();
      // Mix background ambience into EVERY frame (voice or silence) so the office
      // hum is continuous under her voice.
      if (this._ambience) this._ambience.mixInto(frame);
      this._source.onData({
        samples: frame,
        sampleRate: pcm.WHATSAPP_RATE,
        bitsPerSample: 16,
        channelCount: 1,
        numberOfFrames: FRAME_SAMPLES_48K,
      });
    }, FRAME_MS);
  }

  _waitForIceGathering(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          if (pc.removeEventListener) pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      if (pc.addEventListener) pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
    });
  }
}

module.exports = RtcPeer;
