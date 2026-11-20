#!/usr/bin/env node
'use strict';
/**
 * Ask the WhatsApp data analyst a question from a terminal: the same path a WhatsApp message takes
 * after the door (the data team's MCP, the proxy's gates, the prompt, the loop, the WhatsApp
 * rendering), printed instead of sent. For checking figures side by side with the Slack Data-Analyst
 * before a switch-on, and for a trial against the live MCP.
 *
 *   DATA_MCP_SURFACE=whatsapp-dev node bot/scripts/data-analyst/ask.js "How many teachers got a lesson plan last week?"
 *   ... --follow-up "and by sector?"     a second question in the same conversation
 *   ... --trace                          print each tool call and the size of its result
 *   ... --raw                            also print the model's own text, before the WhatsApp rendering
 *   ... --png <dir>                      write each answer's chart to <dir>/answer-<n>.png (as WhatsApp would get it)
 *
 * Reads .env (DATA_MCP_URL, DATA_MCP_USER_EMAIL, ANTHROPIC_API_KEY). Set DATA_MCP_SURFACE=whatsapp-dev
 * so the data team's audit trail can tell a trial from a real WhatsApp question. Spends one answer's
 * model tokens (about $0.30) and runs real, read-only BigQuery queries through their cost guard.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { isConfigured } = require('../../shared/services/data-analyst/switch');
const { ConversationMemory } = require('../../shared/services/data-analyst/memory');
const { runQuestion } = require('../../shared/services/data-analyst/answering');
const { composeReply, footer } = require('../../shared/services/data-analyst/whatsapp-format');
const { chartSpecs, renderChartPng } = require('../../shared/services/data-analyst/chart');

// Straight to the terminal: the bot's structured logger takes over console.log and would wrap the answer in a log line.
const say = (text) => fs.writeSync(1, `${text}\n`);

function argsOf(argv) {
  const out = { questions: [], trace: false, raw: false, png: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--trace') out.trace = true;
    else if (argv[i] === '--raw') out.raw = true;
    else if (argv[i] === '--png') out.png = argv[++i];
    else if (argv[i] === '--follow-up') out.questions.push(argv[++i]);
    else out.questions.push(argv[i]);
  }
  return out;
}

async function main() {
  const { questions, trace, raw, png } = argsOf(process.argv.slice(2));
  if (!questions.length || questions.some((q) => !q)) {
    console.error('usage: node bot/scripts/data-analyst/ask.js "<question>" [--follow-up "<question>"] [--trace]');
    process.exit(2);
  }
  if (!isConfigured()) {
    console.error('Not configured: DATA_MCP_URL, DATA_MCP_USER_EMAIL and ANTHROPIC_API_KEY must all be set.');
    process.exit(2);
  }
  const identity = { userId: 'terminal', email: process.env.DATA_MCP_USER_EMAIL.trim() };
  const memory = new ConversationMemory();
  let history = [];
  let choices = [];
  const log = trace ? (event, fields) => say(`  [${event}] ${JSON.stringify(fields)}`) : () => {};
  for (const typed of questions) {
    // A number picks one of the last answer's numbered choices, as the WhatsApp door does (entry.js).
    const question = /^\d{1,2}$/.test(typed.trim()) && choices[Number(typed) - 1] ? choices[Number(typed) - 1] : typed;
    const started = Date.now();
    say(`\n> ${question}\n`);
    const result = await runQuestion({ question, identity, memory, history, log });
    if (trace) {
      for (const c of result.calls) {
        const args = { ...c.arguments };
        delete args.asked_by; delete args.question; delete args.turn_id;
        say(`  ${c.name} ${JSON.stringify(args).slice(0, 300)} -> ${String(c.result || '').length} chars`);
      }
    }
    if (raw) say(`--- model text ---\n${result.text}\n--- WhatsApp ---`);
    const specs = chartSpecs(result.calls, question);
    let chart = null;
    if (specs.length && png) {
      chart = await renderChartPng(specs[0], { footer: footer(result.calls).replace(/^_|_$/g, '') });
      if (chart) {
        fs.mkdirSync(png, { recursive: true });
        const file = path.join(png, `answer-${questions.indexOf(typed) + 1}.png`);
        fs.writeFileSync(file, chart);
        say(`[chart: ${specs[0].kind}, ${file}]`);
      }
    } else if (specs.length) say(`[chart: ${specs[0].kind} — add --png <dir> to render it]`);
    const out = composeReply({ text: result.text, calls: result.calls, stoppedEarly: result.stoppedEarly, knownText: result.knownText, hasChart: Boolean(chart || specs.length) });
    for (const m of out.before) say(`${m}\n---`);
    if (out.asks.length) say(`${out.caption}\n${out.asks.map((a) => `${a.question}: ${a.options.join(' | ')}`).join('\n')}\n---`);
    else say(`${out.caption}\n[Ask another] [Main menu]\n---`);
    const cost = Number.isFinite(result.costUsd) ? `$${result.costUsd.toFixed(3)}` : 'unpriced';
    say(`(${Math.round((Date.now() - started) / 1000)} s · ${cost} · turn ${result.turnId})`);
    choices = out.asks.flatMap((a) => a.options.map((o) => `${a.question.replace(/[?:\s]+$/, '')}: ${o}`));
    history = history.concat([{ role: 'user', content: question }, { role: 'assistant', content: out.body || result.text }]).slice(-12);
  }
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
