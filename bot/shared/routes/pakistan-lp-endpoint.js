/**
 * Pakistan Lesson Plan Flow Endpoint (FEAT-059 / FEAT-109)
 *
 * v2 screens: SELECT_GRADE → SELECT_SUBJECT → SELECT_CHAPTER → SELECT_TOPIC → SUCCESS
 * (v1's SPEC welcome screen was removed for FEAT-109; teachers land directly
 *  on the grade picker.)
 *
 * Grade routing (FEAT-109 iter 3):
 *   - Grades 1–5  → pre_generated_lps rows where curriculum='pakistan'
 *                    (the primary-curriculum corpus). Delivery: R2 presigned URL
 *                    + sendDocumentByLink (Palestine pattern, bd-2054).
 *   - Grades 6–10 → lesson_plan_catalog rows where source='oxbridge'.
 *                    Delivery: OxbridgeLpService.deliverOxbridgeLp — plain
 *                    text chunked send + PDF rendered from content_html.
 *
 * Grade dropdown is STATIC 1..10 (not filtered by DB coverage); grades that
 * have no corpus surface a friendly "no LPs yet" message on the subject screen.
 *
 * Topic IDs carry a source prefix ("PK-<uuid>" or "OX-<bigint>") so
 * SELECT_TOPIC → SUCCESS knows which delivery pipeline to call.
 *
 * FEAT-059 v3 (bd-fg3p4): grades 1-5 now serve the K-5 **v8** corpus through
 * NavigationList screens with a SELECT_LESSON step — the teacher picks the
 * actual day's lesson (section · topic · pages), with a ✓/○ tick showing what
 * she has already downloaded. Availability comes from niete_lp_assets, so a
 * lesson appears the moment its PDF is uploaded: no code change, no Flow
 * republish, no deploy.
 *
 * Grades 6-10 are UNCHANGED — FEAT-080's Oxbridge picker is live with 70 LPs
 * and keeps its own lookup and its own delivery pipeline.
 *
 * Three id prefixes keep the pipelines unambiguous: V8- (v8 corpus),
 * PK- (legacy pre_generated_lps), OX- (Oxbridge). Unprefixed = legacy PK.
 *
 * Dispatch is on payload.step (the storybooks NavigationList pattern), with a
 * fallback to screen-based routing: the deploy order is endpoint first, THEN
 * Flow republish (Meta health-probes the endpoint before allowing publish), so
 * for a window this endpoint serves the OLD v2 Flow, whose payloads have no step.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const WhatsAppService = require('../services/whatsapp.service');
const OxbridgeLpService = require('../services/oxbridge-lp.service');
const { clampLanguage } = require('../config/ux-strings');
const V8Catalog = require('../services/lp-v8-catalog.service');
const V8Delivery = require('../services/lp-v8-delivery.service');

const CURRICULUM_TAG = 'pakistan';
const STATIC_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const OXBRIDGE_MIN_GRADE = 6;

const gradeTitle = (g) => `Grade ${g}`;
const gradeRank = (g) => {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) ? n : 99;
};
const isOxbridgeGrade = (g) => {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) && n >= OXBRIDGE_MIN_GRADE && n <= 12;
};

// ─── Pakistan pre-gen source helpers ────────────────────────────────────

async function fetchPakistanRows(filter = {}) {
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
  return (data || []).filter((r) => r.generation_status === 'completed' && (r.pdf_r2_key_en || r.pdf_r2_key_ur));
}

// ─── Oxbridge catalog source helpers ────────────────────────────────────

async function fetchOxbridgeRows(filter = {}) {
  let q = supabase
    .from('lesson_plan_catalog')
    .select('id,grade,subject,chapter_title,description,content_html')
    .eq('source', 'oxbridge')
    .eq('is_active', true);
  if (filter.grade) q = q.eq('grade', filter.grade);           // e.g. 'Grade Six'
  if (filter.subject) q = q.eq('subject', filter.subject);
  if (filter.chapter_title) q = q.eq('chapter_title', filter.chapter_title);
  const { data, error } = await q;
  if (error) {
    logToFile('Oxbridge LP: catalog lookup failed', { error: error.message, filter });
    return [];
  }
  return data || [];
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

// ─── INIT ───────────────────────────────────────────────────────────────

async function handlePakistanLpInit(flowToken) {
  logToFile('Pakistan LP Flow INIT', { flowToken });
  return openGradePicker();
}

const isV8Grade = (g) => {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) && n >= 1 && n <= V8Catalog.V8_MAX_GRADE;
};

// ─── DATA EXCHANGE dispatcher ───────────────────────────────────────────

async function handlePakistanLpDataExchange(flowToken, screen, screenData) {
  const d = screenData || {};
  const step = d.step;
  logToFile('Pakistan LP data_exchange', { flowToken, screen, step });

  // v3 Flow: every NavigationList row carries its own step, so routing never
  // depends on which screen Meta says we are on.
  if (step === 'grade')       return selectGrade(d);
  if (step === 'subject')     return selectSubject(d);
  if (step === 'chapter')     return selectChapter(flowToken, d);
  if (step === 'lesson')      return selectLesson(flowToken, d);
  if (step === 'lesson_page') return selectLessonPage(flowToken, d);

  // v2 Flow fallback — payloads carry a screen but no step. Live during the
  // endpoint-deployed-but-Flow-not-yet-republished window.
  if (screen === 'SELECT_GRADE')    return selectGrade(d);
  if (screen === 'SELECT_SUBJECT')  return selectSubject(d);
  if (screen === 'SELECT_CHAPTER')  return selectChapter(flowToken, d);
  if (screen === 'SELECT_TOPIC')    return selectTopic(flowToken, d);

  logToFile('Pakistan LP: unroutable data_exchange', { screen, step });
  return { data: { error: { message: 'Something went wrong.' } } };
}

// Static 1..10 grade dropdown — surface all grades even where the DB is
// still empty; the subject screen shows a friendly message if no LPs exist.
async function openGradePicker() {
  // `items` is what the v3 NavigationList binds; `grades` is kept so a still-
  // published v2 Flow (Dropdown-bound) does not render an empty screen during
  // the deploy window.
  return {
    screen: 'SELECT_GRADE',
    data: {
      items: V8Catalog.buildGradeItems(STATIC_GRADES),
      grades: STATIC_GRADES.map((g) => ({ id: String(g), title: gradeTitle(g) })),
    },
  };
}

// SELECT_GRADE → SELECT_SUBJECT
// Grade 1–5: subjects from pre_generated_lps.
// Grade 6–10: subjects from lesson_plan_catalog (Oxbridge).
async function selectGrade(screenData) {
  const gradeStr = screenData && screenData.grade;
  if (!gradeStr) return { data: { error: { message: 'Please select a class.' } } };
  const grade = parseInt(gradeStr, 10);

  // ── v8 corpus (grades 1-5), with the LEGACY corpus as the fallback ────
  // Grades 1-5 are served by pre_generated_lps TODAY. Until the v8 uploader has
  // run there are zero niete_lp_assets rows, so replacing this path outright
  // would take the LP menu away from every K-5 teacher on deploy. v8 wins where
  // it has content; where it does not, the legacy path answers exactly as before.
  if (isV8Grade(grade)) {
    const available = await V8Delivery.availableLessonIds();
    const items = V8Catalog.buildSubjectItems(grade, available);
    if (items.length) {
      return {
        screen: 'SELECT_SUBJECT',
        data: { items, grade_value: String(grade), grade_display: gradeTitle(grade) },
      };
    }
    logToFile('Pakistan LP: no v8 assets for grade — falling back to pre_generated_lps', { grade });
  }

  let subjects = [];
  if (isOxbridgeGrade(grade)) {
    const gword = OxbridgeLpService.gradeWord(grade);
    if (!gword) return { data: { error: { message: `Grade ${grade} lesson plans are being prepared.` } } };
    const rows = await fetchOxbridgeRows({ grade: gword });
    subjects = distinct(rows, 'subject').sort().map((s) => ({ id: s, title: s }));
  } else {
    const rows = await fetchPakistanRows({ grade });
    subjects = distinct(rows, 'subject').sort().map((s) => ({ id: s, title: s }));
  }

  if (subjects.length === 0) {
    return { data: { error: { message: `No lesson plans available for ${gradeTitle(grade)} yet. Try another class or check back soon.` } } };
  }
  return {
    screen: 'SELECT_SUBJECT',
    data: {
      items: asNavItems(subjects, 'subject', { grade: String(grade) }, () => `${gradeTitle(grade)} lesson plans`),
      subjects,
      grade_value: String(grade),
      grade_display: gradeTitle(grade),
    },
  };
}

// SELECT_SUBJECT → SELECT_CHAPTER
async function selectSubject(screenData) {
  const gradeStr = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  if (!gradeStr || !subject) return { data: { error: { message: 'Please select a subject.' } } };
  const grade = parseInt(gradeStr, 10);

  // ── v8 corpus (grades 1-5), legacy fallback — see selectGrade ─────────
  if (isV8Grade(grade)) {
    const available = await V8Delivery.availableLessonIds();
    const items = V8Catalog.buildChapterItems(grade, subject, available);
    if (items.length) {
      return {
        screen: 'SELECT_CHAPTER',
        data: {
          items,
          grade_value: String(grade),
          subject_value: subject,
          header_text: `${gradeTitle(grade)} — ${subject}`,
        },
      };
    }
    logToFile('Pakistan LP: no v8 chapters — falling back to pre_generated_lps', { grade, subject });
  }

  let chapters = [];
  if (isOxbridgeGrade(grade)) {
    const gword = OxbridgeLpService.gradeWord(grade);
    const rows = await fetchOxbridgeRows({ grade: gword, subject });
    // Oxbridge doesn't have chapter_number — use chapter_title as the id (URL-safe would be nice but Meta Flow only cares about string).
    chapters = distinct(rows, 'chapter_title').sort().map((title) => ({ id: title, title: title }));
  } else {
    const rows = await fetchPakistanRows({ grade, subject });
    const seen = new Set();
    rows.sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0)).forEach((r) => {
      const key = String(r.chapter_number);
      if (seen.has(key)) return;
      seen.add(key);
      chapters.push({
        id: key,
        title: r.chapter_title
          ? `Ch ${r.chapter_number}: ${r.chapter_title.replace(/\s*\(chapter reading — full LP pending\)\s*$/, '')}`
          : `Chapter ${r.chapter_number}`,
      });
    });
  }

  if (chapters.length === 0) {
    return { data: { error: { message: `No ${subject} lesson plans for ${gradeTitle(grade)} yet.` } } };
  }
  return {
    screen: 'SELECT_CHAPTER',
    data: {
      items: asNavItems(chapters, 'chapter', { grade: String(grade), subject }),
      chapters,
      grade_value: String(grade),
      subject_value: subject,
      header_text: `${gradeTitle(grade)} — ${subject}`,
    },
  };
}

// SELECT_CHAPTER → SELECT_TOPIC
// Topic IDs are prefixed: "PK-<uuid>" or "OX-<bigint>" so SELECT_TOPIC
// knows which delivery path to call.
async function selectChapter(flowToken, screenData) {
  const gradeStr = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  const chapter = screenData && screenData.chapter;
  if (!gradeStr || !subject || !chapter) {
    return { data: { error: { message: 'Please pick a chapter.' } } };
  }
  const grade = parseInt(gradeStr, 10);

  // ── v8 corpus (grades 1-5), legacy fallback — see selectGrade ─────────
  if (isV8Grade(grade)) {
    const v8 = await v8LessonScreen(flowToken, grade, subject, chapter, 1, 'SELECT_LESSON');
    if (v8 && v8.screen) return v8;
    logToFile('Pakistan LP: no v8 lessons — falling back to pre_generated_lps', { grade, subject, chapter });
  }

  let topics = [];
  let chapterHeader = chapter;
  if (isOxbridgeGrade(grade)) {
    const gword = OxbridgeLpService.gradeWord(grade);
    const rows = await fetchOxbridgeRows({ grade: gword, subject, chapter_title: chapter });
    topics = rows.map((r) => {
      const extracted = OxbridgeLpService.extractTopicFromDescription(r.description);
      return {
        id: `OX-${r.id}`,
        title: extracted || r.chapter_title || `LP #${r.id}`,
      };
    });
    chapterHeader = chapter;
  } else {
    const rows = await fetchPakistanRows({ grade, subject, chapter_number: parseInt(chapter, 10) });
    const chapterTitleClean = (rows[0]?.chapter_title || `Chapter ${chapter}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
    topics = rows.map((r) => ({
      id: `PK-${r.id}`,
      title: rows.length === 1 ? 'Full Chapter Lesson Plan' : (r.chapter_title || `Chapter ${r.chapter_number}`),
    }));
    chapterHeader = `Ch ${chapter}: ${chapterTitleClean}`;
  }

  if (topics.length === 0) {
    return { data: { error: { message: 'No lesson plan for that chapter yet.' } } };
  }
  // v3 renames this screen to SELECT_LESSON (the routing model has no
  // SELECT_TOPIC), but the item ids keep their OX-/PK- prefixes so the delivery
  // pipeline is unchanged.
  return {
    screen: 'SELECT_LESSON',
    data: {
      items: asNavItems(topics, 'lesson'),
      topics,
      grade_value: String(grade),
      subject_value: subject,
      chapter_value: String(chapter),
      header_text: `${gradeTitle(grade)} ${subject} · ${chapterHeader}`,
    },
  };
}


/**
 * Wrap a legacy {id,title} option list as NavigationList items.
 *
 * The v3 Flow binds ${data.items} on every selection screen, so the Oxbridge
 * (6-12) branches have to speak that shape too — otherwise FEAT-080's live
 * picker renders an EMPTY screen on the new Flow. The legacy key is kept
 * alongside so a still-published v2 Flow keeps working during the deploy window.
 */
