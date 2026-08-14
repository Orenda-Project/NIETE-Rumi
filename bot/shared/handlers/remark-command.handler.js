/**
 * bd-2531 — /remark command handler (STEPS "S" Supervisor Remark).
 *
 * The entry point that makes the feature reachable. Mirrors
 * observe-command.handler.js: returns handled?=true/false so a non-match falls
 * through to normal chat — teacher behaviour provably unchanged.
 *
 * Decision order (from remark-gate.js, capability BEFORE cycle):
 *   no user      → "I don't know this number yet"
 *   no capability→ "this is for principals"
 *   no cycle     → "evaluations aren't open right now"
 *   otherwise    → her school roster, with per-teacher progress
 *
 * Each refusal is a DIFFERENT sentence. "Nothing happened" is the worst outcome
 * for a principal on a phone, and "wrong person" vs "wrong time" are things she
 * can act on differently. An unauthorised user gets the SAME answer whether or
 * not a cycle is open, so the window state never leaks.
 *
 * Rule 20 — every string here exists in en AND ur. English is the floor for
 * anything else; there is no partial map.
 */

const { logToFile, logError } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { REMARK_TRIGGER_RX } = require('../services/remark/remark-gate');
const { CAPABILITIES } = require('../services/authz/capability');

const STRINGS = {
  en: {
    no_account: "I don't recognise this number yet. Send me a message first so I can set you up.",
    role_denied: 'Teacher evaluations are for principals. If you are a principal and see this, contact NIETE support.',
    no_cycle: "Teacher evaluations aren't open right now. Your NIETE team opens a window each quarter — I'll let you know.",
    no_teachers: 'I could not find any teachers linked to your school yet. Contact NIETE support so we can set that up.',
    error: 'Something went wrong on my side. Please try again in a moment.',
    header: (cycle) => `*Teacher evaluations — ${cycle}*\n\nReply with a number to start or continue.`,
    done: 'done',
    in_progress: (n) => `${n}/5 answered`,
    not_started: 'not started',
  },
  ur: {
    no_account: 'میں اس نمبر کو ابھی نہیں پہچانتا۔ پہلے مجھے پیغام بھیجیں تاکہ میں آپ کا اکاؤنٹ بنا سکوں۔',
    role_denied: 'اساتذہ کا جائزہ صرف پرنسپل کے لیے ہے۔ اگر آپ پرنسپل ہیں تو NIETE سپورٹ سے رابطہ کریں۔',
    no_cycle: 'اساتذہ کا جائزہ ابھی کھلا نہیں ہے۔ آپ کی NIETE ٹیم ہر سہ ماہی میں یہ کھولتی ہے — میں آپ کو بتا دوں گا۔',
    no_teachers: 'آپ کے اسکول سے منسلک کوئی استاد نہیں ملا۔ براہِ کرم NIETE سپورٹ سے رابطہ کریں۔',
    error: 'میری طرف سے کچھ مسئلہ ہو گیا۔ براہِ کرم تھوڑی دیر بعد کوشش کریں۔',
    header: (cycle) => `*اساتذہ کا جائزہ — ${cycle}*\n\nشروع کرنے یا جاری رکھنے کے لیے نمبر بھیجیں۔`,
    done: 'مکمل',
    in_progress: (n) => `${n}/5 مکمل`,
    not_started: 'شروع نہیں ہوا',
  },
};

/** preferred_language only — never `user.language` (dead column, Rule 20). */
function strings(user) {
  const lang = user && user.preferred_language;
  return STRINGS[lang] || STRINGS.en;
}

/**
 * Render the roster: every teacher in her school, with where she left off.
 * The progress marks come from the score rows themselves — this is the
 * session-free resume made visible ("Bilal — 3/5 answered").
 */
function buildRoster(teachers, progress, S, cycleName) {
  const lines = teachers.map((t, i) => {
    const p = progress[t.id] || {};
    let status;
    if (p.state === 'done') status = `✅ ${S.done}`;
    else if (p.state === 'in_progress') status = `▶️ ${S.in_progress(p.answered || 0)}`;
    else status = `⬜ ${S.not_started}`;
    return `${i + 1}. ${t.first_name} — ${status}`;
  });
  return `${S.header(cycleName)}\n\n${lines.join('\n')}`;
}

/**
 * @param {object|null} user users row
 * @param {string} from WhatsApp sender phone
 * @param {string} messageBody trimmed inbound text
 * @param {object} deps injected for testability
 * @returns {Promise<boolean>} handled?
 */
