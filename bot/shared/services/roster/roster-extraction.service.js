'use strict';
/**
 * /roster — reading a photographed attendance register into structured rows.
 *
 * The call shape is the one the lesson-plan vision OCR already uses in production:
 * a base64 data URL in an image_url content part, temperature 0, through the shared
 * LLM client. Only the prompt and the output schema are new.
 *
 * MODEL. Default is a Gemini flash-lite tier rather than the lesson-plan default.
 * Measured on six real Pakistani registers (57 handwritten names across three pages,
 * three repeats): 93.0% exact full names, byte-identical output on all nine runs,
 * ~8 seconds and about half a cent a page. The older flash tier scored 92.4% — a tie
 * — but was the ONLY model tested that invented a class header ("8A" at 0.6
 * confidence for a class that is actually 10th) on a page too degraded to read. A
 * wrong grade is the worst error this feature can make, because the grade vocabulary
 * fails closed and picks the wrong reading material, so abstention is worth more here
 * than a point of accuracy.
 *
 * CONFIDENCE IS NOT USED AS A GATE. Measured on the same registers, five of six wrong
 * names came back at confidence 1.0 and no name field scored below 0.8 against a true
 * error rate of 24%. Self-reported confidence does not separate right from wrong, so
 * the review screen shows the coach EVERY name rather than a filtered subset.
 */

const { logToFile } = require('../../utils/logger');

const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite-preview';
const MAX_PAGES = 10;

const PROMPT = `You are reading a photograph of a school attendance register from Pakistan so that
a coach can build a class roster. Registers are handwritten, in English or Urdu script, and are
frequently decorated with drawings that cover part of the page.

Return ONLY a JSON object, no commentary:

{
  "is_register": true/false,
  "is_blank": true/false,
  "headcount": integer|null,
  "students": [
    { "roll_number": string|null, "student_name": string|null,
      "father_name": string|null, "notes": string|null }
  ],
  "problems": [ short strings describing anything that blocked or degraded extraction ]
}

Rules:
- Transcribe what is written. Do NOT invent, complete or correct a name you cannot read.
- Keep Urdu names in Urdu script. Do not transliterate.
- Some registers put the student and the father in ONE column ("Name of Student & Father").
  Split them only when the split is unambiguous; otherwise put the whole string in
  student_name, leave father_name null, and say so in that row's notes.
- If a row is hidden behind a drawing or cut off, still emit the row with nulls and a note.
- Do NOT report the class, grade or section. The coach supplies those; a guessed grade is
  worse than no grade.
- headcount is the number of students actually listed on this page.
- If the page is an unfilled printed template, set is_blank true and return no students.`;

/**
 * Turn an upstream failure into something a coach standing in a school can act on.
 *
 * The raw error is always logged; only this sanitised line is ever shown. A vendor's
 * billing or auth message is OUR problem, and pasting an HTTP 402 with a credits URL
 * into a WhatsApp screen is a leak, not an explanation.
 */
function describeFailure(rawError) {
  const e = String(rawError || '').toLowerCase();

  // Ours to fix: billing, auth, quota. The coach can do nothing about these.
  if (/\b40[123]\b|credit|quota|billing|max_tokens|no auth|api key|unauthor/.test(e)) {
    return 'The register reader is not available right now. This is our problem, not yours — we have been told.';
  }
  // Temporary: rate limits and timeouts.
  if (/\b429\b|rate.?limit|timeout|etimedout|econnreset|socket hang up|\b5\d\d\b/.test(e)) {
    return 'The register reader is busy. Give it a moment and try again.';
  }
  // The page itself: nothing came back, or nothing parseable did.
  return 'That photo could not be read. Try a closer, straighter photo of the name column.';
}

function visionModel() {
  return process.env.ROSTER_VISION_MODEL || DEFAULT_MODEL;
}

function parseModelJson(text) {
  let s = (text || '').trim();
  if (s.startsWith('```')) {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) s = m[1];
  }
  return JSON.parse(s);
}

/**
 * Read one register page.
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {Promise<{students:Array, headcount:number|null, is_blank:boolean, problems:string[]}>}
 */
async function extractPage(imageBuffer, mimeType, deps = {}) {
  const getClient = deps.getClient || (() => require('../llm-client').getClient());
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`;

  const resp = await getClient().chat.completions.create({
    model: visionModel(),
    temperature: 0,
    // Without this the client asks for the model's full ceiling (65,536 on the
    // flash-lite tier). A 40-row register serialises to well under 8k tokens, and
    // OpenRouter authorises a request against the max you ASK for, not the max you
    // use — so an unbounded ask is both needlessly expensive to clear and the
    // difference between a call succeeding and a 402 on a thin balance.
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  });

  const text = (resp && resp.choices && resp.choices[0]
    && resp.choices[0].message && resp.choices[0].message.content) || '';
  const out = parseModelJson(text);
  return {
    students: Array.isArray(out.students) ? out.students : [],
    headcount: typeof out.headcount === 'number' ? out.headcount : null,
    is_blank: !!out.is_blank,
    is_register: out.is_register !== false,
    problems: Array.isArray(out.problems) ? out.problems : [],
  };
}

/**
 * Read every page of one class's register and concatenate, preserving page order.
 * A page that fails is skipped and reported — one unreadable page must not lose the
 * other four.
 */
async function extractPages(pages, deps = {}) {
  const capped = (pages || []).slice(0, MAX_PAGES);
  const students = [];
  const problems = [];
  let blankPages = 0;

  for (let i = 0; i < capped.length; i += 1) {
    try {
      const r = await extractPage(capped[i].data, capped[i].mimeType, deps);
      if (r.is_blank) blankPages += 1;
      for (const s of r.students) {
        students.push({
          roll_number: s.roll_number ? String(s.roll_number).trim() : null,
          student_name: (s.student_name || '').trim() || null,
          father_name: (s.father_name || '').trim() || null,
          notes: s.notes || null,
        });
      }
      for (const p of r.problems) problems.push(`page ${i + 1}: ${p}`);
    } catch (err) {
      // Log the real thing; surface only the sanitised line.
      logToFile('[roster] page extraction failed', { page: i + 1, error: err.message }, 'error');
      problems.push(describeFailure(err.message));
    }
  }

  // Drop rows with no usable name at all — they are noise from a decorated page,
  // and a blank row in the review box reads as a bug to the coach.
  const usable = students.filter((s) => s.student_name);
  const dropped = students.length - usable.length;
  if (dropped) problems.push(`${dropped} row(s) had no readable name and were left out`);

  return { students: usable, problems, blankPages, pagesRead: capped.length };
}

module.exports = {
  extractPage, extractPages, visionModel, describeFailure,
  DEFAULT_MODEL, MAX_PAGES, PROMPT,
};
