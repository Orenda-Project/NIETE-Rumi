#!/usr/bin/env node
/**
 * flow-emulator — plays Meta's side of a WhatsApp Flow from its stored FLOW_JSON.
 *
 * The WhatsApp client is the part of a Flow nobody can run locally: it renders screens, holds form
 * state, resolves `${data.x}` / `${form.x}` bindings, walks the routing model, and — for endpoint
 * Flows — encrypts every screen submit to the bot's `/api/flows/<path>` and decrypts the answer.
 * This module does exactly that much, from the JSON `flow-inventory.js` stored, and no more:
 *
 *   · it does NOT render pixels, so a "pass" here is `via: flow-emulator`, never a rendering pass;
 *   · a component it does not model (PhotoPicker …) is REFUSED at open, never faked;
 *   · a transition the routing model forbids is refused (`ROUTING_REFUSED`), like the client;
 *   · the data-exchange transport is byte-for-byte the client's contract — RSA-OAEP(SHA-256) wrapped
 *     AES-128-GCM request, flipped-IV AES-GCM response — proven in tests against the bot's own
 *     flow-encryption.service.js.
 *
 * Probe shape mirrors the browser helper (flow-lib.cjs): { screen, text, items:[{text, disabled, kind, name}] }.
 */
'use strict';
const crypto = require('crypto');

const TEXT_TYPES = new Set(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption', 'RichText']);
const FIELD_TYPES = new Set(['TextInput', 'TextArea', 'Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'OptIn', 'CalendarPicker', 'DatePicker']);
const OPTION_TYPES = new Set(['Dropdown', 'RadioButtonsGroup', 'CheckboxGroup']);
const SUPPORTED = new Set([...TEXT_TYPES, ...FIELD_TYPES, 'Form', 'Footer', 'EmbeddedLink', 'NavigationList', 'If', 'Switch', 'Image']);

// ── bindings ─────────────────────────────────────────────────────────────────
/** Resolve `${data.x}` / `${form.x}` / `${screen.S.form.x}` against the current state. A string that
 *  is ONLY a binding resolves to the bound VALUE (arrays, booleans…); mixed text interpolates. */
function resolve(v, ctx) {
  if (Array.isArray(v)) return v.map((x) => resolve(x, ctx));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k], ctx); return o; }
  if (typeof v !== 'string') return v;
  const whole = /^\$\{([^}]+)\}$/.exec(v.trim());
  if (whole) return lookup(whole[1].trim(), ctx);
  return v.replace(/\$\{([^}]+)\}/g, (_, p) => { const r = lookup(p.trim(), ctx); return r == null ? '' : (typeof r === 'object' ? JSON.stringify(r) : String(r)); });
}
function lookup(pathExpr, ctx) {
  const parts = pathExpr.split('.');
  let root;
  if (parts[0] === 'data') root = ctx.data;
  else if (parts[0] === 'form') root = ctx.form;
  else if (parts[0] === 'screen' && parts.length > 2) { root = (ctx.screens[parts[1]] || {}); parts.splice(0, 2); if (parts[0] === 'form') { root = root.form || {}; parts.shift(); } else if (parts[0] === 'data') { root = root.data || {}; parts.shift(); } return dig(root, parts); }
  else return undefined;
  return dig(root, parts.slice(1));
}
const dig = (o, parts) => parts.reduce((acc, k) => (acc == null ? undefined : acc[k]), o);
const truthy = (v) => v === true || v === 'true' || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== 'false');

// ── transport: the client's encryption, against the bot's endpoint ───────────
class FlowTransport {
  /** @param {{publicKeyPem:string, fetch?:Function}} opts — the PUBLIC half of the keypair whose private half the bot holds. */
  constructor(opts) {
    if (!opts || !opts.publicKeyPem) throw new Error('FlowTransport needs publicKeyPem (the bot decrypts with the matching FLOW_PRIVATE_KEY)');
    this.publicKeyPem = opts.publicKeyPem; this.fetch = opts.fetch || globalThis.fetch;
  }
  encrypt(payload) {
    const aesKey = crypto.randomBytes(16), iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const encKey = crypto.publicEncrypt({ key: this.publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
    return { body: { encrypted_flow_data: ct.toString('base64'), encrypted_aes_key: encKey.toString('base64'), initial_vector: iv.toString('base64') }, aesKey, iv };
  }
  decrypt(b64, aesKey, iv) {
    const flipped = Buffer.from(iv.map((b) => b ^ 0xff));
    const buf = Buffer.from(b64, 'base64');
    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, flipped);
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString('utf8'));
  }
  /** One round trip. Returns the DECRYPTED response object; throws on transport/HTTP failure. */
  async exchange(url, payload) {
    const { body, aesKey, iv } = this.encrypt(payload);
    const res = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`ENDPOINT_HTTP_${res.status}:${text.slice(0, 200)}`);
    return this.decrypt(text.trim(), aesKey, iv);
  }
}

