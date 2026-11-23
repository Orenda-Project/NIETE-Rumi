'use strict';
/**
 * A minimal JSON-RPC client for the data team's governed BigQuery MCP: a port of their
 * slackbot/mcp_client.py. The MCP is the ONLY data path here — the governance gate, the serving
 * policy, the cost guard and the audit log all live behind it.
 *
 * Every request says where it comes from (their surface header: `whatsapp`) and, when known, who is
 * asking (their user header), so their audit trail shows each WhatsApp call as that person's. The two
 * header names are theirs, read from the vendored contract. A Bearer token is sent only when
 * DATA_MCP_TOKEN is set: their server runs permissive auth today, and strict mode would need their API
 * token here.
 */

const { mcp_headers: HEADERS } = require('./vendor/data-mcp-contract.json');

const ACCEPT = 'application/json, text/event-stream';
const SURFACE = 'whatsapp';
const DEFAULT_TIMEOUT_MS = 240 * 1000;

class McpError extends Error {
  constructor(message) { super(message); this.name = 'McpError'; }
}

/** The JSON-RPC payload of a server-sent-events body: the last `data:` line that parses. */
function fromEventStream(text) {
  let payload = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try { payload = JSON.parse(line.slice(5).trim()); } catch (_) { /* not this line */ }
  }
  return payload;
}

class McpClient {
  /**
   * @param {{url: string, userEmail?: string, token?: string, surface?: string, timeoutMs?: number,
   *          fetchImpl?: Function}} opts
   */
  constructor({ url, userEmail = '', token = '', surface = SURFACE, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
    this.url = url;
    this.userEmail = userEmail;
    this.token = token;
    // Never empty: an unlabelled audit row reads as a caller nobody can name.
    this.surface = surface || SURFACE;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.nextId = 1;
  }

  headers() {
    const h = { 'Content-Type': 'application/json', Accept: ACCEPT, [HEADERS.surface]: this.surface };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.userEmail) h[HEADERS.user] = this.userEmail;
    return h;
  }

  /** @returns {Promise<string>} the tool's text result */
  async callTool(name, args) {
    const body = { jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args || {} } };
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    if (timer && typeof timer.unref === 'function') timer.unref();
    let resp; let text;
    try {
      resp = await this.fetchImpl(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
      text = await resp.text();
    } catch (e) {
      throw new McpError(`MCP request failed (${e && e.name ? e.name : 'Error'}): ${e && e.message ? e.message : e}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!resp.ok) throw new McpError(`MCP request failed (HTTP ${resp.status})`);
    const type = (resp.headers && typeof resp.headers.get === 'function' && resp.headers.get('content-type')) || '';
    let payload;
    if (type.includes('text/event-stream')) {
      payload = fromEventStream(text);
      if (!payload) throw new McpError('MCP returned an event stream with no JSON-RPC message');
    } else {
      try { payload = JSON.parse(text); } catch (_) { throw new McpError('MCP returned a non-JSON response'); }
    }
    if (payload && payload.error) {
      const m = payload.error.message || JSON.stringify(payload.error);
      throw new McpError(String(m));
    }
    const content = (payload && payload.result && payload.result.content) || [];
    for (const block of content) {
      if (block && block.type === 'text') return block.text || '';
    }
    throw new McpError(`MCP returned no text content for tool '${name}'`);
  }
}

/** A client for this person, from the environment; null when the feature has no MCP url. */
function fromEnv(env = process.env, userEmail = '') {
  const url = String(env.DATA_MCP_URL || '').trim();
  if (!url) return null;
  return new McpClient({
    url,
    userEmail,
    token: String(env.DATA_MCP_TOKEN || '').trim(),
    surface: String(env.DATA_MCP_SURFACE || '').trim() || SURFACE,
  });
}

module.exports = { McpClient, McpError, fromEnv, SURFACE };
