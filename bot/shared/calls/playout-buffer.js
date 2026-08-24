'use strict';
/**
 * Playout jitter buffer for outbound call audio (bd-1hae7.1).
 *
 * The Realtime API streams a reply FASTER than real time, so this queue
 * legitimately holds several seconds of speech that has not been spoken yet.
 * Three properties, each one learned from a specific failure:
 *
 *  - **Chunk-based reads.** Draining sample-by-sample with Array.shift() is
 *    O(n²) and audibly stutters. Chunks stay put; a read head walks them.
 *  - **The size cap is a pathological-growth guard, not a trim.** Dropping audio
 *    inside a response skips or overlaps speech. At ~60s of queue something is
 *    badly wrong, and only then do we drop the stale head.
 *  - **A prebuffer.** Starting playout the instant one frame lands means every
 *    generation hiccup underruns into "unstable connection" stutter. We wait for
 *    a small cushion (~120ms), and re-arm it after any underrun.
 *
 * Pure logic, no timers and no wrtc — the emitting loop lives in rtc-peer.
 */

const DEFAULT_FRAME_SAMPLES = 480;                 // 10ms @ 48kHz
const DEFAULT_PREBUFFER_SAMPLES = 48000 * 0.12;    // ~120ms cushion
const DEFAULT_MAX_SAMPLES = 48000 * 60;            // ~60s safety ceiling

class PlayoutBuffer {
  constructor({
    frameSamples = DEFAULT_FRAME_SAMPLES,
    prebufferSamples = DEFAULT_PREBUFFER_SAMPLES,
    maxSamples = DEFAULT_MAX_SAMPLES,
  } = {}) {
    this.frameSamples = frameSamples;
    this.prebufferSamples = prebufferSamples;
    this.maxSamples = maxSamples;
    this._chunks = [];
    this._head = 0;      // read offset into _chunks[0]
    this._buffered = 0;  // unread samples across all chunks
    this._playing = false;
  }

  /** Unread samples currently queued. */
  get buffered() {
    return this._buffered;
  }

  /** Queue a chunk of 48 kHz PCM16 for playout. */
  push(pcm48k) {
    if (!pcm48k || pcm48k.length === 0) return;
    this._chunks.push(pcm48k);
    this._buffered += pcm48k.length;
    // Pathological growth only: drop the stale head, never the newest audio.
    while (this._buffered > this.maxSamples && this._chunks.length > 1) {
      const dropped = this._chunks.shift();
      this._buffered -= dropped.length - this._head;
      this._head = 0;
    }
  }

  /**
   * Pull exactly one frame. Returns silence while the prebuffer is filling or
   * when nothing is queued, so the caller always has a frame to emit — an RTC
   * source that stops being fed sounds like a dropped call.
   */
  readFrame() {
    const frame = new Int16Array(this.frameSamples);

    if (!this._playing) {
      if (this._buffered >= this.prebufferSamples && this._buffered > 0) this._playing = true;
      else return frame;
    } else if (this._buffered === 0) {
      this._playing = false; // underrun → re-arm the cushion
      return frame;
    }

    let filled = 0;
    while (filled < this.frameSamples && this._chunks.length > 0) {
      const chunk = this._chunks[0];
      const avail = chunk.length - this._head;
      const need = this.frameSamples - filled;
      const n = Math.min(avail, need);
      frame.set(chunk.subarray(this._head, this._head + n), filled);
      filled += n;
      this._head += n;
      this._buffered -= n;
      if (this._head >= chunk.length) {
        this._chunks.shift();
        this._head = 0;
      }
    }
    return frame;
  }

  /** Drop everything and re-arm the prebuffer — barge-in, where audio is discontinuous. */
  flush() {
    this._chunks = [];
    this._head = 0;
    this._buffered = 0;
    this._playing = false;
  }
}

module.exports = PlayoutBuffer;
