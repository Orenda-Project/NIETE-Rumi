'use strict';
/**
 * The tools the model may call, proxied through our own code: a port of the data team's
 * slackbot/tools.py ToolProxy (the Slack Data-Analyst and their Data Studio both answer through it).
 *
 * Why a proxy and not a direct MCP connection: the proxy is the only place that can (a) force the
 * asker's identity, the surface and the asker's own words onto every audit row and (b) make "read the
 * rules first" a mechanical refusal rather than a prompt instruction. Every refusal text is theirs,
 * verbatim, from the vendored contract, so the model meets the same words it meets in Slack.
 *
 * Their gates, in their order: an auth rejection is terminal; an unknown tool is named, not run; no
 * query before real rule content; nothing after a phone was withheld; a table no rule read names is
 * refused (and INFORMATION_SCHEMA always); hand-written SQL that counts what an offered compiled card
 * counts is turned back once; query_metric blanks are normalised; a rule fetch is served once and the
 * shared policy goes out once; telemetry is stamped by us; a query this person already ran in this
 * conversation is answered with the result they were given.
 *
 * WhatsApp adds two gates of its own: ICT only (region niete-rumi, the NIETE bot's own data), and no
 * file exports (WhatsApp cannot carry their download).
 */

const crypto = require('crypto');
const CONTRACT = require('./vendor/data-mcp-contract.json');
const { metricKey, normaliseSql, exportParts } = require('./memory');

const T = CONTRACT.texts;
const KNOWN = new Set(CONTRACT.tool_schemas.map((t) => t.name));
const QUERY_TOOLS = ['execute_query', 'query_metric'];
const TELEMETRY_TOOLS = new Set(['get_rules', ...QUERY_TOOLS]);
const GATED_TOOLS = new Set([...QUERY_TOOLS, 'save_query_results']);
const METRIC_BLANKS = ['metric', 'definition', 'from_date', 'to_date', 'compare_from', 'compare_to', 'filters', 'by', 'question', 'rule_version', 'program'];
const ICT_PROGRAM = 'niete-rumi';
const SHARED_TABLES = new Set(CONTRACT.shared_tables);
const COMPILED_TABLES = CONTRACT.compiled_tables; // metric -> [own tables], from their ontology
const SCHEMA_VIEWS = 'INFORMATION_SCHEMA';

/** WhatsApp's own refusals (not theirs: their bot has no such surface). */
const ICT_ONLY_REFUSAL = 'REFUSED: on WhatsApp this assistant answers about ICT (Islamabad, region niete-rumi) only. '
  + 'Tell the asker in one plain line that here you can only answer about ICT schools, and stop.';
const NO_FILE_REFUSAL = 'REFUSED: WhatsApp cannot deliver a file, so nothing was exported. Do not offer a download. '
  + 'Tell the asker they are seeing the first rows, and offer a narrower breakdown or filter.';
/** Their EMAIL_DOMAIN_REJECTED_MESSAGE speaks of a Slack account; this is the same refusal for WhatsApp. */
const EMAIL_DOMAIN_REJECTED_MESSAGE = 'REFUSED: the governed data service does not accept the address this WhatsApp '
  + "user's questions are asked as, so it refuses every query for them. This is NOT something rephrasing or narrowing "
  + 'the question will fix: say so plainly, tell the asker their access to the data assistant has to be set up by the '
  + 'data team, and stop.';
/** Region names that resolve to ICT on their side (retired names redirect to niete-rumi). */
const ICT_REGIONS = new Set(['niete-rumi', 'ict-islamabad', 'ict']);
const OTHER_REGION_PATHS = new Set(['rumi', 'rawalpindi', 'moawin-akhuwat', 'myschool', 'taleemhub', 'tbproddb', 'zavia']);

const AUTH = CONTRACT.auth_prefixes;
const AUTH_LABEL = {
  [T.MCP_MISCONFIGURED_MESSAGE]: 'mcp_misconfigured',
  [T.BOT_TOKEN_INVALID_MESSAGE]: 'bot_token_invalid',
  [EMAIL_DOMAIN_REJECTED_MESSAGE]: 'email_domain_rejected',
};

