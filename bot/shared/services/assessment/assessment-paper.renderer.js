'use strict';
/**
 * The exam paper itself — the one artefact a teacher actually sees.
 *
 * Laid out the way the papers teachers already print are laid out: school name,
 * a marking header with Roll No and Obtained Marks, the standing instructions,
 * then the questions. Deliberately NOT the coloured web preview the previous
 * generator emitted — a gradient banner and emoji section headings are fine on a
 * screen and wrong on a photocopier, where they cost ink and say nothing.
 *
 * Everything is inline-styled and self-contained because this HTML is fed
 * straight to a headless browser for printing; there is no stylesheet to load.
 *
 * On escaping: every string here came from a language model. It is rendered as
 * text, never as markup — a question containing a stray angle bracket must
 * appear on the page, not disappear into the DOM.
 */

const fs = require('fs');
const path = require('path');

/**
 * Fonts are base64-embedded into the HTML, not named and hoped for.
 *
 * The Chromium that prints this runs headless on a container with NO system
 * fonts. A stylesheet that merely NAMES 'Noto Nastaliq Urdu' gets no glyphs and
 * every Urdu character renders as an empty box. This has shipped here before:
 * hundreds of unreadable Urdu reports went out because a redesign copied a
 * template's CSS and not its font embedding. Naming a font that happens to be
 * installed on the author's laptop is the exact shape of that bug.
 */
const FONT_FILES = {
  latin: 'Lexend-Regular.ttf',
  latinBold: 'Lexend-Bold.ttf',
  nastaliq: 'NotoNastaliqUrdu-Regular.ttf',
  nastaliqBold: 'NotoNastaliqUrdu-Bold.ttf',
};

let _fonts = null;
function fonts() {
  if (_fonts) return _fonts;
  _fonts = {};
  for (const [key, file] of Object.entries(FONT_FILES)) {
    const abs = path.join(__dirname, '..', '..', 'fonts', file);
    try {
      _fonts[key] = fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
    } catch {
      _fonts[key] = '';
    }
  }
  return _fonts;
}

