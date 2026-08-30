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
 * THE MODEL'S ROWS ARE NOT THE ROSTER. sanitizeRows() below is a deterministic pass
 * over whatever comes back, and it exists because of two defects seen in one real
 * run on 2026-08-30: three roll numbers hidden behind a drawing came back as
 * 10/11/12 on a page that numbers those children 35/36/37, and every father name on
 * a combined-column register came back null. A register is an ordered list, so roll
 * numbers down a page increase — a structural fact the model cannot know it has
 * broken, and one worth more than any amount of prompting.
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
      "father_name": string|null, "parent_phone": string|null, "notes": string|null }
  ],
  "problems": [ short strings describing anything that blocked or degraded extraction ]
}

Rules:
- Transcribe what is written. Do NOT invent, complete or correct a name you cannot read.
- ROLL NUMBERS ARE READ, NEVER INFERRED. If a roll number is hidden behind a drawing, smudged,
  cut off or otherwise unreadable, return roll_number null and say so in that row's notes. Do
  NOT continue the sequence from the rows above or below it — a wrong roll number is worse than
  no roll number, because it silently attaches a child to another child's record.
- Keep Urdu names in Urdu script. Do not transliterate.
- Some registers put the student and the father in ONE column ("Name of Student & Father").
  Where the string carries a relationship marker — s/o, d/o, w/o, bin, binte, ولد, بنت, دختر —
  split on it: the part before is the student, the part after is the father. Where there is no
  marker and no separate column, put the whole string in student_name, leave father_name null,
  and say so in that row's notes.
- If a row is hidden behind a drawing or cut off, still emit the row with nulls and a note.
- parent_phone only if the register actually has a contact-number column for that child. Never
  a school or teacher number, and never a guess.
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

/**
 * Pull the father's name out of a combined "Name of Student & Father" column.
 *
 * Only on an explicit relationship marker. Splitting on whitespace would break
 * every three-part name in the country, and the markers below are the whole set
 * that appears on the registers we have measured.
 */
const NAME_SPLIT = /\s(?:s\/o|d\/o|w\/o|bin|binte|bint|ولد|بنت|دختر|زوجہ)\s+/i;

function splitCombinedName(raw) {
  const whole = String(raw || '').trim();
  const m = whole.match(NAME_SPLIT);
  if (!m) return { student_name: whole, father_name: null };
  const at = whole.indexOf(m[0]);
  const student = whole.slice(0, at).trim();
  const father = whole.slice(at + m[0].length).trim();
  if (!student || !father) return { student_name: whole, father_name: null };
  return { student_name: student, father_name: father };
}

/**
 * A parent's number, or nothing. Registers that carry one write it in every
 * Pakistani local form; storing "n/a" or a half-copied number is worse than
 * storing null, because a null is visibly missing and a wrong number is not.
 */
function normalizeParentPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  let e164 = digits;
  if (/^0\d{10}$/.test(digits)) e164 = `92${digits.slice(1)}`;
  else if (/^3\d{9}$/.test(digits)) e164 = `92${digits}`;
  else if (/^92\d{10}$/.test(digits)) e164 = digits;
  else if (/^0092\d{10}$/.test(digits)) e164 = digits.slice(2);
  else return null;
  return /^92\d{10}$/.test(e164) ? e164 : null;
}

/**
 * The deterministic pass between the model's rows and the roster.
 *
 * A roll number survives only if it is a plain 1-3 digit number (students.roll_number
 * is INTEGER — an "A-12" would throw on write), is not already taken on this page,
 * and is larger than the last one we accepted. Anything else becomes null and is
 * reported: the coach sees a `?` on the review screen and can type the real number.
 * Nothing is ever DROPPED for a bad roll — losing a child is the worse failure.
 */
function sanitizeRows(rows) {
  const problems = [];
  const abstained = [];
  const seen = new Set();
  let lastRoll = 0;

  const students = (rows || []).map((r) => {
    const rawName = String(r.student_name || '').trim();
    const modelFather = String(r.father_name || '').trim() || null;
    const split = modelFather ? { student_name: rawName, father_name: modelFather } : splitCombinedName(rawName);

    const rawRoll = r.roll_number === null || r.roll_number === undefined ? '' : String(r.roll_number).trim();
    let roll = null;
    if (/^\d{1,3}$/.test(rawRoll)) {
      const n = Number(rawRoll);
      if (n > lastRoll && !seen.has(rawRoll)) {
        roll = rawRoll;
        seen.add(rawRoll);
        lastRoll = n;
      } else {
        abstained.push(split.student_name || rawRoll);
      }
    } else if (rawRoll) {
      abstained.push(split.student_name || rawRoll);
    }

    return {
      roll_number: roll,
      student_name: split.student_name || null,
      father_name: split.father_name,
      parent_phone: normalizeParentPhone(r.parent_phone),
      notes: r.notes || null,
    };
  });

  if (abstained.length) {
    problems.push(
      `${abstained.length} roll number(s) did not read as a register sequence and were left blank `
      + `(${abstained.slice(0, 3).join(', ')}${abstained.length > 3 ? '…' : ''}) — check them against the page.`,
    );
  }

  return { students, problems };
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
  // Per-page model output, kept verbatim for the run's audit manifest. Auditing
  // "did the model misread this?" needs what the model actually said, not what
  // survived the sanitiser.
  const raw = [];
  let blankPages = 0;

  for (let i = 0; i < capped.length; i += 1) {
    try {
      const r = await extractPage(capped[i].data, capped[i].mimeType, deps);
      if (r.is_blank) blankPages += 1;
      // Per PAGE, not across the whole run: roll numbers restart on a new page, so
      // a run-wide monotonicity check would abstain on every page after the first.
      raw.push({ page: i + 1, output: r });
      const clean = sanitizeRows(r.students);
      students.push(...clean.students);
      for (const p of clean.problems) problems.push(`page ${i + 1}: ${p}`);
      for (const p of r.problems) problems.push(`page ${i + 1}: ${p}`);
    } catch (err) {
      // Log the real thing; surface only the sanitised line.
      logToFile('[roster] page extraction failed', { page: i + 1, error: err.message }, 'error');
      raw.push({ page: i + 1, error: err.message });
      problems.push(describeFailure(err.message));
    }
  }

  // Drop rows with no usable name at all — they are noise from a decorated page,
  // and a blank row in the review box reads as a bug to the coach.
  const usable = students.filter((s) => s.student_name);
  const dropped = students.length - usable.length;
  if (dropped) problems.push(`${dropped} row(s) had no readable name and were left out`);

  return { students: usable, problems, raw, blankPages, pagesRead: capped.length, model: visionModel() };
}

module.exports = {
  extractPage, extractPages, visionModel, describeFailure,
  sanitizeRows, splitCombinedName, normalizeParentPhone,
  DEFAULT_MODEL, MAX_PAGES, PROMPT,
};