const SQL_COMMENT = /--[^\n]*|\/\*[\s\S]*?\*\//g;
const SQL_STRING = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const SQL_TABLE_REF = /`([\w-]+(?:\.[\w-]+){1,3})`|\b(?:from|join)\s+([a-z_][\w-]*(?:\.[\w-]+){1,3})/gi;
const AGGREGATE = /\b(?:count|sum|avg|countif)\s*\(/i;

const code = (sql) => String(sql || '').replace(SQL_COMMENT, ' ').replace(SQL_STRING, "''");

/** The tables a query reads, by bare name (lower case); a schema view as INFORMATION_SCHEMA. */
function tablesIn(sql) {
  const out = new Set();
  for (const m of code(sql).matchAll(SQL_TABLE_REF)) {
    const parts = (m[1] || m[2]).split('.');
    if (parts.some((p) => p.toUpperCase() === SCHEMA_VIEWS)) out.add(SCHEMA_VIEWS);
    else out.add(parts[parts.length - 1].toLowerCase());
  }
  return out;
}

const counts = (sql) => AGGREGATE.test(code(sql));

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function compiledCards(result) {
  const p = parseJson(result);
  const cards = isObj(p) && isObj(p.word_meanings) ? p.word_meanings.cards : null;
  const out = {};
  for (const c of Array.isArray(cards) ? cards : []) {
    if (isObj(c) && c.compiled === true && c.metric) out[String(c.metric)] = c;
  }
  return out;
}

function figureWords(metric, card) {
  const by = (card.by || []).map(String);
  const detail = card.label ? [String(card.label)] : [];
  if (by.length) detail.push(`by ${by.length > 1 ? `${by.slice(0, -1).join(', ')} or ${by[by.length - 1]}` : by[0]}`);
  const program = String(card.program || '').trim();
  if (program && program !== ICT_PROGRAM) detail.push(`program='${program}'`);
  return `\`${metric}\`${detail.length ? ` (${detail.join('; ')})` : ''}`;
}

function classifyAuthRejection(result) {
  if (typeof result !== 'string') return null;
  if (result.startsWith(AUTH.misconfigured)) return T.MCP_MISCONFIGURED_MESSAGE;
  if (result.startsWith(AUTH.bot_token)) return T.BOT_TOKEN_INVALID_MESSAGE;
  if (result.startsWith(AUTH.email_domain)) return EMAIL_DOMAIN_REJECTED_MESSAGE;
  return null;
}

function hasRuleContent(result) {
  const p = parseJson(result);
  return isObj(p) && Array.isArray(p.rule_files) && p.rule_files.length > 0;
}

function rulesKey(args) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const path = norm(args.path);
  if (path) return `path=${path}`;
  const region = norm(args.region); const domain = norm(args.domain);
  return region || domain ? `region=${region || '(index)'} domain=${domain}` : 'index';
}

function rulesErrored(result) {
  const p = parseJson(result);
  return !isObj(p) || !!p.error;
}

function servedShared(result) {
  const p = parseJson(result);
  return isObj(p) && Array.isArray(p.shared_rules) && p.shared_rules.length > 0;
}

// ---- query_metric arguments (their normalise_filters, _normalise_by, _metric_arguments) ----

function filterValue(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'boolean' || v === null || v === undefined) throw new Error(`a filter value cannot be ${JSON.stringify(v)}.`);
  if (Number.isInteger(v)) return String(v);
  throw new Error(`a filter value must be text or a whole-number id, not ${JSON.stringify(v)}.`);
}

const ENTRY_KEYS = new Set(['name', 'values', 'value']);
const keysWithin = (o, set) => Object.keys(o).every((k) => set.has(k));

function filterPairs(value) {
  if (isObj(value)) {
    if ('name' in value && keysWithin(value, ENTRY_KEYS)) return [[value.name, value.values ?? value.value]];
    if (Object.keys(value).some((k) => ENTRY_KEYS.has(k))) throw new Error('every filter needs a dimension `name` and its `values`.');
    return Object.entries(value);
  }
  if (!Array.isArray(value)) throw new Error(`\`filters\` cannot be ${typeof value}.`);
  const pairs = [];
  for (const item of value) {
    if (isObj(item) && 'name' in item) {
      if (!keysWithin(item, ENTRY_KEYS)) throw new Error(`a filter takes only name and values, not ${JSON.stringify(item)}.`);
      pairs.push([item.name, item.values ?? item.value]);
    } else if (isObj(item) && Object.keys(item).length === 1 && !('values' in item) && !('value' in item)) {
      pairs.push(...Object.entries(item));
    } else if (Array.isArray(item) && item.length === 2) {
      pairs.push([item[0], item[1]]);
    } else {
      throw new Error(`cannot read the filter ${JSON.stringify(item)}.`);
    }
  }
  return pairs;
}

