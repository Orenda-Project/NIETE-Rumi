'use strict';
/**
 * The data analyst on the NIETE bot, with no data mode (the operator, 21 Nov 01:08: "I like D the most
 * honestly. Alongside 'data' to a flow"; a sticky mode is forgotten because the line saying how to leave
 * scrolls away).
 *
 * Only for someone the `data_analyst_whatsapp` switch names (switch.js), and only on a tier with the env set:
 *   - "data" alone opens the question Flow (one text box, four quick picks), or, where no Flow is registered
 *     yet (DATA_ANALYST_FLOW_ID unset), a list of the same four picks;
 *   - any other text: the bot's own words go to the ordinary handler untouched; the rest is read by a cheap
 *     classifier (classifier.js): a data question is answered straight away, a normal one goes to the
 *     ordinary handler, and an unsure one is asked with two buttons, "Data answer" / "Normal";
 *   - every answer is one bubble: the chart (chart.js) with one or two lines and "Ask another" / "Main menu",
 *     or the text with the same two buttons when there is nothing to draw.
 * A follow-up window stays open for ten minutes after an answer (its history and figures, so "and by
 * sector?" builds on the last answer), then closes by itself. One question at a time, 30 a day.
 * Everything else, and everyone else, reaches the ordinary bot exactly as before.
 */

const { isConfigured, dataAnalystIdentity } = require('./switch');
const { ConversationMemory } = require('./memory');
const { composeReply, footer } = require('./whatsapp-format');
const { chartSpecs, breakdownLines } = require('./chart');
const { isClearlyNormal } = require('./classifier');

const FOLLOW_UP_WINDOW_S = 10 * 60;
const PENDING_TTL_S = 10 * 60;
const LOCK_TTL_S = 5 * 60;
const DAILY_LIMIT = 30;
const HISTORY_TURNS = 6;
const FLOW_SCREEN = 'DATA_QUESTION';
const FLOW_TOKEN_PREFIX = 'dataq:';

/** The four quick picks, the same in the Flow (docs/flows/data-question.json) and in the no-Flow list. */
const QUICK_PICKS = Object.freeze([
  { id: 'pick_1', title: 'Lesson plans last week', question: 'How many teachers got a lesson plan last week, by sector?' },
  { id: 'pick_2', title: 'Coach visits this month', question: 'How many coach visits were held this month, by sector?' },
  { id: 'pick_3', title: 'Active teachers this week', question: 'How many teachers were active on the assistant this week, by sector?' },
  { id: 'pick_4', title: 'FICO trend since Sep', question: 'How are FICO scores moving month by month since September?' },
]);

const BUTTONS = Object.freeze([{ id: 'da_another', title: 'Ask another' }, { id: 'da_menu', title: 'Main menu' }]);
const ROUTE_BUTTONS = Object.freeze([{ id: 'da_route_data', title: 'Data answer' }, { id: 'da_route_normal', title: 'Normal' }]);

const TEXTS = Object.freeze({
  looking: '🔎 Looking into it. About a minute.',
  busy: "I'm still working on your last question. Send this one again once that answer arrives.",
  limit: `You've asked ${DAILY_LIMIT} data questions today, the daily limit here. Ask again tomorrow.`,
  failed: "The data service isn't reachable right now, so I couldn't answer that. Please try again in a few minutes.",
  unsure: 'Should I answer this from the ICT data, or pass it to the normal assistant?',
  pick: 'Ask me about ICT schools in plain words, any time. Or pick a common question:',
  flowHeader: 'NIETE Data',
  flowBody: 'Ask about ICT schools in plain words, or pick a common question.',
});

const convKey = (userId) => `data_analyst:conv:${userId}`;
const pendingKey = (userId) => `data_analyst:pending:${userId}`;
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
    classify: (text, ctx) => require('./classifier').classify(text, { ...ctx, model: process.env.DATA_ANALYST_CLASSIFIER_MODEL || undefined }),
    flowId: process.env.DATA_ANALYST_FLOW_ID,
    runQuestion: (args) => require('./answering').runQuestion(args),
    renderChart: (spec, opts) => require('./chart').renderChartPng(spec, opts),
    now: () => new Date(),
    log: (event, fields) => logToFile(event, { event, ...fields }),
  };
}

async function identityOf(user, deps) {
  if (!user || !user.id || !isConfigured(deps.env)) return null;
  return dataAnalystIdentity(deps.supabase, user.id, { env: deps.env });
}

