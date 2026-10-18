'use strict';
/**
 * The WhatsApp message ids a block of sends was given, for a caller that wants them (a teacher's class report keeps
 * its id so a later `failed` status can find it: quiz/report-delivery). WhatsAppService.sendMessage / sendDocument
 * hand an accepted send's id to report(); it reaches only a caller inside collect(), and every other caller is
 * untouched: no argument changes, the boolean answer is the same, nothing is kept.
 */
const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();

/** Run `fn`; → { result, ids } — the ids of the sends `fn` made that WhatsApp accepted. A throw still throws. */
async function collect(fn) {
  const ids = [];
  const result = await store.run(ids, fn);
  return { result, ids };
}

/** An accepted send's id, from the transport. Outside collect(), or with no id, it does nothing. Never throws. */
function report(id) {
  try {
    const ids = store.getStore();
    if (ids && typeof id === 'string' && id) ids.push(id);
  } catch (_) { /* never breaks a send */ }
}

module.exports = { collect, report };
