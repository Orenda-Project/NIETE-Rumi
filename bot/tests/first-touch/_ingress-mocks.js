'use strict';
/**
 * The boundary mocks every door test of the ingress shares — Redis as a Map, the WhatsApp send, the loggers, the
 * session stores and the two consumers the ingress hands a child to. Called inside each test file's own
 * `jest.mock` factories (jest hoists those per file), so this helper holds the shapes only.
 */
function redisMock(jestRef) {
  const keys = new Map();
  return {
    __keys: keys,
    get: jestRef.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jestRef.fn(async (k, v) => { keys.set(k, v); return true; }),
    setNX: jestRef.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    delete: jestRef.fn(async (k) => keys.delete(k)),
    incr: jestRef.fn(async (k) => { const v = (Number(keys.get(k)) || 0) + 1; keys.set(k, v); return v; }),
    expire: jestRef.fn(async () => true),
    isAvailable: () => true,
  };
}
function whatsappMock(jestRef) {
  return {
    sendMessage: jestRef.fn(async () => true), sendCtaUrl: jestRef.fn(async () => true),
    sendInteractiveButtons: jestRef.fn(async () => true), sendFlow: jestRef.fn(async () => false),
    sendReaction: jestRef.fn(async () => true), startContinuousTypingIndicator: jestRef.fn(() => ({ stop: jestRef.fn() })),
  };
}
module.exports = { redisMock, whatsappMock };