/** "data", "Ask another": the question Flow, or the four picks as a list where no Flow is registered. */
async function offerQuestion(user, from, deps) {
  const flowId = String((deps.flowId !== undefined ? deps.flowId : deps.env && deps.env.DATA_ANALYST_FLOW_ID) || '').trim();
  if (flowId) {
    const sent = await deps.whatsapp.sendFlow(from, {
      flowId, header: TEXTS.flowHeader, body: TEXTS.flowBody, buttonText: 'Ask', screen: FLOW_SCREEN,
      flowToken: `${FLOW_TOKEN_PREFIX}${user.id}:${Date.now()}`,
    });
    if (sent) return;
  }
  await deps.whatsapp.sendInteractiveMessage(from, {
    body: { text: TEXTS.pick },
    action: {
      button: 'Pick a question',
      sections: [{ title: 'Common questions', rows: QUICK_PICKS.map((p, i) => ({ id: `da_pick_${i + 1}`, title: p.title, description: p.question.slice(0, 72) })) }],
    },
  });
}

async function sendAsks(from, caption, asks, deps) {
  const choices = [];
  const rows = [];
  for (const a of asks) {
    const q = a.question.replace(/[?:\s]+$/, '').trim();
    for (const o of a.options) {
      if (rows.length >= 10) break;
      choices.push(q ? `${q}: ${o}` : o);
      rows.push({ id: `da_opt_${choices.length}`, title: [...o].slice(0, 24).join(''), description: [...o].length > 24 ? [...o].slice(0, 72).join('') : undefined });
    }
  }
  const body = [caption, ...asks.map((a) => (a.question ? `*${a.question}*` : ''))].filter(Boolean).join('\n\n').slice(0, 1024);
  await deps.whatsapp.sendInteractiveMessage(from, {
    body: { text: body },
    action: { button: 'Choose', sections: [{ title: 'Options', rows: rows.map((r) => (r.description ? r : { id: r.id, title: r.title })) }] },
  });
  return choices;
}

/** One governed answer, delivered as one bubble with buttons. Always answers something; never throws past here. */
async function answer(question, { user, from, identity }, deps) {
  const { redis, whatsapp, now } = deps;
  const log = deps.log || (() => {});
  const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (!(await redis.acquireLock(lockName(user.id), lockId, LOCK_TTL_S))) {
    await whatsapp.sendMessage(from, TEXTS.busy);
    return;
  }
  try {
    const countKey = `data_analyst:count:${user.id}:${karachiDay(now())}`;
    const asked = await redis.incr(countKey);
    await redis.expire(countKey, 2 * 24 * 3600);
    if (Number.isFinite(asked) && asked > DAILY_LIMIT) {
      await whatsapp.sendMessage(from, TEXTS.limit);
      return;
    }
    await whatsapp.sendMessage(from, TEXTS.looking);
    const conv = (await redis.get(convKey(user.id))) || {};
    const memory = ConversationMemory.fromJSON(conv.memory);
    const history = Array.isArray(conv.history) ? conv.history : [];
    let result;
    try {
      result = await deps.runQuestion({ question, identity, memory, history, log });
    } catch (e) {
      log('data_analyst.failed', { error: String(e && e.message).slice(0, 300) });
      await whatsapp.sendMessage(from, TEXTS.failed);
      return;
    }
    const specs = chartSpecs(result.calls, question);
    const foot = footer(result.calls).replace(/^_|_$/g, '');
    const png = specs.length ? await deps.renderChart(specs[0], { footer: foot }) : null;
    const reply = composeReply({ text: result.text, calls: result.calls, stoppedEarly: result.stoppedEarly, knownText: result.knownText || '', hasChart: Boolean(png), rest: png && specs[0] ? specs[0].rest : breakdownLines(result.calls) });
    let choices = [];
    if (reply.asks.length) {
      choices = await sendAsks(from, reply.caption, reply.asks, deps);
    } else {
      for (const m of reply.before) await whatsapp.sendMessage(from, m);
      let sent = false;
      if (png) {
        sent = await whatsapp.sendImageBufferWithButtons(from, png, reply.caption, [...BUTTONS]);
        if (!sent) {
          await whatsapp.sendImageFromBuffer(from, png, '');
        }
      }
      if (!sent) await whatsapp.sendInteractiveButtons(from, { body: reply.caption, buttons: [...BUTTONS] });
    }
    log('data_analyst.delivered', { chart: Boolean(png), asks: reply.asks.length, kind: specs[0] ? specs[0].kind : null });
    const nextHistory = history.concat([{ role: 'user', content: question }, { role: 'assistant', content: reply.body || result.text }]).slice(-HISTORY_TURNS * 2);
    await redis.set(convKey(user.id), {
      history: nextHistory, memory: memory.toJSON(), choices, lastAnswer: String(reply.body || '').slice(0, 600), lastAt: now().toISOString(),
    }, FOLLOW_UP_WINDOW_S);
  } finally {
    await redis.releaseLock(lockName(user.id), lockId);
  }
}