function fontFaces() {
  const f = fonts();
  const face = (family, weight, data) => (data
    ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;`
      + `src:url(data:font/ttf;base64,${data}) format('truetype');}`
    : '');
  return [
    face('PaperLatin', 400, f.latin),
    face('PaperLatin', 700, f.latinBold),
    face('PaperUrdu', 400, f.nastaliq),
    face('PaperUrdu', 700, f.nastaliqBold),
  ].filter(Boolean).join('\n');
}

const SUBJECT_NAMES = {
  eng: 'English', english: 'English',
  urdu: 'Urdu',
  maths: 'Mathematics', math: 'Mathematics', mathematics: 'Mathematics',
  islamiat: 'Islamiat',
  science: 'Science', gensci: 'Science',
  genk: 'General Knowledge', general_knowledge: 'General Knowledge',
  sst: 'Social Studies', social_studies: 'Social Studies',
};

// Taught in Urdu, so the paper is set right to left.
const RTL_SUBJECTS = new Set(['urdu', 'islamiat', 'genk', 'general_knowledge', 'sst', 'social_studies']);

const INSTRUCTIONS = [
  'Read all questions carefully before answering.',
  'Answer all questions in the space provided.',
  'Write clearly and legibly.',
  'Time allowed: as specified by your teacher.',
];

// How much room a written answer needs. Multiple choice and matching get none —
// she marks the option or draws the line, and blank ruled lines under an MCQ
// just waste the page.
const ANSWER_LINES = {
  'brief answers': 2, 'short questions': 4, 'short answer': 4,
  'restricted response question': 4, 'long question': 8, 'long answer': 8,
  'essay writing': 10, 'story writing': 10, 'letter writing': 10,
  'application writing': 10, 'paragraph writing': 6, 'picture description': 6,
  'word problems': 4, 'mind map': 6, 'flow chart': 6, 'label the diagram': 4,
  'logical reasoning': 4, 'word sentences': 3, 'word meanings': 3,
  'simple writing': 6, 'story completion': 6, 'rewriting': 3,
};

// Type keys that name a bucket rather than a kind of question. Never used as a
// heading; the questions under them still render normally.
const GENERIC_TYPES = new Set(['other', 'others', 'misc', 'miscellaneous', 'general']);

const NO_LINES = new Set([
  'mcqs', 'msqs', 'true/false', 'match the column', 'circle the correct answer',
  'fill in the blanks', 'missing letters', 'listening', 'speaking', 'reading',
]);

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escaped, but line breaks in a passage survive as line breaks. */
function escMultiline(value) {
  return esc(value).replace(/\n/g, '<br>');
}

function subjectName(subject) {
  const k = String(subject || '').trim().toLowerCase();
  return SUBJECT_NAMES[k] || String(subject || '');
}

function isRtl(subject) {
  return RTL_SUBJECTS.has(String(subject || '').trim().toLowerCase());
}

function marksLabel(marks) {
  const n = Number(marks);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `<span class="marks">[${n} ${n === 1 ? 'mark' : 'marks'}]</span>`;
}

function answerLinesFor(questionType, question) {
  const key = String(questionType || '').trim().toLowerCase();
  if (NO_LINES.has(key)) return 0;
  if (question && Array.isArray(question.options) && question.options.length) return 0;
  if (question && (question.column_a || question.column_b)) return 0;
  return ANSWER_LINES[key] ?? 3;
}

function ruledLines(count) {
  if (!count) return '';
  return `<div class="answer-space">${'<div class="answer-line"></div>'.repeat(count)}</div>`;
}

/**
 * How tall a ruled line has to be for the child holding the pencil.
 *
 * A Grade 1 hand writes letters roughly twice the height a Grade 5 hand does,
 * and a line it cannot fit its writing between is worse than no line at all —
 * it makes neat work look untidy. Sized from printed handwriting guides:
 * ~9mm for the youngest, tapering to ~6.5mm by Grade 5.
 */
function lineHeightMm(grade) {
  const g = Number(grade);
  if (!Number.isFinite(g)) return 7;
  if (g <= 2) return 9;
  if (g <= 4) return 7.5;
  return 6.5;
}

/**
 * One question, rendered for whichever of the six shapes it is. Order matters —
 * a comprehension question also has a `passage`, so it must be tested before the
 * passage-only case.
 */
function renderQuestion(question, number, questionType, opts) {
  const { includeAnswerKey, answerLines } = opts;
  const out = [];

  if (typeof question === 'string') {
    return `<div class="q"><p><b>${number}.</b> ${esc(question)}</p></div>`;
  }

  const marks = marksLabel(question.marks);
  const answer = includeAnswerKey && question.answer
    ? `<div class="answer"><b>Answer:</b> ${esc(question.answer)}</div>` : '';

  out.push('<div class="q">');

  if (Array.isArray(question.options) && question.options.length) {
    out.push(`<p><b>${number}.</b> ${esc(question.question)} ${marks}</p>`);
    out.push('<div class="options">');
    question.options.forEach((o) => out.push(`<div class="opt">${esc(o)}</div>`));
    out.push('</div>');
  } else if (question.column_a || question.column_b) {
    const a = question.column_a || [];
    const b = question.column_b || [];
    out.push(`<p><b>${number}.</b> ${esc(question.question)} ${marks}</p>`);
    out.push('<table class="match"><tr><th>Column A</th><th>Column B</th></tr>');
    // Pad to the longer column — dropping a row loses a question.
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      out.push(`<tr><td>${esc(a[i] || '')}</td><td>${esc(b[i] || '')}</td></tr>`);
    }
    out.push('</table>');
  } else if (Array.isArray(question.words) && question.words.length) {
    out.push(`<p><b>${number}.</b> ${esc(question.question || '')} ${marks}</p>`);
    out.push('<div class="words">');
    question.words.forEach((w) => out.push(
      `<div class="word">${esc(w)}${answerLines ? '<span class="rule"></span>' : ''}</div>`));
    out.push('</div>');
  } else if (question.passage && Array.isArray(question.questions)) {
    out.push(`<p><b>${number}.</b> ${esc(question.question || 'Read the passage and answer the questions.')} ${marks}</p>`);
    out.push(`<div class="passage">${escMultiline(question.passage)}</div>`);
    out.push('<div class="subs">');
    question.questions.forEach((sub, i) => {
      const letter = String.fromCharCode(97 + i);
      const subText = typeof sub === 'string' ? sub : sub.question;
      const subMarks = typeof sub === 'string' ? '' : marksLabel(sub.marks);
      out.push(`<p class="sub"><b>${letter})</b> ${esc(subText)} ${subMarks}</p>`);
      if (typeof sub === 'object' && Array.isArray(sub.options) && sub.options.length) {
        out.push('<div class="options">');
        sub.options.forEach((o) => out.push(`<div class="opt">${esc(o)}</div>`));
        out.push('</div>');
      } else if (answerLines) {
        out.push(ruledLines(2));
      }
      if (includeAnswerKey && typeof sub === 'object' && sub.answer) {
        out.push(`<div class="answer"><b>Answer:</b> ${esc(sub.answer)}</div>`);
      }
    });
    out.push('</div>');
  } else if (question.passage) {
    const label = question.section ? `[${esc(question.section)}] ` : '';
    out.push(`<p><b>${number}.</b> ${label}${esc(question.question || '')} ${marks}</p>`);
    out.push(`<div class="passage">${escMultiline(question.passage)}</div>`);
  } else {
    out.push(`<p><b>${number}.</b> ${esc(question.question)} ${marks}</p>`);
    if (answerLines) out.push(ruledLines(answerLinesFor(questionType, question)));
  }

  if (answer) out.push(answer);
  out.push('</div>');
  return out.join('\n');
}

/** Every question in the tree, in printing order, with its type. */
function collectQuestions(examJson) {
  const found = [];
  for (const section of ['seen', 'unseen']) {
    const branch = examJson?.[section];
    if (!branch || typeof branch !== 'object') continue;
    for (const [category, types] of Object.entries(branch)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, entry] of Object.entries(types)) {
        if (Array.isArray(entry)) {
          entry.forEach((q) => q && found.push({ section, category, type, question: q }));
        } else if (entry && typeof entry === 'object') {
          for (const [subType, list] of Object.entries(entry)) {
            if (Array.isArray(list)) {
              list.forEach((q) => q && found.push({ section, category, type: subType, question: q }));
            }
          }
        }
      }
    }
  }
  return found;
}

function totalMarks(questions) {
  return questions.reduce((sum, { question }) => {
    if (Array.isArray(question?.questions)) {
      const subs = question.questions.reduce((s, q) => s + (Number(q?.marks) || 0), 0);
      if (subs > 0) return sum + subs;
    }
    return sum + (Number(question?.marks) || 0);
  }, 0);
}

function renderPaper({ examJson, grade, subject, schoolName, pageReference,
                       chapterTitle, includeAnswerKey = false, answerLines = true }) {
  const lineMm = lineHeightMm(grade);
  const questions = collectQuestions(examJson);
  const rtl = isRtl(subject);
  const opts = { includeAnswerKey, answerLines };

  const body = [];
  let number = 1;
  let lastType = null;
  let lastMain = null;

  for (const { type, question } of questions) {
    if (type !== lastType) {
      // The model's schema has a catch-all bucket, and questions land in it
      // legitimately. "OTHER" printed as a section heading on a child's paper
      // says nothing — the shared instruction under it already does the work.
      if (type && !GENERIC_TYPES.has(String(type).trim().toLowerCase())) {
        body.push(`<h3 class="type">${esc(type)}</h3>`);
      }
      lastType = type;
      lastMain = null;
    }
    // A shared instruction ("Write True or False") belongs above its group once,
    // not restated over every question under it.
    const main = question && question.main_question;
    if (main && main !== lastMain) {
      body.push(`<p class="lead">${esc(main)}</p>`);
      lastMain = main;
    }
    body.push(renderQuestion(question, number, type, opts));
    number += 1;
  }

  const heading = [`Grade ${esc(grade)}`, esc(subjectName(subject))].join(' · ');
  const sub = chapterTitle
    ? `${esc(chapterTitle)}${pageReference ? ` · Pages ${esc(pageReference)}` : ''}`
    : (pageReference ? `Pages ${esc(pageReference)}` : '');

  return `<!DOCTYPE html>
