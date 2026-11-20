'use strict';
/**
 * The door into data mode on the NIETE bot, asked before the ordinary text handler.
 *
 * Someone the `data_analyst_whatsapp` switch names sends "data"; from then on their text messages are
 * questions for the data team's governed MCP, until "menu" or 30 minutes idle. Everyone else, and
 * every message outside data mode, returns false and reaches the text handler exactly as before.
 * Data-mode messages never reach that handler, so they stay out of `conversations` (which feeds
 * "what teachers ask").
 *
 * One question at a time per person (a Redis lock), 30 a day. The answer is sent in the same request
 * after Meta was already acked ("Looking into it" first; an answer takes about a minute, 4 at most).
 * Session state (the last 6 turns, the conversation's queries and rule reads, the numbered choices)
 * lives in Redis, so it survives a second web replica; with Redis down, data mode cannot start.
 */

const { isConfigured, dataAnalystIdentity } = require('./switch');
const { ConversationMemory } = require('./memory');
const { renderAnswer } = require('./whatsapp-format');

const SESSION_TTL_S = 30 * 60;
const LOCK_TTL_S = 5 * 60;
const DAILY_LIMIT = 30;
const HISTORY_TURNS = 6;

const TEXTS = Object.freeze({
  welcome: '📊 *NIETE Data*\n'
    + 'Ask me about ICT schools in plain words: teachers, lesson plans, coaching visits, FICO scores, quizzes, attendance.\n'
    + 'I answer from the same governed data as the Data Analyst on Slack. Each answer takes about a minute. Send *menu* to go back.',
  looking: '🔎 Looking into it. About a minute.',
  left: 'Left data mode. Send *data* any time to ask again.',
  busy: "I'm still working on your last question. Send this one again once that answer arrives.",
  limit: `You've asked ${DAILY_LIMIT} questions today, the daily limit here. Ask again tomorrow.`,
  failed: "The data service isn't reachable right now, so I couldn't answer that. Please try again in a few minutes.",
  cannotStart: "Data mode can't start right now. Please try again in a few minutes.",
});

const ENTER = new Set(['data']);
const LEAVE = new Set(['menu', 'exit']);

const sessionKey = (userId) => `data_analyst:session:${userId}`;
const lockName = (userId) => `data_analyst:${userId}`;

function karachiDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function defaultDeps() {
  const WhatsAppService = require('../whatsapp.service');
  const { logToFile } = require('../../utils/logger');
  return {
    env: process.env,
    supabase: require('../../config/supabase'),
    redis: require('../cache/railway-redis.service'),
    whatsapp: WhatsAppService,
    runQuestion: (args) => require('./answering').runQuestion(args),
    now: () => new Date(),
    log: (event, fields) => logToFile(event, { event, ...fields }),
  };
}

async function save(redis, userId, session) {
  return redis.set(sessionKey(userId), session, SESSION_TTL_S);
}

/**
 * @param {{user: {id: string}|null, from: string, messageBody: string, correlationId?: string}} msg
 * @param {object} [deps] injected in tests
 * @returns {Promise<boolean>} true when data mode took the message
 */
async function maybeHandleDataAnalyst({ user, from, messageBody }, deps = defaultDeps()) {
  const { env, supabase, redis, whatsapp, now } = deps;
  const log = deps.log || (() => {});
  if (!user || !user.id || typeof messageBody !== 'string' || !isConfigured(env)) return false;
  const identity = await dataAnalystIdentity(supabase, user.id, { env });
  if (!identity) return false;

  const text = messageBody.trim();
  const word = text.toLowerCase();
  const session = await redis.get(sessionKey(user.id));

  if (!session || typeof session !== 'object') {
    if (!ENTER.has(word)) return false;
    const fresh = { v: 1, startedAt: now().toISOString(), history: [], memory: new ConversationMemory().toJSON(), choices: [] };
    if (!(await save(redis, user.id, fresh))) {
      await whatsapp.sendMessage(from, TEXTS.cannotStart);
      return true;
    }
    log('data_analyst.entered', {});
    await whatsapp.sendMessage(from, TEXTS.welcome);
    return true;
  }

  if (LEAVE.has(word)) {
    await redis.delete(sessionKey(user.id));
    log('data_analyst.left', {});
    await whatsapp.sendMessage(from, TEXTS.left);
    return true;
  }
  if (ENTER.has(word)) {
    await save(redis, user.id, session);
    await whatsapp.sendMessage(from, TEXTS.welcome);
    return true;
  }
  if (!text) return true;

  const choices = Array.isArray(session.choices) ? session.choices : [];
  const pick = /^\d{1,2}$/.test(word) ? choices[Number(word) - 1] : undefined;
  const question = typeof pick === 'string' && pick ? pick : text;

  const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (!(await redis.acquireLock(lockName(user.id), lockId, LOCK_TTL_S))) {
    await whatsapp.sendMessage(from, TEXTS.busy);
    return true;
  }
  try {
    const countKey = `data_analyst:count:${user.id}:${karachiDay(now())}`;
    const asked = await redis.incr(countKey);
    await redis.expire(countKey, 2 * 24 * 3600);
    if (Number.isFinite(asked) && asked > DAILY_LIMIT) {
      await whatsapp.sendMessage(from, TEXTS.limit);
      return true;
    }
    await save(redis, user.id, session); // a long answer must not let the session idle out under it
    await whatsapp.sendMessage(from, TEXTS.looking);

    const memory = ConversationMemory.fromJSON(session.memory);
    const history = Array.isArray(session.history) ? session.history : [];
    let result;
    try {
      result = await deps.runQuestion({ question, identity, memory, history, log });
    } catch (e) {
      log('data_analyst.failed', { error: String(e && e.message).slice(0, 300) });
      await whatsapp.sendMessage(from, TEXTS.failed);
      return true;
    }
    const rendered = renderAnswer({
      text: result.text, calls: result.calls, stoppedEarly: result.stoppedEarly,
      knownText: result.knownText || '', asked: question,
    });
    for (const m of rendered.messages) await whatsapp.sendMessage(from, m);

    const nextHistory = history.concat([{ role: 'user', content: question }, { role: 'assistant', content: rendered.body || result.text }])
      .slice(-HISTORY_TURNS * 2);
    await save(redis, user.id, { ...session, history: nextHistory, memory: memory.toJSON(), choices: rendered.choices, lastAt: now().toISOString() });
    return true;
  } finally {
    await redis.releaseLock(lockName(user.id), lockId);
  }
}

module.exports = { maybeHandleDataAnalyst, TEXTS, DAILY_LIMIT, SESSION_TTL_S };
