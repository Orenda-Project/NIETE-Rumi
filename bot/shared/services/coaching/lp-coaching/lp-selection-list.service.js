/**
 * LP Selection List Builder
 *
 * Builds the WhatsApp interactive list for selecting a lesson plan
 * to link to a coaching session. Falls back to Yes/No buttons
 * when the teacher has no recent LPs.
 *
 * Bead: (Phase 1C-D)
 */

const { logToFile } = require('../../../utils/logger');

// bd-zrlcp — WhatsApp accepts at most 10 rows TOTAL across all sections of an
// interactive list. whatsapp.service.js enforces that itself: over the cap it
// logs a warning and returns FALSE without ever contacting Meta, so the prompt
// simply vanishes. The Options section always contributes 2 rows, which leaves
// 8 for recent lesson plans. Exceeding it does not truncate — it drops the whole
// message, and the caller had already moved the session to awaiting_lesson_plan,
// stranding it there (20 sessions on the morning of 2026-08-27).
const WHATSAPP_MAX_LIST_ROWS = 10;
const OPTION_ROWS = 2;
const MAX_LP_ROWS = WHATSAPP_MAX_LIST_ROWS - OPTION_ROWS;

/**
 * Truncate a string to maxLen, appending '...' if truncated.
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Build either an interactive list (if recent LPs exist) or
 * fallback Yes/No buttons for LP selection.
 *
 * @param {string} coachingSessionId - Session UUID
 * @param {Array<{id: string, topic: string, grade: string, created_at: string}>} recentLPs
 * @param {string} language - User's language (en, ur, etc.)
 * @param {string} [region] - User's region (drives the coach-role footer
 *   label: "Human Coach" for ICT / NIETE, "Rumi Digital Coach" as default).
 * @returns {{ type: 'list'|'buttons', listData?: object, body?: string, buttons?: Array }}
 */
function buildLPSelectionList(coachingSessionId, recentLPs, language = 'en', region) {
  const isUrdu = language === 'ur';
  // bd-wa5io — `region` no longer drives the footer: coachRoleLabelForRegion()
  // is HITL observe-card branding (env DEFAULT_COACH_ROLE_LABEL="Human Coach")
  // and this menu is teacher-facing DC UI. Param kept for call-site stability.
  void region;

  // The 2-row Yes/No prompt. It is what a teacher with no recent LPs is sent, AND
  // the fallback carried on every list payload — 2 rows always fit, so it is the
  // one prompt that can never be refused. Built once so the two cannot drift.
  const yesNoPrompt = {
    type: 'buttons',
    body: isUrdu
      ? 'کیا آپ کے پاس اس کلاس کا سبق کا منصوبہ ہے؟'
      : 'Do you have a lesson plan for this class?',
    buttons: [
      { id: `lessonplan_yes_${coachingSessionId}`, title: isUrdu ? 'ہاں' : 'Yes' },
      { id: `lessonplan_no_${coachingSessionId}`, title: isUrdu ? 'نہیں' : 'No' },
    ],
  };

  // Fallback: no recent LPs → simple Yes/No buttons
  if (!recentLPs || recentLPs.length === 0) {
    return yesNoPrompt;
  }

  // Build interactive list rows from recent LPs. The label mirrors the delivery caption a teacher
  // saw when she GENERATED the LP — topic headline + "Grade · Ch·Day · pages · recency" (D25, Option A)
  // — so a heavy generator recognises her own plan. formatLpRow enforces code-point caps (Urdu-safe).
  const { formatLpRow } = require('./lp-selection-format');
  // Only the 8 most recent fit alongside the 2 option rows (bd-zrlcp).
  const lpRows = recentLPs.slice(0, MAX_LP_ROWS).map((lp) => {
    const f = formatLpRow(lp);
    return {
      id: `lp_select_${lp.id}_${coachingSessionId}`,
      title: f.title,
      description: f.description,
    };
  });

  // Options section: Upload new + No LP
  const optionRows = [
    {
      id: `lp_upload_${coachingSessionId}`,
      title: isUrdu ? 'نیا اپلوڈ کریں' : 'Upload new',
      description: isUrdu ? 'اپنا سبق کا منصوبہ بھیجیں' : 'Send your lesson plan document',
    },
    {
      id: `lp_none_${coachingSessionId}`,
      title: isUrdu ? 'نہیں' : 'No lesson plan',
      description: isUrdu ? 'بغیر سبق کے جاری رکھیں' : 'Continue without a lesson plan',
    },
  ];

  const listData = {
    header: { type: 'text', text: isUrdu ? 'سبق کا منصوبہ' : 'Lesson Plan' },
    body: {
      text: isUrdu
        ? 'کیا آپ اپنا حالیہ سبق کا منصوبہ منسلک کرنا چاہیں گے؟ درس کے تجزیے کو بہتر بنائے گا۔'
        : 'Would you like to link a recent lesson plan? It improves the analysis.',
    },
    footer: {
      // bd-wa5io — this menu is TEACHER-facing Digital-Coach UI. It previously
      // sourced its footer from coachRoleLabelForRegion(), whose live env
      // default (DEFAULT_COACH_ROLE_LABEL="Human Coach") is the HITL
      // observe-card branding — so teachers saw a confusing "Human Coach"
      // footer on their own coaching flow. Always the DC label, localised.
      text: isUrdu ? 'NIETE ڈیجیٹل کوچ' : 'NIETE Digital Coach',
    },
    action: {
      button: isUrdu ? 'منتخب کریں' : 'Select',
      sections: [
        {
          title: 'Recent Lesson Plans',
          rows: lpRows,
        },
        {
          title: 'Options',
          rows: optionRows,
        },
      ],
    },
  };

  logToFile('LP selection list built', {
    coachingSessionId,
    lpCount: recentLPs.length,
    shown: lpRows.length,
    language,
  });

  // `fallback` travels with the list so sendLpPrompt can recover without needing
  // the session id or language again (bd-zrlcp).
  return { type: 'list', listData, fallback: yesNoPrompt };
}

module.exports = { buildLPSelectionList };