async function handleRemarkCommand(user, from, messageBody, deps = {}) {
  if (!REMARK_TRIGGER_RX.test((messageBody || '').trim())) return false;

  const {
    hasCapability = require('../services/authz/capability').hasCapability,
    getActiveCycle = require('../services/remark/remark-cycle.repository').getActiveCycle,
    listSchoolTeachers = require('../services/remark/remark-cycle.repository').listSchoolTeachers,
    getProgress = require('../services/remark/remark-cycle.repository').getProgress,
    // bd-2711 — MUST stay a method call. `WhatsAppService.sendMessage` is a
    // STATIC method whose first line is `this._removeEmotionTags(message)`, so
    // destructuring it (`.sendMessage` into a bare reference) drops `this` and
    // every send throws TypeError before reaching the Graph API. That shipped:
    // /remark was silent on staging AND prod from the first commit, while still
    // logging "roster sent". Wrapped rather than bound at module load so the
    // require stays lazy — whatsapp.service pulls in r2.js → @aws-sdk.
    sendMessage = (to, text) => require('../services/whatsapp.service').sendMessage(to, text),
    // Same static-method binding rule as sendMessage above (bd-2711) — sendFlow
    // is also a static on WhatsAppService.
    sendFlow = (to, flowData) => require('../services/whatsapp.service').sendFlow(to, flowData),
  } = deps;

  const S = strings(user);

  if (!user) {
    await sendMessage(from, S.no_account);
    return true;
  }

  // Capability BEFORE cycle: an unauthorised user must never learn whether an
  // evaluation window is open on their school.
  if (!(await hasCapability(user, CAPABILITIES.REMARK_AUTHOR))) {
    logToFile('🚫 /remark denied (capability)', { userId: user.id });
    await sendMessage(from, S.role_denied);
    return true;
  }

  let cycle;
  try {
    cycle = await getActiveCycle();
  } catch (err) {
    logToFile('❌ /remark: cycle lookup failed', { userId: user.id, error: err.message });
    await sendMessage(from, S.error);
    return true;
  }
  if (!cycle) {
    await sendMessage(from, S.no_cycle);
    return true;
  }

  try {
    const teachers = await listSchoolTeachers(user);
    if (!teachers || teachers.length === 0) {
      await sendMessage(from, S.no_teachers);
      return true;
    }

    // bd-2712 — the Flow is the real surface. Presence-gated on REMARK_FLOW_ID
    // (feature-availability convention): when the Flow has not been published to
    // this WABA yet, fall through to the plain-text roster below so behaviour is
    // never WORSE than before this change.
    //
    // flowToken is the bare user id — whatsapp-flows rule 3. No `screen`, so
    // sendFlow chooses data_exchange mode and Meta calls INIT on our endpoint,
    // which builds the roster server-side.
    const { REMARK_FLOW_ID } = require('../utils/constants');
    if (REMARK_FLOW_ID) {
      const sentFlow = await sendFlow(from, {
        flowId: REMARK_FLOW_ID,
        flowToken: user.id,
        header: resolveUx('remarkFlowHeader', { user }),
        body: resolveUx('remarkFlowBody', { user, params: { cycle: cycle.name } }),
        buttonText: resolveUx('remarkFlowButton', { user }),
      });
      if (sentFlow !== false) {
        logToFile('📝 /remark flow sent', {
          userId: user.id, cycleId: cycle.id, teachers: teachers.length,
        });
        return true;
      }
      // Send failed — say so loudly and fall back to the text roster rather than
      // leaving her with silence (the bd-2711 failure mode).
      logError('❌ /remark: flow send FAILED — falling back to text roster', {
        userId: user.id, cycleId: cycle.id, flowId: REMARK_FLOW_ID,
      });
    }

    const progress = await getProgress(user.id, cycle.id);
    // bd-2711 — sendMessage RETURNS false on failure (it catches its own
    // exceptions), so an unconditional success log reports a delivery that
    // never happened. That is how a totally silent /remark read as healthy in
    // Axiom for four days. Trust the return value, and log the failure at
    // ERROR so it reaches the error-level monitor.
    const delivered = await sendMessage(from, buildRoster(teachers, progress || {}, S, cycle.name));
    if (delivered === false) {
      logError('❌ /remark: roster send FAILED — principal got nothing', {
        userId: user.id, cycleId: cycle.id, teachers: teachers.length,
      });
    } else {
      logToFile('📝 /remark roster sent', {
        userId: user.id, cycleId: cycle.id, teachers: teachers.length,
      });
    }
  } catch (err) {
    // Degrade to a message; never drop silently. A principal who gets no reply
    // assumes the feature is broken and stops trying.
    logToFile('❌ /remark: roster failed', { userId: user.id, error: err.message });
    await sendMessage(from, S.error);
  }
  return true;
}

module.exports = { handleRemarkCommand, buildRoster, STRINGS };