function normaliseFilters(value) {
  let v = value;
  if (typeof v === 'string') {
    if (!v.trim()) return {};
    v = parseJson(v);
    if (v === undefined || typeof v === 'string') throw new Error('`filters` is not a list of {name, values}.');
  }
  if (v === null || v === undefined || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) return {};
  const out = {};
  for (const [name, values] of filterPairs(v)) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('every filter needs a dimension `name`.');
    const kept = (out[name.trim()] = out[name.trim()] || []);
    const given = Array.isArray(values) ? values : (values === null || values === undefined ? [] : [values]);
    for (const g of given) {
      const text = filterValue(g);
      if (text && !kept.includes(text)) kept.push(text);
    }
  }
  return out;
}

function normaliseBy(value) {
  if (value === null || value === undefined || value === '') return [];
  const given = Array.isArray(value) ? value : [value];
  if (!given.every((b) => typeof b === 'string')) throw new Error('`by` is a list of breakdown names.');
  return given.map((b) => b.trim()).filter(Boolean);
}

function metricArguments(args) {
  const out = {};
  for (const key of METRIC_BLANKS) {
    let v = args[key];
    if (key === 'filters') v = normaliseFilters(v);
    else if (key === 'by') v = normaliseBy(v);
    else if (typeof v === 'string') v = v.trim();
    if (key === 'program') v = ICT_PROGRAM; // our side asks every compiled figure as ICT, explicitly (outsideIct refused any other)
    const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
    if (!empty) out[key] = v;
  }
  return out;
}

function withoutFloatNoise(result) {
  const p = parseJson(result);
  if (!isObj(p)) return result;
  const parts = Array.isArray(p.served_with) ? [p, ...p.served_with.filter(isObj)] : [p];
  let changed = false;
  for (const part of parts) {
    for (const row of Array.isArray(part.rows) ? part.rows : []) {
      const v = isObj(row) ? row.change : undefined;
      if (typeof v === 'number' && !Number.isInteger(v)) {
        const tidy = Number(v.toPrecision(12));
        if (tidy !== v) { row.change = tidy; changed = true; }
      }
    }
  }
  return changed ? JSON.stringify(p, null, 2) : result;
}

function policyBlocked(result) {
  const p = parseJson(result);
  return isObj(p) && p.error_class === 'POLICY_BLOCKED';
}

function withheldRefusal(result) {
  const p = parseJson(result);
  if (!(isObj(p) && p.status === 'refused' && p.withheld)) return null;
  return typeof p.metric === 'string' && p.metric ? p.metric : null;
}

function markReused(result) {
  const p = parseJson(result);
  if (!isObj(p)) return result;
  p.reused_from_this_thread = true;
  return JSON.stringify(p);
}

const NON_WORD = /[^0-9a-z]+/g;
const norm = (t) => String(t || '').toLowerCase().replace(NON_WORD, ' ').trim();

/** The `ambiguous` entry this answer asked the colleague (their asked_open_question), or null. */
function askedOpenQuestion(calls, answerText) {
  const text = ` ${norm(answerText)} `;
  if (!text.trim()) return null;
  let asked = null;
  for (const call of calls || []) {
    if (call.name !== 'get_rules') continue;
    const p = parseJson(call.result || '');
    const meanings = isObj(p) ? p.word_meanings : null;
    if (!isObj(meanings)) continue;
    for (const ask of meanings.ambiguous || []) {
      const question = norm(ask.question);
      const labels = (ask.options || []).map((o) => norm(o && o.label));
      const named = labels.filter((l) => l && text.includes(` ${l} `)).length;
      if ((question && text.includes(` ${question} `)) || (labels.length > 0 && named >= Math.min(2, labels.length))) {
        asked = ask.id || asked;
      }
    }
  }
  return asked;
}

class ToolProxy {
  /**
   * @param {{mcp: {callTool: Function, surface?: string}, askedBy: string, question?: string,
   *          surface?: string, memory?: object, log?: Function}} opts
   */
  constructor({ mcp, askedBy, question = '', surface = '', memory = null, log = () => {} }) {
    this.mcp = mcp;
    this.askedBy = askedBy;
    this.question = String(question || '').trim();
    this.surface = surface || (typeof mcp.surface === 'string' && mcp.surface) || 'whatsapp';
    this.memory = memory;
    this.log = log;
    this.turnId = crypto.randomBytes(16).toString('hex');
    this.rulesRead = false;
    this.governedText = '';
    this.authRejectedMessage = null;
    this.records = [];
    this.rulesServed = new Set();
    this.sharedServed = false;
    this.meaningsServed = new Set();
    this.phoneWithheld = false;
    this.compiled = {};
    this.steered = new Set();
  }

