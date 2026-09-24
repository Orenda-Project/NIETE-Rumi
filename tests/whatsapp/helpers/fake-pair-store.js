'use strict';
/**
 * The Redis boundary of the WhatsApp send pacer, faked.
 *
 * The pacer talks to Redis through ONE atomic script per decision
 * (whatsapp-send-pacer.js RESERVE_LUA). This fake answers that script with the
 * same arithmetic — GCRA: a phone's "theoretical arrival time" moves forward one
 * interval per send, and a send may go once that time is within `burst`
 * intervals of now — so a test can drive the REAL WhatsApp service and pacer
 * against a phone whose schedule is quiet, busy or full. The Lua itself is
 * proved against a real Redis in tests/whatsapp/send-pacing.redis.test.js.
 *
 * Modes, as in the script: 'wait' (reserve unless it is further out than
 * max_wait), 'try' (reserve only if it can go now), 'force_if_late' (always
 * reserve; answer granted=2 when the slot was further out than max_wait, so the
 * caller sends now instead of waiting), 'penalize' (push the phone back).
 */
class FakePairStore {
  constructor() { this.tat = new Map(); this.available = true; this.calls = []; }

  isAvailable() { return this.available; }

  async evalScript(_script, keys, args) {
    this.calls.push({ keys, args });
    const [intervalMs, burst, maxWaitMs, mode, penaltyMs] = args.map((a, i) => (i === 3 ? a : Number(a)));
    const key = keys[0];
    const now = Date.now();
    const tau = (burst - 1) * intervalMs;
    let tat = Math.max(this.tat.get(key) || 0, now);
    if (mode === 'penalize') {
      tat = Math.max(tat, now + penaltyMs + tau);
      this.tat.set(key, tat);
      return [0, 1];
    }
    const delay = Math.max(0, tat - tau - now);
    if (delay > 0 && mode === 'try') return [delay, 0];
    let granted = 1;
    if (delay > maxWaitMs) {
      if (mode !== 'force_if_late') return [delay, 0];
      granted = 2;
    }
    this.tat.set(key, tat + intervalMs);
    return [delay, granted];
  }

  /** Spend a phone's whole burst, as a child who just finished a quiz has. */
  async fill(key, { intervalMs = 6000, burst = 8 } = {}) {
    for (let i = 0; i < burst; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.evalScript(null, [key], [intervalMs, burst, 120000, 'wait', 0]);
    }
    this.calls = [];
  }
}

module.exports = { FakePairStore };
