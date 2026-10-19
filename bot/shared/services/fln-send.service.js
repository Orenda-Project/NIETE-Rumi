'use strict';
/**
 * FLN Send to teacher (PR-E): a leader sends a Reading Hour / Numeracy plan to teachers in the leader's own scope.
 *
 * One bot message per recipient. Its button opens the recipient's OWN /go/<token> (app-login-link.js, target
 * `fln:<plan id>` → /portal/fln/p/<id>, fln-go-target.js), so the plan opens inside WhatsApp's browser, signed in.
 *   - inside the recipient's 24 h window: an interactive cta_url (body + button from fln-send.strings.js, filled);
 *   - outside it: the UTILITY template `fln_plan_open_v1` (name from FLN_SEND_TEMPLATE), language `en` | `ur`,
 *     body {{1}} role word, {{2}} plan title; URL button {{1}} = the token (the portal host is fixed in the template).
 * A token is minted for each recipient only, one per recipient and send. sendCtaUrl / sendTemplate return false on
 * a refused send; false and a throw both count as failed.
 *
 * Logs and event rows carry keyed ids only (fln-keys.js): never a phone number, a name, a raw users.id or the token.
 * One `niete_fln_events` row per recipient: {user_key: userKey(the SENDER), kind: 'send', plan_ref,
 * clip: userKey(the RECIPIENT), result: 'sent' | 'failed'}. userKey is m-app's userKeyOf (fln-keys.js), NOT the
 * picker key, so clip joins the recipient's own `open_link` row. A failed event write never fails a send.
 *
 * Scope, the 30-recipient caps and the rate limit are the portal route's job (dashboard/routes/portal-fln-send.routes.js);
 * the bot reaches this through POST /api/internal/fln/send (bot/shared/routes/internal-fln-send.routes.js).
 */
const { FLN_SEND_STRINGS, FLN_SEND_LANG } = require('./fln-send.strings');
const { userKey } = require('./fln-keys');

const DEFAULT_TEMPLATE = 'fln_plan_open_v1';
const TITLE_MAX = 120;

/** Meta refuses a body parameter with a newline, a tab or 4+ spaces: one line, single spaces, ≤120 code points. */
function flattenTitle(title) {
  const flat = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, TITLE_MAX).join('');
}

function packFor(lang) {
  return FLN_SEND_STRINGS[FLN_SEND_LANG[String(lang || '').trim().toLowerCase()] || 'en'];
}

function fill(text, role, title) {
  // Function replacers: a `$&` or `$1` inside a title is text, not a replacement pattern.
  return text.replace('{{1}}', () => role).replace('{{2}}', () => title);
}

function defaultDeps() {
  const AppLink = require('./app-login-link');
  const WhatsAppService = require('./whatsapp.service');
  const { portalUrl } = require('../config/branding');
  const { logToFile } = require('../utils/logger');
  return {
    signToken: (userId, target) => AppLink.signAppLink(userId, target),
    portalOrigin: () => String(portalUrl() || '').replace(/\/+$/, ''),
    hasOpenWindow: (phone) => require('./quiz/quiz-delivery.service')._hasOpenMessageWindow(phone),
    // Called as METHODS: WhatsAppService statics use `this` (the remark-delivery.deps.js pattern).
    sendCtaUrl: (phone, msg) => WhatsAppService.sendCtaUrl(phone, msg),
    sendTemplate: (phone, name, lang, components) => WhatsAppService.sendTemplate(phone, name, lang, components),
    recordEvent: async (row) => {
      const { error } = await require('../config/supabase').from('niete_fln_events').insert(row);
      if (error) throw new Error(error.message || 'insert failed');
    },
    log: (msg, fields, level) => logToFile(msg, fields, level),
    templateName: () => (process.env.FLN_SEND_TEMPLATE || '').trim() || DEFAULT_TEMPLATE,
  };
}

async function sendOne({ teacher, sender, plan, title, target, d }) {
  if (!teacher || !teacher.id || !teacher.phone_number) return { ok: false, via: null, why: 'no_recipient' };
  const origin = d.portalOrigin();
  const token = origin ? d.signToken(teacher.id, target) : null;
  if (!token) return { ok: false, via: null, why: 'no_token' };
  const pack = packFor(teacher.preferred_language);
  const role = pack.roles[String(sender.role || '').trim().toLowerCase()] || pack.roles.coach;
  let inWindow = false;
  try { inWindow = Boolean(await d.hasOpenWindow(teacher.phone_number)); } catch (_) { inWindow = false; }
  if (inWindow) {
    const ok = (await d.sendCtaUrl(teacher.phone_number, {
      body: fill(pack.body, role, title), buttonText: pack.button, url: `${origin}/go/${token}`,
    })) === true;
    return { ok, via: 'cta_url', why: ok ? null : 'send_refused' };
  }
  const ok = (await d.sendTemplate(teacher.phone_number, d.templateName(), pack.templateLang, [
    { type: 'body', parameters: [{ type: 'text', text: role }, { type: 'text', text: title }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
  ])) === true;
  return { ok, via: 'template', why: ok ? null : 'send_refused' };
}

/**
 * @param {{sender:{id:string, role:string, keyedId:string|null}, plan:{id:number|string, title:string, lang?:string},
 *   teachers:Array<{id:string, key:string, phone_number:string|null, preferred_language?:string}>, deps?:object}} args
 * @returns {Promise<{queued:number, failed:string[]}>}
 */
async function sendPlanToTeachers({ sender, plan, teachers, deps } = {}) {
  const d = { ...defaultDeps(), ...(deps || {}) };
  const planRef = String(plan && plan.id);
  const target = `fln:${planRef}`;
  const title = flattenTitle(plan && plan.title);
  const failed = [];
  let queued = 0;
  for (const teacher of teachers || []) {
    let out;
    try {
      out = await sendOne({ teacher, sender: sender || {}, plan, title, target, d });
    } catch (err) {
      out = { ok: false, via: null, why: 'send_threw' };
    }
    if (out.ok) queued += 1; else failed.push(teacher && teacher.key);
    const recipient = (teacher && userKey(teacher.id)) || null;
    try {
      d.log(out.ok ? 'FLN send: delivered to Meta' : 'FLN send: not delivered', {
        sender: (sender && sender.keyedId) || null, plan: planRef, recipient,
        via: out.via, ...(out.why ? { why: out.why } : {}),
      }, out.ok ? 'info' : 'warn');
    } catch (_) { /* logging never decides */ }
    try {
      await d.recordEvent({
        user_key: (sender && sender.keyedId) || null, kind: 'send', plan_ref: planRef,
        clip: recipient, result: out.ok ? 'sent' : 'failed',
      });
    } catch (_) { /* the event row is telemetry; it never fails a send */ }
  }
  return { queued, failed };
}

module.exports = { sendPlanToTeachers, flattenTitle, DEFAULT_TEMPLATE, TITLE_MAX };