/**
 * A text message, before the ordinary text handler.
 * @returns {Promise<boolean>} true when the data analyst took it
 */
async function maybeHandleDataAnalyst({ user, from, messageBody }, deps = defaultDeps()) {
  if (typeof messageBody !== 'string') return false;
  const identity = await identityOf(user, deps);
  if (!identity) return false;
  const text = messageBody.trim();
  if (text.toLowerCase() === 'data') {
    await offerQuestion(user, from, deps);
    return true;
  }
  const conv = await deps.redis.get(convKey(user.id));
  const recentAnswer = conv && typeof conv.lastAnswer === 'string' ? conv.lastAnswer : '';
  if (isClearlyNormal(text, { allowShort: Boolean(recentAnswer) })) return false;
  const verdict = await deps.classify(text, { recentAnswer });
  (deps.log || (() => {}))('data_analyst.classified', { verdict, followUp: Boolean(recentAnswer) });
  if (verdict === 'data') {
    await answer(text, { user, from, identity }, deps);
    return true;
  }
  if (verdict === 'unsure') {
    await deps.redis.set(pendingKey(user.id), { text }, PENDING_TTL_S);
    await deps.whatsapp.sendInteractiveButtons(from, { body: TEXTS.unsure, buttons: [...ROUTE_BUTTONS] });
    return true;
  }
  return false;
}

/**
 * A button or list tap whose id starts `da_`.
 * @returns {Promise<{handled: boolean, normalText?: string}>} normalText: hand these words to the ordinary text handler
 */
async function handleDataAnalystButton({ user, from, buttonId }, deps = defaultDeps()) {
  const id = String(buttonId || '');
  if (!id.startsWith('da_')) return { handled: false };
  const identity = await identityOf(user, deps);
  if (!identity) return { handled: false };
  if (id === 'da_menu') return { handled: true, normalText: 'menu' };
  if (id === 'da_another') {
    await offerQuestion(user, from, deps);
    return { handled: true };
  }
  if (id === 'da_route_data' || id === 'da_route_normal') {
    const pending = await deps.redis.get(pendingKey(user.id));
    await deps.redis.delete(pendingKey(user.id));
    const text = pending && typeof pending.text === 'string' ? pending.text : '';
    if (!text) return { handled: true };
    if (id === 'da_route_normal') return { handled: true, normalText: text };
    await answer(text, { user, from, identity }, deps);
    return { handled: true };
  }
  const pick = /^da_pick_(\d+)$/.exec(id);
  if (pick) {
    const p = QUICK_PICKS[Number(pick[1]) - 1];
    if (p) await answer(p.question, { user, from, identity }, deps);
    return { handled: true };
  }
  const opt = /^da_opt_(\d+)$/.exec(id);
  if (opt) {
    const conv = await deps.redis.get(convKey(user.id));
    const choice = conv && Array.isArray(conv.choices) ? conv.choices[Number(opt[1]) - 1] : null;
    if (typeof choice === 'string' && choice) await answer(choice, { user, from, identity }, deps);
    else await offerQuestion(user, from, deps);
    return { handled: true };
  }
  return { handled: false };
}

/**
 * The question Flow's reply (nfm_reply). Ours only on a `dataq:` token.
 * @returns {Promise<boolean>}
 */
async function handleDataAnalystFlowReply({ user, from, responseJson }, deps = defaultDeps()) {
  const token = String((responseJson && responseJson.flow_token) || '');
  if (!token.startsWith(FLOW_TOKEN_PREFIX)) return false;
  const identity = await identityOf(user, deps);
  if (!identity) return true; // our token, but no longer on the switch: claimed so no other Flow handler misreads it
  const typed = String(responseJson.question || '').trim();
  const pick = QUICK_PICKS.find((p) => p.id === responseJson.pick);
  const question = typed || (pick ? pick.question : '');
  if (!question) {
    await offerQuestion(user, from, deps);
    return true;
  }
  await answer(question, { user, from, identity }, deps);
  return true;
}

module.exports = {
  maybeHandleDataAnalyst, handleDataAnalystButton, handleDataAnalystFlowReply,
  TEXTS, QUICK_PICKS, BUTTONS, DAILY_LIMIT, FOLLOW_UP_WINDOW_S, FLOW_TOKEN_PREFIX,
};
