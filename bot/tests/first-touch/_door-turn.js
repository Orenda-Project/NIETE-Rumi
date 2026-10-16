'use strict';
/**
 * The turn driver the door's reply tests share: one inbound through the REAL ingress (attach → route), what went out
 * on the WhatsApp boundary, what the door logged, what the store holds. Required AFTER each test file's own
 * `jest.mock` factories (the same boundary mocks as the door's other tests: supabase, Redis, whatsapp.service, the loggers, the
 * session stores), so every module below is the mocked or the real one exactly as that file set it up.
 */
const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Ledger = require('../../shared/services/quiz/message-ledger');
const Ingress = require('../../shared/services/student-ingress');
const { TABLE, UNKNOWN_USER, PHONE, SISTER_ON, OURS_ON, seedDb } = require('./door-fixture');

/** The env a door turn needs: the identity switches' salt, the ukey key, the token secret and an https base. No real secret. */
const ENV = Object.freeze({
  STUDENT_MODE_ENABLED: 'true',
  WQ_TOMB_SALT: 'unit-salt-not-a-secret',
  WEB_QUIZ_KID_KEY: 'unit-kid-key-not-a-secret',
  WEB_QUIZ_TOKEN_SECRET: 'unit-token-secret-not-a-secret',
  WEB_QUIZ_BASE_URL: 'https://quiz.example.test',
});

const state = { fake: null };

/** A fresh store and fresh caches. `settings` replaces the switch map (default: theirs and ours ON). */
function seed({ settings = { ...SISTER_ON, ...OURS_ON }, ...opts } = {}) {
  state.fake = seedDb(supabase, { settings, ...opts });
  IdFlags._resetCache(); HubFlags._resetCache();
  Ledger._resetCap(); Ledger._resetMissing();
  redisService.__keys.clear();
  return state.fake;
}

const textMessage = (body) => ({ id: 'wamid.text', type: 'text', text: { body } });
const tapMessage = (id) => ({ id: 'wamid.tap', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });

/** A typed message from the phone, as whatsapp-bot.js runs it: attach (classify) then route. */
async function text(body, user = UNKNOWN_USER, phone = PHONE) {
  const u = { ...user };
  await Ingress.attach(u, phone, { body });
  const routed = await Ingress.route({ message: textMessage(body), messageType: 'text', messageBody: body, from: phone, user: u });
  return { routed, user: u };
}

/** A reply-button tap: no typed body (messageBody is text.body, so undefined for a tap). */
async function tap(id, user = UNKNOWN_USER, phone = PHONE) {
  const u = { ...user };
  await Ingress.attach(u, phone, { body: undefined });
  const routed = await Ingress.route({ message: tapMessage(id), messageType: 'interactive', messageBody: undefined, from: phone, user: u });
  return { routed, user: u };
}

const events = (name) => logEvent.mock.calls.filter(([n]) => n === name).map(([, d]) => d);
const doorEvents = () => events('onboard.quiz_door');
/** Every send on the boundary, in order, by kind. */
function sent() {
  return {
    buttons: WhatsAppService.sendInteractiveButtons.mock.calls.map(([to, o]) => ({ to, body: o.body, buttons: o.buttons })),
    cta: WhatsAppService.sendCtaUrl.mock.calls.map(([to, o]) => ({ to, body: o.body, buttonText: o.buttonText, url: o.url })),
    text: WhatsAppService.sendMessage.mock.calls.map(([to, body]) => ({ to, body })),
  };
}
const sendCount = () => {
  const s = sent();
  return s.buttons.length + s.cta.length + s.text.length;
};
/** The door's rows in the store, by feature: { feature: { count, usedAt } }. */
function doorRows() {
  const out = {};
  for (const r of state.fake.db[TABLE] || []) out[r.feature] = { count: r.intro_shown_count, usedAt: r.feature_used_at };
  return out;
}
/** Every write on the store, as `op:table` (selects excluded). */
const writes = () => state.fake.calls.filter((c) => c.op !== 'select').map((c) => `${c.op}:${c.table}`);
const keyReads = () => state.fake.calls.filter((c) => c.table === TABLE && c.op === 'select').length;
/** The ledger rpc calls (message_ledger_add), by trigger. */
const ledgerTriggers = () => state.fake.rpcs.filter((r) => r.name === 'message_ledger_add').map((r) => r.args.p_trigger);

module.exports = {
  ENV, state, seed, text, tap, textMessage, tapMessage, events, doorEvents, sent, sendCount, doorRows, writes, keyReads,
  ledgerTriggers,
};