function asNavItems(options, step, basePayload = {}, meta = () => undefined) {
  return options.slice(0, V8Catalog.PAGE_SIZE).map((o) => {
    const item = {
      id: String(o.id),
      'main-content': {
        title: V8Catalog.clip(o.title, V8Catalog.TITLE_CAP),
      },
      'on-click-action': {
        name: 'data_exchange',
        payload: { step, ...basePayload, [step]: String(o.id) },
      },
    };
    const m = meta(o);
    if (m) item['main-content'].metadata = V8Catalog.clip(m, V8Catalog.META_CAP);
    return item;
  });
}

// ─── v8 lesson screen + delivery (grades 1-5) ───────────────────────────

const userIdFrom = (flowToken) => String(flowToken || '').split(':')[0];

/**
 * Build a SELECT_LESSON (or SELECT_LESSON_MORE) screen for one chapter.
 * The ✓/○ tick is per-teacher, so this needs the flow token.
 */
async function v8LessonScreen(flowToken, grade, subject, chapter, page, screenId) {
  const userId = userIdFrom(flowToken);
  const [available, downloaded] = await Promise.all([
    V8Delivery.availableLessonIds(),
    V8Delivery.downloadedLessonIds(userId),
  ]);
  const { items, total } = V8Catalog.buildLessonItems(grade, subject, chapter, available, downloaded, page);
  if (!items.length) {
    return { data: { error: { message: 'Those lesson plans are being prepared — check back soon.' } } };
  }
  const ch = V8Catalog.chapterFor(grade, subject, chapter);
  return {
    screen: screenId,
    data: {
      items,
      grade_value: String(grade),
      subject_value: subject,
      chapter_value: String(chapter),
      header_text: `${gradeTitle(grade)} ${subject} · Ch ${chapter}: ${ch ? ch.title : ''}`.trim(),
      lesson_total: String(total),
    },
  };
}

