'use strict';
/**
 * Background call ambience (bd-neeyat) — mixed into the outbound audio so Neeyat
 * feels like a warm person at a desk rather than a disembodied bot:
 *   - OFFICE chatter — low, constant, for the whole call.
 *   - KEYBOARD typing — only while she is looking something up (a tool call),
 *     stopped the instant she starts answering.
 *
 * The PCM assets are pre-decoded 48 kHz mono (assets/*.pcm), so there is NO
 * runtime audio decoding. Loaded once at boot; each call gets its own mixer
 * (own read positions + typing state) sharing the read-only PCM.
 *
 * Env:
 *   CALLS_AMBIENCE_ENABLED=false        turn it all off
 *   CALLS_AMBIENCE_OFFICE_VOLUME=0.10   constant chatter level
 *   CALLS_AMBIENCE_KEYBOARD_VOLUME=0.22 typing level during lookups
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets');

let officePcm = null;
let keyboardPcm = null;
let loaded = false;

function readPcm(file) {
  try {
    const buf = fs.readFileSync(path.join(ASSETS_DIR, file));
    const pcm = new Int16Array(buf.length >> 1);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = buf.readInt16LE(i * 2);
    return pcm.length ? pcm : null;
  } catch (_) {
    return null;
  }
}

function ambienceEnabled() {
  // On by default; set CALLS_AMBIENCE_ENABLED=false to disable.
  return process.env.CALLS_AMBIENCE_ENABLED !== 'false';
}

/** Load ambience PCM once at boot. Safe no-op if disabled or assets are absent. */
function loadAmbience(logger) {
  const log = logger || { info: () => {}, warn: () => {} };
  if (!ambienceEnabled()) {
    log.info('[calls] ambience disabled (CALLS_AMBIENCE_ENABLED=false)');
    return;
  }
  officePcm = readPcm('office-48k-mono.pcm');
  keyboardPcm = readPcm('keyboard-48k-mono.pcm');
  loaded = Boolean(officePcm || keyboardPcm);
  log.info('[calls] ambience', {
    loaded, office: Boolean(officePcm), keyboard: Boolean(keyboardPcm),
  });
}

function ambienceReady() {
  return loaded;
}

function officeVolume() {
  const v = Number(process.env.CALLS_AMBIENCE_OFFICE_VOLUME);
  return Number.isFinite(v) ? v : 0.10;
}
function keyboardVolume() {
  const v = Number(process.env.CALLS_AMBIENCE_KEYBOARD_VOLUME);
  return Number.isFinite(v) ? v : 0.22;
}

class AmbienceMixer {
  constructor() {
    this._officePos = 0;
    this._kbPos = 0;
    this._typing = false;
    this._typingTimer = null;
  }

  /** Turn the keyboard-typing layer on/off (on while she is looking something up). */
  setTyping(on) {
    if (this._typingTimer) {
      clearTimeout(this._typingTimer);
      this._typingTimer = null;
    }
    this._typing = Boolean(on) && Boolean(keyboardPcm);
    if (this._typing) {
      this._kbPos = 0; // start the typing loop fresh
      // Safety: never let typing linger if no audio follows the lookup.
      this._typingTimer = setTimeout(() => { this._typing = false; }, 12000);
    }
  }

  /** Mix ambience into a 48 kHz mono frame, in place. Office is always on. */
  mixInto(frame) {
    const ov = officeVolume();
    const kv = keyboardVolume();
    const office = officePcm;
    const kb = keyboardPcm;
    for (let i = 0; i < frame.length; i += 1) {
      let s = frame[i];
      if (office && ov > 0) {
        s += office[this._officePos] * ov;
        this._officePos += 1;
        if (this._officePos >= office.length) this._officePos = 0;
      }
      if (this._typing && kb && kv > 0) {
        s += kb[this._kbPos] * kv;
        this._kbPos += 1;
        if (this._kbPos >= kb.length) this._kbPos = 0;
      }
      frame[i] = s > 32767 ? 32767 : (s < -32768 ? -32768 : s | 0);
    }
  }

  dispose() {
    if (this._typingTimer) clearTimeout(this._typingTimer);
    this._typingTimer = null;
  }
}

module.exports = { loadAmbience, ambienceReady, AmbienceMixer };
