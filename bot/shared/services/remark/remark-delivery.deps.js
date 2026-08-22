/**
 * bd-2712 — the live wiring for remark-delivery.service :: submitRemark().
 *
 * submitRemark destructures SEVEN collaborators out of `deps` with no defaults,
 * and until now nothing in the repo built them — the retry worker borrows three
 * helpers from that module and re-implements generation itself, so submitRemark
 * had zero callers. This file is that missing half.
 *
 * Kept separate from the service so the service stays pure and unit-testable
 * (the whole reason it takes deps), and separate from the endpoint so the same
 * wiring can be reused by the retry worker later. It is NOT reused there yet —
 * the worker has its own loadScores/markNarrative/send, which is duplication
 * worth collapsing but not inside this change.
 *
 * `principal` is closed over deliberately: submitRemark's sendToPrincipal
 * callback receives scores and totals but NOT who to send them to.
 */

const { logToFile } = require('../../utils/logger');
const { templateCodeFor } = require('../../config/languages');
const { clampLanguage } = require('../../config/ux-strings');

function db() {
  return require('../../config/supabase');
}

/**
 * bd-43519 — the out-of-window fallback.
 *
 * Free-form text is only accepted within 24h of the teacher's last inbound
 * message. A principal works through her whole roster in one sitting, so most
 * of the teachers she scores are cold — their note was rejected by Meta, the
 * remark was left deliveryPending, and nothing drains that state (the retry
 * worker is scheduled nowhere, and would fail against the same closed window).
 *
 * A UTILITY template is accepted outside the window. Everything except the
 * teacher's name and the four narrative sections is FIXED, pre-approved text in
 * the template itself, so the variable surface is as small as the message allows.
 */
const TEACHER_TEMPLATE = 'remark_teacher_feedback_v1';

/**
 * Meta rejects a body parameter containing a newline, a tab, or 4+ consecutive
 * spaces — and rejects the WHOLE send, not just the offending parameter. The
 * narrative sections are single paragraphs today, so this is belt-and-braces
 * against a model that decides to add a line break.
 */
function flattenParam(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * The teacher's copy: narrative prose, NO numbers.
 *
 * Joined in the fixed order the narrative shape declares. sendMessage is called
 * as a METHOD — it is a static that does `this._removeEmotionTags(...)` on its
 * first line, so a detached reference throws before reaching Meta (bd-2711).
 */
function narrativeBody(narrative) {
  return [narrative.opening, narrative.strengths, narrative.growth, narrative.action_plan]
    .filter(Boolean)
    .join('\n\n');
}

function makeDeliveryDeps({ principal, teacherLabelFor }) {
  return {
    /**
     * Already done. The endpoint marks the submission durable BEFORE it answers
     * Meta, because submitRemark itself runs after the response (the ~10s
     * data_exchange budget). Leaving persistSubmission to run post-response
     * would put the one irreplaceable write on the wrong side of a process that
     * may be killed — and a remark with scores but no submitted_at is invisible
     * to the retry worker's `.not('submitted_at','is',null)` filter, i.e.
     * silently stuck forever.
     */
    persistSubmission: async () => true,

    loadScores: async (remarkId) => {
      const { data, error } = await db()
        .from('supervisor_remark_scores')
        .select('indicator_ordinal, score')
        .eq('remark_id', remarkId);
      if (error) throw new Error(`remark-deps: loadScores failed — ${error.message}`);
      // The column is indicator_ordinal; computeS reads `ordinal` and throws on
      // anything else. Returning the rows raw threw above submitRemark's two
      // try/catch blocks, so it took the narrative, the teacher's note AND the
      // principal's confirmation with it — while the scores still saved and the
      // principal still saw SUCCESS. The retry worker has always mapped here.
      return (data || []).map((r) => ({ ordinal: r.indicator_ordinal, score: r.score }));
    },

    loadTeacher: async (teacherId) => {
      const { data, error } = await db()
        .from('users')
        .select('id, first_name, phone_number, preferred_language')
        .eq('id', teacherId)
        .maybeSingle();
      if (error) throw new Error(`remark-deps: loadTeacher failed — ${error.message}`);
      return data || null;
    },

    generateNarrative: (input) =>
      require('./remark-narrative.service').generateRemarkNarrative(input),

    sendToTeacher: async ({ teacher, narrative, language }) => {
      if (!teacher || !teacher.phone_number) {
        throw new Error('remark-deps: teacher has no phone_number');
      }
      const WhatsAppService = require('../whatsapp.service');
      // Free-form FIRST: it is free, carries no approval coupling, and renders
      // the note exactly as written. The template is the out-of-window path only.
      const ok = await WhatsAppService.sendMessage(teacher.phone_number, narrativeBody(narrative));
      // sendMessage swallows its own failures and returns false — trusting the
      // absence of a throw is exactly how /remark read as healthy while sending
      // nothing (bd-2711). A false here must become the caller's deliveryPending.
      if (ok !== false) return ok;

      // 'en_US', never 'en'. Meta's template codes are locale-shaped and a send
      // asking for 'en' hard-fails against an en_US-approved template with no
      // fallback — so the code comes from the language registry, not from here.
      //
      // clampLanguage rather than `|| 'en'`: it is total (junk and null return the
      // floor) AND intersected with this deployment's offer, so an off-offer value
      // grandfathered into a users row cannot ask Meta for a template that was
      // never submitted. It also keeps the English floor in ONE place instead of
      // minting a second one here.
      const lang = clampLanguage((teacher && teacher.preferred_language) || language);
      const templateCode = templateCodeFor(lang);
      logToFile('↩️ remark: free-form refused, trying the UTILITY template', {
        teacherId: teacher.id, templateCode,
      });
      const sent = await WhatsAppService.sendTemplate(
        teacher.phone_number, TEACHER_TEMPLATE, templateCode,
        [{
          type: 'body',
          parameters: [
            teacher.first_name || 'Teacher',
            narrative.opening, narrative.strengths, narrative.growth, narrative.action_plan,
          ].map((text) => ({ type: 'text', text: flattenParam(text) })),
        }],
      );
      if (sent === false) {
        throw new Error('remark-deps: teacher delivery failed — free-form and template both refused');
      }
      return sent;
    },

    /**
     * The principal's copy: keeps the numbers. She authored the scores, so
     * showing them back is the confirmation that her work landed.
     */
    sendToPrincipal: async ({ remarkId, teacherId, s_score, s_pct, narrativePending, deliveryPending }) => {
      const WhatsAppService = require('../whatsapp.service');
      const who = teacherLabelFor ? teacherLabelFor(teacherId) : 'the teacher';
      const lines = [`Saved — ${who}: ${s_score}/20 (${s_pct}%).`];
      if (narrativePending) lines.push('Her coaching note is still being written; she will get it shortly.');
      else if (deliveryPending) lines.push('Her coaching note is saved but could not be delivered yet — it will retry.');
      else lines.push('Her coaching note has been sent. It carries no scores.');

      const ok = await WhatsAppService.sendMessage(principal.phone_number, lines.join('\n\n'));
      if (ok === false) {
        logToFile('⚠️ remark-deps: principal confirmation not delivered', { remarkId, teacherId });
      }
      return ok;
    },

    markNarrative: async (remarkId, patch) => {
      const { error } = await db()
        .from('supervisor_remarks')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', remarkId);
      if (error) throw new Error(`remark-deps: markNarrative failed — ${error.message}`);
      return true;
    },
  };
}

module.exports = { makeDeliveryDeps, narrativeBody, flattenParam, TEACHER_TEMPLATE };