/** "More lessons →" — a second screen, because Meta rejects a self-route. */
async function selectLessonPage(flowToken, d) {
  const grade = parseInt(d.grade, 10);
  if (!isV8Grade(grade) || !d.subject || d.chapter === undefined) {
    return { data: { error: { message: 'Please pick a chapter again.' } } };
  }
  return v8LessonScreen(flowToken, grade, d.subject, d.chapter, parseInt(d.page, 10) || 2, 'SELECT_LESSON_MORE');
}

/**
 * A lesson row was tapped. Delivery is fire-and-forget: data_exchange has a
 * ~10s budget and an R2 presign plus a Meta document send can exceed it, so the
 * SUCCESS screen returns first and the PDF follows into the chat.
 */
async function selectLesson(flowToken, d) {
  const raw = d && d.lesson;
  if (!raw) return { data: { error: { message: 'Please pick a lesson.' } } };

  const { source, rawId } = V8Catalog.parseLessonId(raw);
  if (source === 'oxbridge') return selectTopicOxbridge(flowToken, rawId);
  if (source !== 'v8')       return selectTopicPakistan(flowToken, rawId);

  const hit = V8Catalog.lessonById(rawId);
  if (!hit) {
    logToFile('Pakistan LP v8: unknown lesson id', { lessonId: rawId });
    return { data: { error: { message: 'That lesson plan is not available right now.' } } };
  }

  const userId = userIdFrom(flowToken);
  Promise.resolve(V8Delivery.deliverV8Lesson({
    userId, lessonId: rawId, correlationId: `lpv8:${rawId}:${userId}`,
  })).catch((err) => logToFile('Pakistan LP v8: deliver threw', { lessonId: rawId, error: err.message }));

  const { lesson, book, chapter } = hit;
  return {
    screen: 'SUCCESS',
    data: {
      message: `Your lesson plan — ${lesson.day_label}: ${lesson.topic_short || lesson.topic} `
        + `(${gradeTitle(book.grade)} ${book.subject}, Ch ${chapter.number}) — is on its way!`,
    },
  };
}

