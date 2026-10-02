/**
 * Network-boundary stand-ins for the child-test conversation tests: an in-memory Redis with the
 * railway-redis.service surface the code uses, and a recorder for every WhatsApp send.
 */

function createFakeRedis() {
  const data = new Map();
  const api = {
    __data: data,
    isAvailable: () => true,
    async get(k) { if (!data.has(k)) return null; const v = data.get(k); try { return JSON.parse(v); } catch { return v; } },
    async set(k, v) { data.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; },
    async setex(k, _ttl, v) { return api.set(k, v); },
    async setexWithCeiling(k, _ttl, v) { return api.set(k, v); },
    async setNX(k, v) { if (data.has(k)) return false; await api.set(k, v); return true; },
    async delete(k) { data.delete(k); return true; },
    async incr(k) { const n = Number(data.get(k) || 0) + 1; data.set(k, String(n)); return n; },
    async expire() { return true; },
  };
  return api;
}

/** Everything sent, in order, as { kind, to, ... } — kinds: text, buttons, list, image, flow. */
function createWhatsAppRecorder() {
  const sent = [];
  const ok = { text: true, buttons: true, list: true, image: true };
  const svc = {
    __sent: sent,
    __ok: ok,
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return ok.text; }),
    sendInteractiveButtons: jest.fn(async (to, o) => { sent.push({ kind: 'buttons', to, body: o.body, buttons: o.buttons }); return ok.buttons; }),
    sendInteractiveMessage: jest.fn(async (to, l) => { sent.push({ kind: 'list', to, ...l }); return ok.list; }),
    sendImageFromBuffer: jest.fn(async (to, buf, caption) => { sent.push({ kind: 'image', to, bytes: buf.length, caption }); return ok.image; }),
    downloadMedia: jest.fn(async (id) => Buffer.from(`media:${id}`)),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
  };
  return svc;
}

module.exports = { createFakeRedis, createWhatsAppRecorder };
