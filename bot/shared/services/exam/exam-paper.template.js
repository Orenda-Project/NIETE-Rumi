/**
 * Exam Paper Docx Template — builds a printable Word document from a
 * composed exam. Called by exam-render.service.js.
 *
 * Input:
 *   { exam, questions, groupMeta } — output of exam-composer.composeExam()
 * Output:
 *   Promise<Buffer>  — .docx file bytes
 *
 * Layout follows docs/migration/05-exam-generator.md "Rendering — Word document".
 * V1: paper only, no answer key. correct_answer_snapshot + marking_scheme_snapshot
 * are ignored here (retained on disk for a v2 answer-key template).
 */

const {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} = require('docx');
const axios = require('axios');
const { logToFile } = require('../../utils/logger');

// Font stacks per language. docx names fonts by string — recipient's OS
// substitutes if the exact face isn't installed.
const FONTS = {
  en: 'Lexend',
  ur: 'Jameel Noori Nastaleeq',
};

// Section labels — bilingual.
const LABELS = {
  en: {
    section1: 'Section 1 — Objective',
    section2: 'Section 2 — Subjective',
    marks: 'marks',
    mark: 'mark',
    totalMarks: 'Total Marks',
    time: 'Time',
    minutes: 'min',
    studentName: 'Student Name',
    roll: 'Roll No.',
    figureUnavailable: '[Figure unavailable]',
    typeLabel: { WEEKLY: 'Weekly Test', TERM: 'Term Exam' },
  },
  ur: {
    section1: 'حصہ اول — معروضی',
    section2: 'حصہ دوم — موضوعی',
    marks: 'نمبر',
    mark: 'نمبر',
    totalMarks: 'کل نمبر',
    time: 'وقت',
    minutes: 'منٹ',
    studentName: 'طالب علم کا نام',
    roll: 'رول نمبر',
    figureUnavailable: '[تصویر دستیاب نہیں]',
    typeLabel: { WEEKLY: 'ہفتہ وار امتحان', TERM: 'ٹرم امتحان' },
  },
};

// Answer space (ruled lines) per question type. See D "Answer space" table.
const ANSWER_LINES = {
  MCQs: 0,
  MSQs: 0,
  'True/False': 0,
  'Fill in the Blanks': 0,
  'Match the Column': 0,
  'Brief Answers': 2,
  'Short Answer': 4,
  'Long Answer': 10,
  'Essay Writing': 20,
  'Letter Writing': 20,
  'Story Writing': 20,
  'Paragraph Writing': 15,
  'Picture Description': 15,
  'Application Writing': 15,
};

const RULED_LINE = '_'.repeat(80);

// ─────────────────────────────────────────────────────────────────────────────
// media fetching
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch an image URL as a Buffer. Returns null on failure — caller substitutes placeholder. */
async function fetchMediaBuffer(url) {
  if (!url) return null;
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return Buffer.from(resp.data);
  } catch (err) {
    logToFile('[exam-render] media fetch failed', {
      url: String(url).slice(0, 200),
      err: err.message,
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// text helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRun(text, { bold = false, size, lang = 'en' } = {}) {
  return new TextRun({
    text: String(text ?? ''),
    bold,
    size,
    font: FONTS[lang] || FONTS.en,
    rightToLeft: lang === 'ur',
  });
}

function makePara(children, { align, lang = 'en', spaceAfter = 60, indent } = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: align ?? (lang === 'ur' ? AlignmentType.RIGHT : AlignmentType.LEFT),
    bidirectional: lang === 'ur',
    spacing: { after: spaceAfter },
    indent,
  });
}

function heading(text, level, lang) {
  return new Paragraph({
    heading: level,
    alignment: lang === 'ur' ? AlignmentType.RIGHT : AlignmentType.LEFT,
    bidirectional: lang === 'ur',
    children: [makeRun(text, { bold: true, lang })],
    spacing: { before: 200, after: 120 },
  });
}

function ruledLine(count, lang) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: RULED_LINE,
            font: FONTS.en, // ruled line char is font-agnostic
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
        alignment: lang === 'ur' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { after: 120 },
      })
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// header block
// ─────────────────────────────────────────────────────────────────────────────

function buildHeader(exam, lang) {
  const L = LABELS[lang];
  const typeLabel = L.typeLabel[exam.type] || exam.type;

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [makeRun('NIETE', { bold: true, size: 32, lang: 'en' })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: lang === 'ur',
      children: [
        makeRun(`Grade ${exam.grade} · ${exam.subject} · ${typeLabel}`, {
          bold: true, size: 24, lang,
        }),
      ],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: lang === 'ur',
      children: [
        makeRun(
          `${L.totalMarks}: ${exam.total_marks}    ${L.time}: ${exam.duration_minutes} ${L.minutes}`,
          { size: 22, lang }
        ),
      ],
      spacing: { after: 240 },
    }),
    new Paragraph({
      bidirectional: lang === 'ur',
      alignment: lang === 'ur' ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [
        makeRun(`${L.studentName}: ${'_'.repeat(30)}    ${L.roll}: ${'_'.repeat(10)}`, {
          size: 22, lang,
        }),
      ],
      spacing: { after: 240 },
    }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// question rendering
// ─────────────────────────────────────────────────────────────────────────────

async function renderMcqOptions(q, lang) {
  const opts = q.options_snapshot || [];
  if (!Array.isArray(opts) || opts.length === 0) return [];
  const letters = ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)'];
  const parts = opts
    .slice(0, letters.length)
    .map((o, i) => `${letters[i]} ${o?.statement ?? o?.text ?? ''}`)
    .join('   ');
  return [
    makePara(makeRun(parts, { size: 22, lang }), {
      lang,
      indent: { left: 720 },
      spaceAfter: 120,
    }),
  ];
}

