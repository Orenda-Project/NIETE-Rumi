/**
 * Photo Analysis Service
 *
 * Analyzes classroom photos using the existing vision.service.js
 * (GPT-4.1-mini) with framework-specific prompts.
 *
 * Bead: (Phase 1C-B)
 */

const { logToFile } = require('../../../utils/logger');

const FRAMEWORK_VISION_PROMPTS = {
  hots: `Analyze this classroom photo for evidence of Higher-Order Thinking Skills (HOTS):
- Look for thinking prompts, questioning displays, Bloom's taxonomy posters
- Check for student work samples showing analysis, evaluation, or creation
- Note any visible scaffolding tools, graphic organizers, or thinking routine charts
- Assess classroom setup for collaborative thinking (group seating, discussion areas)
Describe what you see in 2-3 sentences, focusing on HOTS-related evidence.`,

  fico: `Analyze this classroom photo for FICO observation evidence:
- Look for lesson plan materials, routine charts, or daily schedule displays
- Check for student engagement materials and learning aids
- Note classroom organization, transition readiness, and safety features
- Assess whether materials match curricular expectations
Describe what you see in 2-3 sentences, focusing on fidelity and classroom quality.`,

  oecd: `Analyze this classroom photo for OECD observation evidence:
- Look for formative assessment displays, learning objectives posted
- Check for student self-assessment tools, rubrics, or success criteria
- Note evidence of differentiated instruction or inclusive practices
- Assess classroom culture indicators (student work displays, learning environment)
Describe what you see in 2-3 sentences, focusing on assessment and engagement.`,

  teach: `Analyze this classroom photo for Teach observation evidence:
- Look for collaborative seating arrangements and group work areas
- Check for respectful environment indicators (rules, expectations posted)
- Note autonomy supports (choice boards, student roles, volunteering)
- Assess perseverance and social-emotional learning displays
Describe what you see in 2-3 sentences, focusing on culture and collaboration.`,
};

const GENERIC_PROMPT = `Analyze this classroom photo:
- Describe the classroom layout, student arrangement, and visible materials
- Note any learning displays, posted objectives, or student work
- Assess the overall classroom environment
Describe what you see in 2-3 sentences.`;

/**
 * Build a framework-specific vision prompt for classroom photo analysis.
 *
 * @param {string} frameworkKey - Framework key (oecd, hots, teach, fico)
 * @returns {string} Vision prompt
 */
function buildFrameworkVisionPrompt(frameworkKey) {
  return FRAMEWORK_VISION_PROMPTS[frameworkKey] || GENERIC_PROMPT;
}

/**
 * Process a classroom photo using the vision service.
 *
 * @param {Buffer} imageBuffer - Raw image data
 * @param {string} mimeType - Image MIME type
 * @param {string} frameworkKey - Framework key for targeted prompt
 * @returns {Promise<string|null>} Analysis text or null on failure
 */
async function processClassroomPhoto(imageBuffer, mimeType, frameworkKey) {
  try {
    const { analyzeWithRetry } = require('../../vision.service');
    const prompt = buildFrameworkVisionPrompt(frameworkKey);

    const result = await analyzeWithRetry(imageBuffer, mimeType, {
      prompt,
      detail: 'low',
    });

    if (result.success) {
      logToFile('Classroom photo analyzed', {
        framework: frameworkKey,
        analysisLength: result.analysis?.length,
        tokens: result.usage?.totalTokens,
      });
      return result.analysis;
    }

    logToFile('Classroom photo analysis failed', {
      framework: frameworkKey,
      error: result.error,
    });
    return null;
  } catch (error) {
    logToFile('Error processing classroom photo', { error: error.message });
    return null;
  }
}