  get rulesReady() { return this.rulesRead; }

  get calls() { return this.records.slice(); }

  get authRejected() { return this.authRejectedMessage ? AUTH_LABEL[this.authRejectedMessage] || 'unknown' : null; }

  record(name, args, result) { this.records.push({ name, arguments: args, result }); }

  ungovernedTables(sql) {
    return [...tablesIn(sql)].filter((t) => t === SCHEMA_VIEWS
      || !new RegExp(`(?<![\\w])${t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w])`).test(this.governedText)).sort();
  }

  compiledFirst(sql) {
    if (!Object.keys(this.compiled).length || !counts(sql)) return null;
    if (this.memory && this.memory.lookup(sql, this.askedBy) !== null) return null;
    const tables = tablesIn(sql);
    const hits = Object.keys(this.compiled).filter((m) => (COMPILED_TABLES[m] || []).some((t) => tables.has(t)));
    if (!hits.length || hits.every((m) => this.steered.has(m))) return null;
    hits.forEach((m) => this.steered.add(m));
    this.log('data_analyst.compiled_first_refusal', { metrics: hits });
    return T.COMPILED_FIRST_REFUSAL.replace('{figures}', () => hits.map((m) => figureWords(m, this.compiled[m])).join('; '));
  }

  withoutRepeatedMeanings(result) {
    const p = parseJson(result);
    if (!isObj(p) || !isObj(p.word_meanings)) return result;
    const key = JSON.stringify(p.word_meanings);
    if (!this.meaningsServed.has(key)) { this.meaningsServed.add(key); return result; }
    p.word_meanings = T.WORD_MEANINGS_REPEATED;
    return JSON.stringify(p, null, 2);
  }

  outsideIct(name, args) {
    if (name === 'get_rules') {
      const region = String(args.region || '').trim().toLowerCase();
      if (region && !ICT_REGIONS.has(region)) return true;
      const first = String(args.path || '').trim().toLowerCase().split('/')[0];
      return !!first && OTHER_REGION_PATHS.has(first);
    }
    if (name === 'query_metric') {
      const program = String(args.program || '').trim().toLowerCase();
      return !!program && program !== ICT_PROGRAM;
    }
    return false;
  }