async function renderMediaBlock(mediaArr, lang) {
  const out = [];
  if (!Array.isArray(mediaArr)) return out;
  for (const m of mediaArr) {
    if (!m || !m.url) continue;
    const buf = await fetchMediaBuffer(m.url);
    if (buf) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: 300, height: 200 },
            }),
          ],
          spacing: { after: 120 },
        })
      );
    } else {
      out.push(
        makePara(
          makeRun(LABELS[lang].figureUnavailable, { size: 20, lang }),
          { lang, spaceAfter: 120 }
        )
      );
    }
  }
  return out;
}

async function renderQuestion(q, index, lang) {
  const out = [];
  const L = LABELS[lang];
  const markLabel = q.score === 1 ? L.mark : L.marks;

  // Question statement + marks tag
  out.push(
    makePara(
      [
        makeRun(`${index}. `, { bold: true, size: 22, lang }),
        makeRun(q.statement_snapshot, { size: 22, lang }),
        makeRun(`   (${q.score} ${markLabel})`, { size: 20, lang }),
      ],
      { lang, spaceAfter: 60 }
    )
  );

  // Question media (image after statement)
  out.push(...(await renderMediaBlock(q.media_snapshot, lang)));

  // MCQ / MSQ options
  if (['MCQs', 'MSQs', 'Circle the Correct Answer'].includes(q.question_format)) {
    out.push(...(await renderMcqOptions(q, lang)));
  }

  // Ruled lines for answer space (subjective types).
  const lineCount = ANSWER_LINES[q.question_format];
  if (lineCount && lineCount > 0) {
    out.push(...ruledLine(lineCount, lang));
  }

  return out;
}

async function renderGroupHeader(group, lang) {
  const out = [];
  if (!group) return out;
  // Passage text (or match-the-columns / choice heading)
  if (group.title_text) {
    // Render as a shaded block by using italic + slight indent + border-ish.
    out.push(
      new Paragraph({
        bidirectional: lang === 'ur',
        alignment: lang === 'ur' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [makeRun(group.title_text, { size: 22, lang })],
        indent: { left: 360, right: 360 },
        spacing: { before: 120, after: 120 },
      })
    );
  }
  // Passage media (image alongside a passage)
  out.push(...(await renderMediaBlock(group.media, lang)));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// main builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group consecutive questions by (section, question_format) so we can emit
 * sub-headings like "MCQs" / "Fill in the Blanks" within each section.
 * Also inserts group-header paragraphs between siblings of a comprehension
 * passage / match-the-columns block.
 */
async function buildBody(exam, questions, groupMeta) {
  const lang = exam.language === 'ur' ? 'ur' : 'en';
  const L = LABELS[lang];
  const out = [];

  // Split by section preserving order.
  const bySection = { objective: [], subjective: [] };
  for (const q of questions) bySection[q.section]?.push(q);

  for (const sectionKey of ['objective', 'subjective']) {
    const list = bySection[sectionKey];
    if (list.length === 0) continue;

    out.push(heading(sectionKey === 'objective' ? L.section1 : L.section2,
      HeadingLevel.HEADING_1, lang));

    // Sub-group by question_format within the section.
    let lastFormat = null;
    let lastGroupRef = null;
    let questionNumber = 1;
    for (const q of list) {
      if (q.question_format !== lastFormat) {
        out.push(heading(`— ${q.question_format} —`, HeadingLevel.HEADING_2, lang));
        lastFormat = q.question_format;
        // Reset the group tracker within a new format sub-heading.
        lastGroupRef = null;
      }
      if (q.group_ref && q.group_ref !== lastGroupRef) {
        const group = groupMeta && groupMeta.get(q.group_ref);
        out.push(...(await renderGroupHeader(group, lang)));
        lastGroupRef = q.group_ref;
      }
      out.push(...(await renderQuestion(q, questionNumber, lang)));
      questionNumber += 1;
    }
  }
  return out;
}

async function buildExamDocx({ exam, questions, groupMeta }) {
  const lang = exam.language === 'ur' ? 'ur' : 'en';

  const doc = new Document({
    creator: 'NIETE Rumi',
    title: `Grade ${exam.grade} ${exam.subject} ${exam.type}`,
    styles: {
      default: {
        document: {
          run: { font: FONTS[lang] || FONTS.en, size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          ...buildHeader(exam, lang),
          ...(await buildBody(exam, questions, groupMeta)),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  logToFile('[exam-render] docx built', {
    examId: exam.id,
    sizeKB: (buf.length / 1024).toFixed(1),
    questions: questions.length,
  });
  return buf;
}

module.exports = { buildExamDocx };
