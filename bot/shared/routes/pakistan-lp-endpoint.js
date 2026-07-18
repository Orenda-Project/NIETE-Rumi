/**
 * Pakistan Lesson Plan Flow Endpoint (FEAT-059)
 *
 * Screens: SPEC → SELECT_GRADE → SELECT_SUBJECT → SELECT_TOPIC → SUCCESS
 *
 * Mirrors the shape of `student-videos-endpoint.js`. Lets a teacher pick
 * Grade → Subject → Topic (chapter) from the `pre_generated_lps` corpus
 * seeded for `curriculum='pakistan'`, then delivers the PDF (and voicenote
 * if one exists at the convention path) into the WhatsApp chat.
 *
 * The Flow only surfaces PRIMARY rows (curriculum='pakistan'). The
 * method-comparison corpus (`curriculum='pakistan_methods'`) is queryable
 * directly via PreGenLookupService for A/B/C/D method-study workflows but
 * is not exposed here to keep the picker uncluttered.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { downloadFromR2 } = require('../storage/r2');
const WhatsAppService = require('../services/whatsapp.service');

const CURRICULUM_TAG = 'pakistan';

// Grade ordering — 1..9 ascending. Any grades outside the current corpus
// are still shown (helpful when the corpus grows) but sorted last.
const gradeRank = (g) => {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) ? n : 99;
};
const gradeTitle = (g) => `Grade ${g}`;

async function fetchRows(filter = {}) {
  let q = supabase
    .from('pre_generated_lps')
    .select('id,grade,subject,chapter_number,chapter_title,pdf_r2_key_en,pdf_r2_key_ur,generation_status')
    .eq('curriculum', CURRICULUM_TAG)
    .eq('is_current', true);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) {
    logToFile('Pakistan LP: supabase error', { error: error.message, filter });
    return [];
  }
  // Only rows with a usable PDF (either language) are deliverable.
  return (data || []).filter((r) => r.generation_status === 'completed' && (r.pdf_r2_key_en || r.pdf_r2_key_ur));
}

function distinct(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter((v) => v != null && v !== ''))];
}

async function getPhoneForUser(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('users')
    .select('phone_number,preferred_language')
    .eq('id', userId)
    .single();
  return data || null;
}

// ---------- INIT ----------
async function handlePakistanLpInit(flowToken) {
  logToFile('Pakistan LP Flow INIT', { flowToken });
  // Two-hop: SPEC (welcome) → SELECT_GRADE. We return SPEC data (nothing
  // dynamic) so the welcome screen is fully self-contained. SELECT_GRADE
  // populates via data_exchange on the "Continue" click.
  return {
    screen: 'SPEC',
    data: {
      welcome_title: 'Ready-Made Lesson Plans',
      welcome_body: 'Pick your class, subject, and chapter. I will send the lesson plan PDF to your chat.',
    },
  };
}

// ---------- DATA EXCHANGE ----------
async function handlePakistanLpDataExchange(flowToken, screen, screenData) {
  logToFile('Pakistan LP data_exchange', { flowToken, screen, screenData });
  if (screen === 'SPEC')            return openGradePicker();
  if (screen === 'SELECT_GRADE')    return selectGrade(screenData);
  if (screen === 'SELECT_SUBJECT')  return selectSubject(screenData);
  if (screen === 'SELECT_TOPIC')    return selectTopic(flowToken, screenData);
  logToFile('Pakistan LP: unknown screen', { screen });
  return { data: { error: { message: 'Something went wrong.' } } };
}

// SPEC → SELECT_GRADE: build the grade dropdown from live rows.
async function openGradePicker() {
  const rows = await fetchRows();
  const grades = distinct(rows, 'grade')
    .sort((a, b) => gradeRank(a) - gradeRank(b))
    .map((g) => ({ id: String(g), title: gradeTitle(g) }));
  if (grades.length === 0) {
    return {
      screen: 'SELECT_GRADE',
      data: {
        grades: [],
        error: { message: 'The lesson plan library is being prepared. Please try again later.' },
      },
    };
  }
  return { screen: 'SELECT_GRADE', data: { grades } };
}

// SELECT_GRADE → SELECT_SUBJECT
async function selectGrade(screenData) {
  const grade = screenData && screenData.grade;
  if (!grade) return { data: { error: { message: 'Please select a class.' } } };
  const rows = await fetchRows({ grade: parseInt(grade, 10) });
  const subjects = distinct(rows, 'subject')
    .sort()
    .map((s) => ({ id: s, title: s }));
  if (subjects.length === 0) {
    return { data: { error: { message: `No lesson plans available for ${gradeTitle(grade)} yet.` } } };
  }
  return {
    screen: 'SELECT_SUBJECT',
    data: { subjects, grade_value: String(grade), grade_display: gradeTitle(grade) },
  };
}

// SELECT_SUBJECT → SELECT_TOPIC
async function selectSubject(screenData) {
  const grade = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  if (!grade || !subject) return { data: { error: { message: 'Please select a subject.' } } };
  const rows = await fetchRows({ grade: parseInt(grade, 10), subject });
  if (rows.length === 0) {
    return { data: { error: { message: `No ${subject} lesson plans for ${gradeTitle(grade)} yet.` } } };
  }
  rows.sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
  const topics = rows.map((r) => ({
    id: String(r.id),
    title: r.chapter_title
      ? `Ch ${r.chapter_number}: ${r.chapter_title}`
      : `Chapter ${r.chapter_number}`,
  }));
  return {
    screen: 'SELECT_TOPIC',
    data: {
      topics,
      grade_value: String(grade),
      subject_value: subject,
      header_text: `${gradeTitle(grade)} — ${subject}`,
    },
  };
}

// SELECT_TOPIC → SUCCESS
async function selectTopic(flowToken, screenData) {
  const grade = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  const topicId = screenData && screenData.topic;
  if (!grade || !subject || !topicId) {
    return { data: { error: { message: 'Please pick a chapter.' } } };
  }
  const { data: row, error } = await supabase
    .from('pre_generated_lps')
    .select('id,grade,subject,chapter_number,chapter_title,pdf_r2_key_en,pdf_r2_key_ur')
    .eq('id', topicId)
    .single();
  if (error || !row || (!row.pdf_r2_key_en && !row.pdf_r2_key_ur)) {
    logToFile('Pakistan LP: row lookup failed', { topicId, error: error?.message });
    return { data: { error: { message: 'That lesson plan is not available right now.' } } };
  }

  await sendPreDeliveryAck(flowToken, row);
  deliverLpAsync(flowToken, row);

  return {
    screen: 'SUCCESS',
    data: {
      message: `Your lesson plan "${row.chapter_title || `Chapter ${row.chapter_number}`}" (${gradeTitle(row.grade)} ${row.subject}) is on its way!`,
    },
  };
}

// Immediate chat ack while the R2 download + Meta media upload happens.
async function sendPreDeliveryAck(flowToken, row) {
  const userId = (flowToken || '').split(':')[0];
  try {
    const user = await getPhoneForUser(userId);
    if (!user?.phone_number) return;
    await WhatsAppService.sendMessage(
      user.phone_number,
      `📘 Sending your lesson plan: ${gradeTitle(row.grade)} ${row.subject} — ${row.chapter_title || `Chapter ${row.chapter_number}`}…`
    );
  } catch (err) {
    logToFile('Pakistan LP: pre-delivery ack failed', { error: err.message });
  }
}

// Fire-and-forget deliver: PDF first, then best-effort voicenote if the
// convention path `<pdf_stem>.ogg` exists in R2. Missing voicenote is
// non-fatal — teachers still get the PDF.
function deliverLpAsync(flowToken, row) {
  const userId = (flowToken || '').split(':')[0];
  (async () => {
    let phone;
    try {
      const user = await getPhoneForUser(userId);
      phone = user?.phone_number;
      if (!phone) {
        logToFile('Pakistan LP: no phone for user', { userId });
        return;
      }
      const language = user?.preferred_language === 'ur' ? 'ur' : 'en';
      const r2Key = (language === 'ur' && row.pdf_r2_key_ur)
        ? row.pdf_r2_key_ur
        : (row.pdf_r2_key_en || row.pdf_r2_key_ur);
      const filename = `${row.chapter_title || `Chapter ${row.chapter_number}`} — ${row.subject}.pdf`.replace(/["<>?*|\\/]/g, '');

      // PDF
      let tmpPath;
      try {
        const buf = await downloadFromR2(r2Key);
        tmpPath = path.join(os.tmpdir(), `pakistan_lp_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
        fs.writeFileSync(tmpPath, buf);
        await WhatsAppService.sendDocument(phone, tmpPath, filename);
        logToFile('Pakistan LP: PDF delivered', { userId, topicId: row.id, r2Key });
      } finally {
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } }
      }

      // Voicenote (optional — convention path <same-stem>.ogg)
      const voicenoteKey = r2Key.replace(/\.pdf$/i, '.ogg');
      try {
        // sendVoicenoteFromR2Key handles the missing-key case itself and
        // returns falsy; wrap in try/catch anyway for defensive parity.
        await WhatsAppService.sendVoicenoteFromR2Key(phone, voicenoteKey);
      } catch (vnErr) {
        logToFile('Pakistan LP: voicenote skip (non-fatal)', { userId, voicenoteKey, error: vnErr.message });
      }
    } catch (err) {
      logToFile('Pakistan LP: delivery failed', { userId, topicId: row.id, error: err.message });
    }
  })();
}

// Back navigation: reopen the grade picker (equivalent to reopening the Flow).
async function handlePakistanLpBack(flowToken, screen) {
  return openGradePicker();
}

module.exports = {
  handlePakistanLpInit,
  handlePakistanLpDataExchange,
  handlePakistanLpBack,
  // exported for tests
  gradeTitle,
  gradeRank,
  CURRICULUM_TAG,
};