  /** @returns {Promise<string>} what the model reads as the tool's result; never throws */
  async dispatch(name, input) {
    const arguments_ = isObj(input) ? input : {};
    if (this.authRejectedMessage !== null) return this.authRejectedMessage;
    if (!KNOWN.has(name)) return `Unknown tool '${name}'. Available: ${[...KNOWN].sort().join(', ')}.`;

    if (this.outsideIct(name, arguments_)) {
      this.log('data_analyst.ict_only_refusal', { tool: name });
      this.record(name, { ...arguments_ }, ICT_ONLY_REFUSAL);
      return ICT_ONLY_REFUSAL;
    }

    if (GATED_TOOLS.has(name) && !this.rulesRead) {
      this.log('data_analyst.rules_gate_refusal', { tool: name });
      return T.RULES_FIRST_REFUSAL;
    }
    if (name === 'save_query_results') {
      this.record(name, { ...arguments_ }, NO_FILE_REFUSAL);
      return NO_FILE_REFUSAL;
    }
    if (this.phoneWithheld && name === 'execute_query') return T.WITHHELD_PHONE_REFUSAL;

    const sql = name === 'query_metric' ? '' : String(arguments_.sql || '');
    if (GATED_TOOLS.has(name) && sql) {
      const ungoverned = this.ungovernedTables(sql);
      if (ungoverned.length) {
        this.log('data_analyst.ungoverned_table_refusal', { tool: name, tables: ungoverned });
        return T.UNGOVERNED_TABLE_REFUSAL.replace('{tables}', () => ungoverned.map((t) => `\`${t}\``).join(', '));
      }
    }
    if (name === 'execute_query') {
      const steer = this.compiledFirst(sql);
      if (steer !== null) { this.record(name, { ...arguments_ }, steer); return steer; }
    }

    let args;
    if (name === 'query_metric') {
      try { args = metricArguments(arguments_); } catch (e) {
        this.log('data_analyst.metric_arguments_refused', {});
        // Theirs is a Python format string: `{{`/`}}` are literal braces, `{detail}` the blank.
        return T.METRIC_ARGUMENTS_REFUSAL.replace(/\{\{/g, '{').replace(/\}\}/g, '}').replace('{detail}', () => e.message);
      }
    } else {
      args = { ...arguments_ };
    }

    if (name === 'get_rules') {
      // Our side always means ICT (the operator, 21 Nov: "always assume the region is Islamabad and always niete"):
      // a fetch naming no region and no file asks for niete-rumi, never the bare index, which carries no word meanings.
      if (!String(args.path || '').trim() && !String(args.region || '').trim()) args.region = ICT_PROGRAM;
      const key = rulesKey(args);
      if (this.rulesServed.has(key)) {
        const note = T.ALREADY_FETCHED.replace('{what}', () => key);
        this.record(name, args, note);
        return note;
      }
      args.include_shared = !this.sharedServed;
      delete args.open_question;
      const asked = this.memory && typeof this.memory.openQuestion === 'function' ? this.memory.openQuestion() : null;
      if (asked) args.open_question = asked;
    }

    if (TELEMETRY_TOOLS.has(name)) {
      args.asked_by = this.askedBy;
      args.surface = this.surface;
      args.turn_id = this.turnId;
      if (this.question) args.question = this.question;
    }

    let queryKey = null;
    if (QUERY_TOOLS.includes(name) && this.memory && !args.dry_run) {
      queryKey = name === 'query_metric' ? metricKey(args) : (args.sql || '');
      const earlier = this.memory.lookup(queryKey, this.askedBy);
      if (earlier !== null) {
        this.log('data_analyst.thread_result_reused', { tool: name });
        const result = markReused(earlier);
        if (name === 'query_metric') this.noteWithheld(result);
        this.record(name, args, result);
        return result;
      }
    }

    let result;
    try {
      result = await this.mcp.callTool(name, args);
    } catch (e) {
      this.log('data_analyst.tool_failed', { tool: name, error: String(e && e.message).slice(0, 300) });
      return `Tool '${name}' failed: ${(e && e.name) || 'Error'}: ${(e && e.message) || e}`;
    }

    if (name === 'get_rules') {
      Object.assign(this.compiled, compiledCards(result));
      result = this.withoutRepeatedMeanings(result);
    }
    if (name === 'query_metric') {
      result = withoutFloatNoise(result);
      this.noteWithheld(result);
      this.phoneWithheld = this.phoneWithheld || policyBlocked(result);
    }
    this.record(name, args, result);
    if (queryKey !== null) this.memory.remember(queryKey, this.askedBy, this.question, result);

    const classified = classifyAuthRejection(result);
    if (classified !== null) {
      this.authRejectedMessage = classified;
      this.log('data_analyst.auth_rejected', { tool: name, reason: AUTH_LABEL[classified] });
      return classified;
    }

    if (name === 'get_rules') {
      if (!rulesErrored(result)) this.rulesServed.add(rulesKey(args));
      if (servedShared(result)) this.sharedServed = true;
      if (hasRuleContent(result)) {
        this.rulesRead = true;
        this.governedText += `\n${String(result).toLowerCase()}`;
        if (this.memory && !rulesErrored(result)) this.memory.rememberRules(args);
      }
    }
    return result;
  }

  noteWithheld(result) {
    const metric = withheldRefusal(result);
    if (metric !== null && !this.steered.has(metric)) this.steered.add(metric);
  }

  /** Fetch the rules this conversation already read, before the model's first step (their preload_rules). */
  async preloadRules(fetches) {
    const parts = [];
    for (const fetch of fetches || []) {
      const result = await this.dispatch('get_rules', { ...fetch });
      if (rulesErrored(result) || !hasRuleContent(result)) continue;
      parts.push(`### get_rules: ${rulesKey(fetch)}\n\n${result}`);
    }
    return parts.length ? T.PRELOADED_RULES_HEADER + parts.join('\n\n') : '';
  }
}

module.exports = {
  ToolProxy, askedOpenQuestion, tablesIn, normaliseFilters, exportParts, normaliseSql,
  ICT_ONLY_REFUSAL, NO_FILE_REFUSAL, EMAIL_DOMAIN_REJECTED_MESSAGE,
};