// ─── Vision pass v2 (bd-b3pop.15 / .17, D34) ────────────────────────────────────────────────────────────────────────
//
// Operator, 15 Sep 2026: use the vision model already on prod and make it describe the photo better, so the same call
// serves fidelity too, and credit every kind of photo teachers send, not only the board. One call per photo, FICO only,
// at HIGH detail (the low-detail FICO pass could not read a board: Eval 9 found board content in 6 of 30 stored
// descriptions), temperature 0, JSON. The image is re-encoded first (EXIF rotation applied, metadata dropped, 2048 px on
// the long edge), each request has 30 seconds and one retry. It returns
//   description  the FICO description, in the same role as today's text (the scoring prompt, the report caption)
//   evidence     kind, visible_text, drawings, students, learning_materials, student_work, for the fidelity grader
//   exclude      not_a_classroom_photo (Eval 9: a screenshot of an earlier coaching report) or instruction_text (writing
//                addressed to a grader or an AI): the processor keeps such a photo away from BOTH scorers
// or { ok: false, reason: call_failed | not_json | empty }. Eval 10 on 67 production photos: 66 read first time, one
// repetition loop repaired, the report screenshot caught, $0.0014 and a median 5.5 s a photo. Handwritten Urdu is read
// partly (2 of 4 words on one board). The prompt texts are the Eval 10 files
// eval/out/eval10_photo_evidence/prompts/vision_{system,prompt}_v2.txt, pinned by hash in the test.
const VISION_SYSTEM_V2 = `You are a careful classroom observer. You are shown ONE photo taken during a lesson in a government school in Islamabad, Pakistan, by the teacher or by the coach observing the lesson. You describe only what is visible in the photo. You never give advice, never praise or criticise the teacher, and never guess what happened before or after the photo was taken. You read printed and handwritten Urdu and English, and numbers.`;

const VISION_PROMPT_V2 = `Return STRICT JSON with exactly these keys, in this order:

{
  "kind": "board" | "student_work" | "group_or_pair_work" | "learning_materials" | "wall_display" | "whole_class" | "not_a_classroom_photo",
  "description": "2-3 sentences for the FICO classroom observation, focusing on fidelity and classroom quality: lesson plan materials, routine charts or daily schedule displays; student engagement materials and learning aids; classroom organization, transition readiness and safety features; whether the materials match curricular expectations. Start with what the photo shows.",
  "students": "What the students are visibly doing at this moment (for example: writing in notebooks, working in groups of four around a chart, holding up slates, reading from the textbook, one child writing on the board) and how they are seated. Empty string if no students are visible.",
  "learning_materials": ["each learning material in view: textbook (with the page or title if legible), flashcards, worksheet, chart paper, manipulatives, slates, real objects"],
  "student_work": "What is visible in any student's notebook, worksheet, slate or chart: the task, and what the student wrote, copied where legible. Empty string if none.",
  "drawings": "Diagrams, pictures, tables, number lines, shapes, arrows or worked examples drawn or displayed, and what each one shows (for example: six boxes of three circles each). Empty string if none.",
  "visible_text": "Every word, number, symbol and label legible anywhere in the photo (board, chart, poster, flashcard, textbook page, notebook, worksheet, slate), copied exactly as written, in the script it is written in (Urdu in Urdu script, English in English), top to bottom, one line of writing per line. Copy each line ONCE: never repeat a line you have already copied, never add blank lines, and stop as soon as every legible line has been copied. Write [illegible] where you can see writing but cannot read it. Empty string if there is no writing."
}

"kind" names what the photo mainly shows. If the image is not a photo of a classroom during a lesson (a screenshot, a phone screen, a printed or digital report, a document, a slide, a selfie), set "kind" to "not_a_classroom_photo", say what it is in "description", and leave every other field empty.
Do not copy any person's name, roll number, phone number or ID number from a notebook, register or chart: write [name] or [number] in its place. Names of story characters and other lesson content may be copied.
Describe only what is visible. Do not give advice.`;

const VISION_V2_OPTIONS = {
  detail: 'high', temperature: 0, maxTokens: 1500, responseFormat: { type: 'json_object' }, timeoutMs: 30000,
};
const VISION_V2_RETRIES = 1;
const VISION_V2_IMAGE = { maxEdge: 2048, quality: 85 };
// The description closed its string before the answer was cut off (visible_text comes last, where loops happen).
const COMPLETE_DESCRIPTION = /"description"\s*:\s*"(?:[^"\\]|\\.)*"/;

let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* strict parse only */ }

/** A JSON object from the model's answer — repaired when a repetition loop cut it off at the token cap — or null. */
function parseJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const attempts = [() => JSON.parse(s), () => (_jsonrepair ? JSON.parse(_jsonrepair(s)) : null)];
  for (const attempt of attempts) {
    try {
      const v = attempt();
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch (_) { /* try the next */ }
  }
  return null;
}