<html lang="${rtl ? 'ur' : 'en'}"${rtl ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><title>${heading}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  ${fontFaces()}
  body { font-family: ${rtl
    ? "'PaperUrdu','PaperLatin',serif"
    : "'PaperLatin',Arial,sans-serif"}; font-size: ${rtl ? '13.5pt' : '12pt'};
    color: #000; line-height: ${rtl ? 2.0 : 1.5}; margin: 0; }
  /* Digits, page numbers and marks stay left-to-right inside RTL text. Isolate
     rather than force direction — an override reorders the surrounding Urdu. */
  .marks, .num { unicode-bidi: isolate; }
  .school { text-align: center; font-weight: 700; font-size: 13pt; letter-spacing: .01em; }
  .class-line { text-align: center; font-size: 11.5pt; margin: 2px 0 10px; }
  .chapter { text-align: center; font-size: 10.5pt; color: #333; margin-bottom: 10px; }
  table.marks-header { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11pt; }
  table.marks-header td { border: 1px solid #333; padding: 5px 7px; height: 22px; }
  table.marks-header td.k { background: #f2f2f2; font-weight: 600; white-space: nowrap; width: 22%; }
  .instructions { border: 1px solid #999; padding: 7px 10px; font-size: 10.5pt; margin-bottom: 14px; }
  .instructions ol { margin: 4px 0 0; padding-${rtl ? 'right' : 'left'}: 18px; }
  h3.type { font-size: 11.5pt; text-transform: uppercase; letter-spacing: .04em;
            border-bottom: 1.5px solid #000; padding-bottom: 3px; margin: 16px 0 9px; }
  .lead { font-weight: 600; margin: 8px 0 6px; }
  .q { margin-bottom: 11px; page-break-inside: avoid; }
  .q p { margin: 0 0 4px; }
  .marks { font-size: 10pt; color: #444; float: ${rtl ? 'left' : 'right'}; }
  .options { margin-${rtl ? 'right' : 'left'}: 18px; }
  .opt { margin: 2px 0; }
  .words { margin-${rtl ? 'right' : 'left'}: 18px; }
  .word { margin: 5px 0; }
  .word .rule { display: inline-block; border-bottom: 1px solid #999; width: 190px; margin-${rtl ? 'right' : 'left'}: 10px; }
  .passage { border: 1px solid #bbb; background: #fafafa; padding: 8px 10px; margin: 6px 0 8px; }
  .subs { margin-${rtl ? 'right' : 'left'}: 18px; }
  .sub { margin: 6px 0 3px; }
  table.match { border-collapse: collapse; margin: 6px 0 0 ${rtl ? '0' : '18px'}; width: 70%; }
  table.match th, table.match td { border: 1px solid #666; padding: 5px 8px; text-align: ${rtl ? 'right' : 'left'}; }
  table.match th { background: #f2f2f2; }
  .answer-space { margin: 5px 0 0 ${rtl ? '0' : '18px'}; }
  .answer-line { border-bottom: 1px solid #aaa; height: ${lineMm}mm; }
  .answer { background: #eef7ee; border-${rtl ? 'right' : 'left'}: 3px solid #4a4; padding: 3px 7px; margin-top: 4px; font-size: 10.5pt; }
</style></head>
<body>
${schoolName ? `<div class="school">${esc(schoolName)}</div>` : ''}
<div class="class-line">${heading}</div>
${sub ? `<div class="chapter">${sub}</div>` : ''}
<table class="marks-header">
  <tr><td class="k">Student Name</td><td colspan="3"></td></tr>
  <tr><td class="k">Roll No</td><td></td><td class="k">Date</td><td></td></tr>
  <tr><td class="k">Total Marks</td><td>${totalMarks(questions)}</td><td class="k">Obtained Marks</td><td></td></tr>
</table>
<div class="instructions"><b>Instructions</b>
  <ol>${INSTRUCTIONS.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>
</div>
${body.join('\n')}
</body></html>`;
}

module.exports = { renderPaper, collectQuestions, totalMarks, renderQuestion };