// SELECT_TOPIC → SUCCESS (delivers via the correct pipeline)
async function selectTopic(flowToken, screenData) {
  const topicId = screenData && screenData.topic;
  if (!topicId) {
    return { data: { error: { message: 'Please pick a topic.' } } };
  }

  // Parse source prefix. Back-compat: an unprefixed uuid = pakistan.
  let source, rawId;
  if (topicId.startsWith('OX-')) { source = 'oxbridge'; rawId = topicId.slice(3); }
  else if (topicId.startsWith('PK-')) { source = 'pakistan'; rawId = topicId.slice(3); }
  else { source = 'pakistan'; rawId = topicId; }

  if (source === 'oxbridge') {
    return selectTopicOxbridge(flowToken, rawId);
  }
  return selectTopicPakistan(flowToken, rawId);
}

// --- Pakistan delivery path (existing) ---
async function selectTopicPakistan(flowToken, rowId) {
  const { data: row, error } = await supabase
    .from('pre_generated_lps')
    .select('id,grade,subject,chapter_number,chapter_title,pdf_r2_key_en,pdf_r2_key_ur')
    .eq('id', rowId)
    .single();
  if (error || !row || (!row.pdf_r2_key_en && !row.pdf_r2_key_ur)) {
    logToFile('Pakistan LP: row lookup failed', { rowId, error: error?.message });
    return { data: { error: { message: 'That lesson plan is not available right now.' } } };
  }
  logToFile('Pakistan LP: topic selected, initiating delivery', {
    flowToken, rowId, chapter: row.chapter_number, subject: row.subject, grade: row.grade,
  });
  await sendPreDeliveryAck(flowToken, row);
  deliverPakistanLpAsync(flowToken, row);
  const cleanTitle = (row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
  return {
    screen: 'SUCCESS',
    data: {
      message: `Your lesson plan "${cleanTitle}" (${gradeTitle(row.grade)} ${row.subject}) is on its way!`,
    },
  };
}

// --- Oxbridge delivery path (new for FEAT-109 iter 3) ---
async function selectTopicOxbridge(flowToken, rowId) {
  const row = await OxbridgeLpService.getById(parseInt(rowId, 10));
  if (!row || !row.content_html) {
    logToFile('Oxbridge LP: row lookup failed', { rowId });
    return { data: { error: { message: 'That lesson plan is not available right now.' } } };
  }
  logToFile('Oxbridge LP: topic selected via Flow, initiating delivery', {
    flowToken, rowId, chapter_title: row.chapter_title, subject: row.subject, grade: row.grade,
  });

  // Fire-and-forget delivery via the existing Oxbridge pipeline (plain-text
  // chunked message + PDF from content_html via Playwright).
  const userId = (flowToken || '').split(':')[0];
  (async () => {
    try {
      const user = await getPhoneForUser(userId);
      if (!user?.phone_number) {
        logToFile('Oxbridge LP (Flow): no phone for user', { userId });
        return;
      }
      const language = clampLanguage(user?.preferred_language);
      // Immediate ack
      await WhatsAppService.sendMessage(
        user.phone_number,
        `📖 Sending your Oxbridge lesson plan: ${row.grade} ${row.subject} — ${row.chapter_title}…`
      );
      const ok = await OxbridgeLpService.deliverOxbridgeLp(user.phone_number, row, language);
      if (!ok) {
        logToFile('Oxbridge LP (Flow): delivery returned false', { userId, rowId });
      }
    } catch (err) {
      logToFile('Oxbridge LP (Flow): delivery failed', { userId, rowId, error: err.message, stack: err.stack });
    }
  })();

  return {
    screen: 'SUCCESS',
    data: {
      message: `Your Oxbridge lesson plan "${row.chapter_title}" (${row.grade} ${row.subject}) is on its way!`,
    },
  };
}

// Immediate chat ack while the R2 fetch + Meta send happens.
async function sendPreDeliveryAck(flowToken, row) {
  const userId = (flowToken || '').split(':')[0];
  try {
    const user = await getPhoneForUser(userId);
    if (!user?.phone_number) {
      logToFile('Pakistan LP: ack skipped — no phone for user', { userId });
      return;
    }
    const clean = (row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
    await WhatsAppService.sendMessage(
      user.phone_number,
      `📘 Sending your lesson plan: ${gradeTitle(row.grade)} ${row.subject} — ${clean}…`
    );
    logToFile('Pakistan LP: ack sent', { userId, phone: user.phone_number, rowId: row.id });
  } catch (err) {
    logToFile('Pakistan LP: pre-delivery ack failed', { error: err.message, stack: err.stack });
  }
}

// Fire-and-forget deliver — Palestine pattern (bd-2054):
// presigned R2 URL + sendDocumentByLink, no tmpfile, no buffer-as-path bug.
function deliverPakistanLpAsync(flowToken, row) {
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
      const language = clampLanguage(user?.preferred_language);
      const r2Key = (language === 'ur' && row.pdf_r2_key_ur)
        ? row.pdf_r2_key_ur
        : (row.pdf_r2_key_en || row.pdf_r2_key_ur);
      const cleanTitle = (row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
      const filename = `${cleanTitle} — ${row.subject}.pdf`.replace(/["<>?*|\\/]/g, '');

      logToFile('Pakistan LP: building presigned URL', { userId, phone, r2Key });
      const presigned = await getPresignedUrl(buildR2PublicUrl(r2Key));
      logToFile('Pakistan LP: sending PDF via sendDocumentByLink', { userId, phone, filename, r2Key });

      const sendResp = await WhatsAppService.sendDocumentByLink(phone, presigned, filename);
      if (!sendResp) {
        throw new Error('sendDocumentByLink returned falsy');
      }
      logToFile('Pakistan LP: PDF delivered', { userId, rowId: row.id, r2Key, phone });

      // Optional voicenote at convention path <same-stem>.ogg
      const voicenoteKey = r2Key.replace(/\.pdf$/i, '.ogg');
      try {
        if (typeof WhatsAppService.sendVoicenoteFromR2Key === 'function') {
          await WhatsAppService.sendVoicenoteFromR2Key(phone, voicenoteKey);
        }
      } catch (vnErr) {
        logToFile('Pakistan LP: voicenote skip (non-fatal)', { userId, voicenoteKey, error: vnErr.message });
      }
    } catch (err) {
      logToFile('Pakistan LP: delivery failed', { userId, rowId: row.id, error: err.message, stack: err.stack });
    }
  })();
}

async function handlePakistanLpBack(flowToken, screen) {
  return openGradePicker();
}

module.exports = {
  handlePakistanLpInit,
  // exported for tests:
  selectLesson,
  selectLessonPage,
  v8LessonScreen,
  isV8Grade,
  handlePakistanLpDataExchange,
  handlePakistanLpBack,
  gradeTitle,
  gradeRank,
  isOxbridgeGrade,
  CURRICULUM_TAG,
  STATIC_GRADES,
};