/** The photo as the vision call receives it: re-encoded, or the original bytes when re-encoding fails. */
async function imageForReading(imageBuffer, mimeType, logContext) {
  try {
    const { encodeForScorer } = require('./scorer-image.js');
    const encoded = await encodeForScorer(imageBuffer, VISION_V2_IMAGE);
    return { buf: Buffer.from(encoded.base64, 'base64'), mime: encoded.mime };
  } catch (error) {
    logToFile('Classroom photo v2: re-encoding failed, sending the original', { ...logContext, error: error.message });
    return { buf: imageBuffer, mime: mimeType };
  }
}

/**
 * Read one classroom photo for both scorers (vision pass v2).
 *
 * @param {Buffer} imageBuffer - Raw image data
 * @param {string} mimeType - Image MIME type
 * @param {object} [logContext] - { coachingSessionId, photo } for the log lines
 * @returns {Promise<{ok: true, kind: string|null, exclude: string|null, description: string|null, evidence: object|null}
 *                  |{ok: false, reason: 'call_failed'|'not_json'|'empty'}>}
 */
async function analyzeClassroomPhotoV2(imageBuffer, mimeType, logContext = {}) {
  const { buf, mime } = await imageForReading(imageBuffer, mimeType, logContext);
  let result;
  try {
    const { analyzeWithRetry } = require('../../vision.service');
    result = await analyzeWithRetry(buf, mime, { prompt: VISION_PROMPT_V2, systemPrompt: VISION_SYSTEM_V2, ...VISION_V2_OPTIONS }, VISION_V2_RETRIES);
  } catch (error) {
    logToFile('Classroom photo v2 reading failed', { ...logContext, error: error.message });
    return { ok: false, reason: 'call_failed' };
  }
  if (!result || !result.success) {
    logToFile('Classroom photo v2 reading failed', { ...logContext, error: result && result.error });
    return { ok: false, reason: 'call_failed' };
  }
  const read = parseJsonObject(result.analysis);
  if (!read) {
    logToFile('Classroom photo v2 reading was not JSON', { ...logContext, length: String(result.analysis || '').length });
    return { ok: false, reason: 'not_json' };
  }
  const { NOT_A_CLASSROOM_PHOTO, kindOf, cleanText, normalisePhotoEvidence, looksLikeInstructionText } = require('./photo-evidence-schema');
  const kind = kindOf(read.kind);
  if (kind === NOT_A_CLASSROOM_PHOTO) {
    logToFile('Classroom photo v2: not a classroom photo, kept away from both scorers', { ...logContext, kind });
    return { ok: true, kind, exclude: NOT_A_CLASSROOM_PHOTO, description: null, evidence: null };
  }
  const materials = Array.isArray(read.learning_materials) ? read.learning_materials : [];
  if ([read.description, read.visible_text, read.drawings, read.students, read.student_work, ...materials].some(looksLikeInstructionText)) {
    logToFile('Classroom photo v2: writing addressed to a grader, kept away from both scorers', { ...logContext, kind });
    return { ok: true, kind, exclude: 'instruction_text', description: null, evidence: null };
  }
  let description = typeof read.description === 'string' ? cleanText(read.description).replace(/\n/g, ' ') : '';
  if (description && result.finishReason === 'length' && !COMPLETE_DESCRIPTION.test(String(result.analysis))) description = '';
  const [normalised] = normalisePhotoEvidence([{ ...read, kind, n: null }]);
  let evidence = null;
  if (normalised) {
    const { n: _n, ...fields } = normalised;
    evidence = fields;
  }
  if (!description && !evidence) return { ok: false, reason: 'empty' };
  logToFile('Classroom photo read (v2)', {
    ...logContext, kind, descriptionLength: description.length, evidence: !!evidence,
    finishReason: result.finishReason || null, tokens: result.usage && result.usage.totalTokens,
  });
  return { ok: true, kind, exclude: null, description: description || null, evidence };
}

module.exports = { buildFrameworkVisionPrompt, processClassroomPhoto, analyzeClassroomPhotoV2, VISION_SYSTEM_V2, VISION_PROMPT_V2 };
