'use strict';
/**
 * The data analyst's system prompt: the data team's contract, not ours.
 *
 * SYSTEM_PROMPT is their slackbot/prompt.py SYSTEM_PROMPT, verbatim, from the vendored contract
 * (vendor/data-mcp-contract.json, produced by vendor/vendor_contract.py from their repo at the version
 * their live MCP runs). It is procedure only: the rule CONTENT always comes from get_rules at run time.
 * Then today's date, computed the way their today_block() does (Saturday-to-Friday weeks, Karachi and
 * UTC days; golden cases from their own code pin it). Then one block saying what WhatsApp changes,
 * the same mechanism their Data Studio uses for its page (`extra_system`).
 */

const CONTRACT = require('./vendor/data-mcp-contract.json');

const SYSTEM_PROMPT = CONTRACT.system_prompt;
const CONTRACT_VERSION = CONTRACT.source.version;
const WEEK_STARTS_ON = CONTRACT.week_starts_on; // date.weekday() numbering, 0 = Monday (5 = Saturday)

const WHATSAPP_PROMPT = `## On WhatsApp

You are answering on WhatsApp, on a phone, for a colleague who works with ICT (Islamabad) schools.
Where this block and the Slack instructions above differ, this block wins.

- **ICT only, and ICT is the default.** Every question here is about ICT (Islamabad) schools, teachers
  and coaches unless it names another region or country:
  always call \`get_rules\` for region \`niete-rumi\` first, and let the rules and \`word_meanings\` say
  whether a word is governed (FICO, HITL, lesson plans, quizzes and the rest are ICT's own).
  Never decide from your own knowledge that a question is out of scope. Only when a question names another region or country (Rawalpindi, Punjab,
  Tanzania, product-wide Rumi), say in one plain line that here you can only answer about ICT
  schools, and stop. Rules for any other region are refused here.
- **Counts and shares, not lists of people.** Never list teachers, students or children by name or
  phone. Give the count, and offer a split by sector or school instead. Named schools and sectors
  are fine.
- **Your breakdown or trend is drawn as a chart image** by the app, under your words. So write the headline
  sentence (the number and what it is a share of) and at most one more short line: one or two short lines in
  all, no bullets, no table. Never describe or promise the chart yourself, never call \`save_query_results\`
  or offer a CSV: no file can be sent here.
- **WhatsApp formatting.** Bold is *single asterisks*; \`backticks\` around figures work as they do in
  Slack. No headings, no tables, no links (WhatsApp shows them raw), no nested lists. Bullets are \`•\`.
- **Short.** Dates as people say them: 12 Jul 2026. When there is nothing to draw (one number, a refusal), the
  whole answer stays under 900 characters.
- **Plain words.** Never a table, column or database name, an id, or how our systems work inside.
- **A clarifying question is answered by a tap.** When you must ask before you count (a rule's
  mandatory question, an \`ambiguous\` word, which schools, which period), end the message with one
  line per question, in exactly this form, and nothing after them:

ASK: <the question, short> | <option> | <option>

  Two to five options, each under 60 characters, each saying what would be counted. An
  \`ambiguous\` entry from \`word_meanings\` keeps its \`question\` and its option labels word for word.
  Keep the message above the ASK lines to one short sentence. The app offers each option as a tap.
- **Leave out the \`NEXT:\` line.** Every answer here carries its own "Ask another" and "Main menu" buttons.
`;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const pyWeekday = (d) => (d.getUTCDay() + 6) % 7; // Python's date.weekday(): Monday = 0

/** [from, to] of the last week that has fully ENDED, on the rules' Saturday-to-Friday boundary. */
function lastCompleteWeek(today) {
  const t = fromIso(today);
  const sinceStart = (((pyWeekday(t) - WEEK_STARTS_ON) % 7) + 7) % 7;
  const end = addDays(t, -(sinceStart + 1));
  return [iso(addDays(end, -6)), iso(end)];
}

/** [from, to] of the last calendar month that has fully ended. */
function lastCompleteMonth(today) {
  const t = fromIso(today);
  const end = addDays(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)), -1);
  return [iso(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))), iso(end)];
}

function windowLines(today) {
  const [wf, wt] = lastCompleteWeek(today);
  const [mf, mt] = lastCompleteMonth(today);
  const rows = [['last week', wf, wt], ['last month', mf, mt], ['the last two weeks', iso(addDays(fromIso(wf), -7)), wt]];
  return rows.map(([name, a, b]) => `- "${name}" = **${a} to ${b}** (inclusive)`).join('\n');
}

function dayIn(moment, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
  }).formatToParts(moment).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
}

/** Today, in both zones, with "last week" etc. already resolved — never cached. */
function todayBlock(now = new Date()) {
  const k = dayIn(now, 'Asia/Karachi');
  const u = dayIn(now, 'UTC');
  const karachi = windowLines(k.date);
  const utc = windowLines(u.date);
  const windows = karachi === utc ? karachi
    : `On the Asia/Karachi day:\n${karachi}\n\nOn the UTC day:\n${utc}\n\n${CONTRACT.pick_one_set}`;
  const text = CONTRACT.today_template
    .replace('{karachi}', `${k.date} (${k.weekday})`)
    .replace('{utc}', `${u.date} (${u.weekday})`)
    .replace('{windows}', windows);
  return { type: 'text', text };
}

/** Their contract (the cache breakpoint), today (uncached on purpose), then what WhatsApp changes. */
function systemBlocks(now = new Date()) {
  return [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    todayBlock(now),
    { type: 'text', text: WHATSAPP_PROMPT },
  ];
}

module.exports = {
  SYSTEM_PROMPT, CONTRACT_VERSION, WHATSAPP_PROMPT,
  lastCompleteWeek, lastCompleteMonth, todayBlock, systemBlocks,
};