// ── the emulator ─────────────────────────────────────────────────────────────
function createEmulator(flowJson, opts) {
  const o = Object.assign({ action: 'navigate', screen: null, data: null, flowId: 'unknown', flowToken: '', onComplete: null, onExchange: null }, opts || {});
  const screensById = Object.fromEntries((flowJson.screens || []).map((s) => [s.id, s]));
  const routing = flowJson.routing_model || {};
  const st = { open: false, screen: null, data: {}, form: {}, screens: {}, log: [], pending: null };
  const settle = async () => { const p = st.pending; st.pending = null; return p ? p : { ok: true }; };

  const screenDef = () => screensById[st.screen];
  const ctx = () => ({ data: st.data, form: st.form, screens: st.screens });

  /** Walk visible components of the current screen, in order, resolving bindings. */
  function components(screen = screenDef()) {
    const out = [];
    const walk = (nodes, inForm) => {
      for (const c of nodes || []) {
        if (!c || typeof c !== 'object') continue;
        if (c.type && !SUPPORTED.has(c.type)) throw new Error('UNSUPPORTED_COMPONENT:' + c.type);
        if (c.visible !== undefined && !truthy(resolve(c.visible, ctx()))) continue;
        if (c.type === 'If') { walk(truthy(resolve(c.condition, ctx())) ? c.then : c.else, inForm); continue; }
        if (c.type === 'Switch') { const v = String(resolve(c.value, ctx())); walk((c.cases || {})[v] || [], inForm); continue; }
        if (c.type === 'Form') {
          // init-values prefill the form once per screen visit
          if (c['init-values'] && !st.form.__init) { const iv = resolve(c['init-values'], ctx()); for (const k of Object.keys(iv)) if (st.form[k] === undefined && iv[k] !== undefined) st.form[k] = iv[k]; st.form.__init = true; }
          walk(c.children, true); continue;
        }
        out.push(c);
        if (c.children) walk(c.children, inForm);
      }
    };
    walk(screen.layout && screen.layout.children);
    return out;
  }
  const optionsOf = (c) => (resolve(c['data-source'], ctx()) || []).map((x) => ({ id: x.id, title: x.title, description: x.description, enabled: x.enabled !== false }));
  const label = (c) => resolve(c.label, ctx());
  function requiredUnmet() {
    return components().filter((c) => FIELD_TYPES.has(c.type) && truthy(resolve(c.required, ctx())) && c.name && (st.form[c.name] === undefined || st.form[c.name] === '' || (Array.isArray(st.form[c.name]) && !st.form[c.name].length)));
  }

  function probe() {
    if (!st.open) return { screen: null, text: '', items: [] };
    const texts = [], items = [];
    const s = screenDef();
    if (s.title) texts.push(String(s.title));
    const unmet = requiredUnmet().length > 0;
    for (const c of components()) {
      if (TEXT_TYPES.has(c.type)) { const t = resolve(c.text, ctx()); if (t != null && t !== '') texts.push(Array.isArray(t) ? t.join('\n') : String(t)); }
      else if (OPTION_TYPES.has(c.type)) { const l = label(c); if (l) texts.push(String(l)); for (const op of optionsOf(c)) { const row = op.description ? `${op.title} · ${op.description}` : op.title; items.push({ text: row, title: op.title, hay: row, disabled: !op.enabled, kind: 'option', name: c.name, id: op.id }); } }
      else if (c.type === 'TextInput' || c.type === 'TextArea' || c.type === 'CalendarPicker' || c.type === 'DatePicker') items.push({ text: label(c) || c.name, disabled: false, kind: 'input', name: c.name, value: st.form[c.name] });
      else if (c.type === 'OptIn') items.push({ text: label(c) || c.name, disabled: false, kind: 'optin', name: c.name, value: !!st.form[c.name] });
      else if (c.type === 'EmbeddedLink') items.push({ text: resolve(c.text, ctx()), disabled: false, kind: 'link', action: c['on-click-action'] });
      else if (c.type === 'NavigationList') for (const it of resolve(c['list-items'], ctx()) || []) {
        // `text` is the row's title (what a probe reports); `hay` is EVERY string on the row — the
        // browser helper clicks whatever text it finds, and scripts tap a description ("Day 1 · p.2").
        const mc = it['main-content'] || {};
        const title = mc.title || it.title || it.id;
        items.push({ text: title, hay: [title, mc.description, mc.metadata, it.description].filter(Boolean).join('\n'), disabled: it.enabled === false, kind: 'nav', id: it.id, action: it['on-click-action'] || c['on-click-action'] });
      }
      else if (c.type === 'Footer') items.push({ text: label(c), disabled: unmet || truthy(resolve(c.enabled === undefined ? false : !c.enabled, ctx())), kind: 'footer', action: c['on-click-action'] });
    }
    // `text` mirrors the browser dialog's innerText: the rows and options are on screen too, so a
    // script asserting on the screen text reads the same thing on both lanes.
    for (const i of items) texts.push(i.hay || String(i.text || ''));
    return { screen: st.screen, text: texts.join('\n'), items };
  }

  const norm = (s) => String(s || '').trim().toLowerCase();
  function findItem(text, { exact = false, kinds = null } = {}) {
    const want = norm(text);
    return probe().items.find((i) => (!kinds || kinds.includes(i.kind)) && (exact ? norm(i.text) === want : (norm(i.text).includes(want) || norm(i.hay).includes(want))));
  }

  function enterScreen(id, data) {
    if (!screensById[id]) throw new Error('NO_SCREEN:' + id);
    if (st.screen) st.screens[st.screen] = { form: { ...st.form }, data: st.data };
    st.screen = id; st.data = data || {}; st.form = {};
    st.log.push({ screen: id });
    components();   // validates component support + applies init-values
  }

  /** The endpoint call every data_exchange / INIT makes. Applies {screen,data} or surfaces an error. */
  async function exchange(payload, action = 'data_exchange') {
    if (!o.transport || !o.endpointUrl) return { ok: false, err: 'NO_ENDPOINT:this Flow is data_exchange but no transport/endpointUrl was given' };
    const req = { version: '3.0', action, flow_token: o.flowToken, ...(action === 'data_exchange' ? { screen: st.screen, data: payload || {} } : {}) };
    let res;
    try { res = await o.transport.exchange(o.endpointUrl, req); } catch (e) { return { ok: false, err: 'ENDPOINT_FAILED:' + e.message.slice(0, 160) }; }
    if (o.onExchange) o.onExchange(req, res);
    if (res && res.data && (res.data.error || res.data.error_message)) return { ok: false, err: 'ENDPOINT_ERROR:' + (res.data.error_message || res.data.error) };
    if (res && res.screen) {
      if (st.screen && routing[st.screen] && !routing[st.screen].includes(res.screen) && res.screen !== st.screen) return { ok: false, err: `ROUTING_REFUSED:${st.screen}→${res.screen}` };
      enterScreen(res.screen, res.data || {});
      return { ok: true, screen: res.screen };
    }
    if (res && res.data) { st.data = { ...st.data, ...res.data }; return { ok: true, screen: st.screen }; }
    return { ok: false, err: 'ENDPOINT_RESPONSE_SHAPE:' + JSON.stringify(res).slice(0, 120) };
  }

  async function runAction(action) {
    if (!action || !action.name) return { ok: false, err: 'NO_ACTION' };
    const payload = resolve(action.payload || {}, ctx());
    if (action.name === 'navigate') {
      const next = action.next && action.next.name;
      if (!next) return { ok: false, err: 'NAVIGATE_NO_TARGET' };
      if (!(routing[st.screen] || []).includes(next)) return { ok: false, err: `ROUTING_REFUSED:${st.screen}→${next}` };
      enterScreen(next, { ...(st.data || {}), ...payload });
      return { ok: true, screen: next };
    }
    if (action.name === 'data_exchange') return exchange(payload, 'data_exchange');
    if (action.name === 'complete') {
      const params = (st.data && st.data.extension_message_response && st.data.extension_message_response.params) || null;
      const response_json = Object.keys(payload).length ? payload : (params || {});
      const done = { flowId: o.flowId, flowToken: o.flowToken, name: `flow_${o.flowId}`, response_json };
      st.open = false; st.log.push({ complete: response_json });
      if (o.onComplete) await o.onComplete(done);
      return { ok: true, completed: done };
    }
    if (action.name === 'open_url') return { ok: true, url: resolve(action.url, ctx()) };
    return { ok: false, err: 'UNKNOWN_ACTION:' + action.name };
  }

  return {
    async open() {
      st.open = true;
      if (o.action === 'data_exchange') {
        const r = await exchange(null, 'INIT');
        if (!r.ok) { st.open = false; throw new Error('FLOW_INIT_FAILED:' + r.err); }
      } else {
        const first = o.screen || (flowJson.screens[0] && flowJson.screens[0].id);
        enterScreen(first, o.data || {});
      }
      return probe();
    },
    isOpen: () => st.open,
    probe,
    /** Click a footer / link / nav item by (substring, case-insensitive) text — like flow-lib.clickText. */
    async click(text, opts = {}) {
      if (!st.open) return { ok: false, err: 'FLOW_CLOSED' };
      await settle();
      // Tapping a Dropdown / radio group's LABEL opens the picker on the phone; the options are
      // already in the probe here, so it is a successful no-op — scripts do this before picking.
      const want = norm(text);
      const field = components().find((c) => OPTION_TYPES.has(c.type) && norm(label(c)) && (opts.exact ? norm(label(c)) === want : norm(label(c)).includes(want)));
      if (field && !findItem(text, { exact: !!opts.exact, kinds: ['footer', 'link', 'nav', 'optin'] })) return { ok: true, clicked: String(label(field)) };
      // Footer/link/nav first (an action), then an option (a selection) — the browser helper clicks
      // whichever element carries the text, so scripts drive lists with flowClick as well as flowPick.
      const it = findItem(text, { exact: !!opts.exact, kinds: ['footer', 'link', 'nav', 'optin'] }) || findItem(text, { exact: !!opts.exact, kinds: ['option'] });
      if (!it) return { ok: false, err: 'NO_ITEM:' + text, seen: probe().items.map((i) => i.text) };   // what WAS on screen
      if (it.disabled) return { ok: false, err: 'DISABLED:' + it.text };
      if (it.kind === 'option') { const r = this.pick(it.text, { exact: true }); if (!r.ok) return r; const a = await settle(); return a.ok ? { ok: true, clicked: it.text } : a; }
      if (it.kind === 'optin') { st.form[it.name] = !st.form[it.name]; return { ok: true, clicked: it.text }; }
      if (it.kind === 'nav' && !it.action) return { ok: false, err: 'NAV_NO_ACTION:' + it.text };
      if (it.kind === 'nav' && it.id) st.form.__nav = it.id;
      const r = await runAction(it.action);
      // Same shape as flow-lib.clickText: {ok, clicked}. Where the click took the Flow is read
      // back through probe(); a completion is delivered through onComplete.
      return r.ok ? { ok: true, clicked: it.text } : r;
    },
    /** Select an option of a Dropdown / RadioButtonsGroup / CheckboxGroup by title — like flow-lib.pickOption. */
    pick(want, opts = {}) {
      if (!st.open) return { ok: false, err: 'FLOW_CLOSED' };
      const it = findItem(want, { exact: !!opts.exact, kinds: ['option'] });
      if (!it) return { ok: false, err: 'OPTION_ABSENT:' + want };
      if (it.disabled) return { ok: false, err: 'OPTION_DISABLED:' + it.text };
      const c = components().find((x) => x.name === it.name);
      if (c && c.type === 'CheckboxGroup') { const cur = Array.isArray(st.form[it.name]) ? st.form[it.name] : []; st.form[it.name] = cur.includes(it.id) ? cur.filter((x) => x !== it.id) : [...cur, it.id]; }
      else st.form[it.name] = it.id;
      // A component whose selection IS the submit (Teacher Training's module picker): run its
      // on-select-action now; settle()/click() await it, exactly as the phone submits on select.
      const sel = c && c['on-select-action'];
      if (sel && sel.name) { st.log.push({ select: it.name, id: it.id }); st.pending = runAction(sel); }
      return { ok: true, picked: it.text };
    },
    /** Type into the first EMPTY text input (or the one named/labelled in opts.field). */
    type(text, opts = {}) {
      if (!st.open) return { ok: false, err: 'FLOW_CLOSED' };
      const inputs = probe().items.filter((i) => i.kind === 'input');
      const target = opts.field ? inputs.find((i) => norm(i.name) === norm(opts.field) || norm(i.text) === norm(opts.field)) : inputs.find((i) => i.value === undefined || i.value === '');
      if (!target) return { ok: false, err: 'NO_EMPTY_INPUT' };
      st.form[target.name] = text;
      return { ok: true, typed: text };   // same shape as the browser api's flowType
    },
    /** The state of a button by label regex — like the browser api's flowState. */
    state(labelRe) {
      if (!st.open) return { found: false };
      const re = labelRe instanceof RegExp ? labelRe : new RegExp(labelRe, 'i');
      const it = probe().items.find((i) => i.kind === 'footer' && re.test(i.text));
      return it ? { found: true, text: it.text, disabled: it.disabled } : { found: false };
    },
    exchange,
    settle,
    close() { st.open = false; },
    log: () => st.log.slice(),
    _debugSetScreen(id) { st.screen = id; st.data = st.data || {}; },
  };
}

module.exports = { createEmulator, FlowTransport, resolve, SUPPORTED };
