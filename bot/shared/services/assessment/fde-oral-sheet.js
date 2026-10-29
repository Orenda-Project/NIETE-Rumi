'use strict';
/**
 * The oral teacher sheet in a Grade 1-2 marking scheme (bd-5jmnfj.4.4).
 *
 * `oral` is the pattern's oral part (patterns/early/chrome.js makeOral: title,
 * note, tasks with rubric + scoring, marks) plus `content`, what the writer
 * generated for each task: `{id, script?, items:[{ask, answer?}]}`.
 *
 * Per task it prints the label and marks, the instruction, the script to read,
 * the questions with their answers and the rubric read by its scoring:
 *   each      one row, marks per right item
 *   criteria  rows that add up to the task, a score cell per row
 *   bands     pick one row (the teacher circles it)
 * then a class grid with one column per task and the oral total.
 *
 * A task with nothing generated throws: the teacher never gets an empty sheet.
 * Pure: `ctx.text` (the renderer's textOf) does all escaping and script handling.
 */

const GRID_ROWS = 12;

const COPY = {
  en: { script: 'Read aloud', items: 'Ask', answer: 'Answer', each: 'marks each', eachOne: 'mark each', circle: 'Circle one', score: 'Score', child: 'Child', total: 'Total', grid: 'Class record: oral marks' },
  ur: { script: 'پڑھ کر سنائیں', items: 'پوچھیں', answer: 'جواب', each: 'نمبر فی جواب', circle: 'ایک پر دائرہ لگائیں', score: 'نمبر', child: 'بچے کا نام', total: 'کل', grid: 'جماعت کا ریکارڈ: زبانی نمبر' },
};

function contentFor(oral, task) {
  const c = (oral.content || []).find((x) => x && x.id === task.id);
  const hasItems = c && Array.isArray(c.items) && c.items.length;
  if (!c || (!c.script && !hasItems)) throw new Error(`oral task ${task.id}: nothing was generated for it`);
  return c;
}

// A read-aloud script prints each line once: v26 G2 Urdu padded its dialogue to six turns by repeating line 4 as line 6 (bd-5jmnfj.4.58.2).
function onceEach(script) {
  const seen = new Set();
  return script.split('\n').filter((line) => {
    const k = line.replace(/\s+/g, ' ').trim();
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join('\n');
}

function rubricBlock(task, lang, t, w) {
  if (task.scoring === 'each') {
    const r = task.rubric[0];
    return `<div class="oral-rubric" data-scoring="each">${t(`${r[lang]}: ${r.marks} ${Number(r.marks) === 1 && w.eachOne ? w.eachOne : w.each}`)}</div>`;
  }
  const head = task.scoring === 'bands' ? `<div class="oral-circle">${t(w.circle)}</div>` : '';
  const cell = task.scoring === 'criteria' ? '<td class="box"></td>' : '';
  const rows = task.rubric.map((r) => `<tr><td>${t(r[lang])}</td><td class="m">${t(String(r.marks))}</td>${cell}</tr>`).join('');
  const scoreHead = task.scoring === 'criteria' ? `<th>${t(w.score)}</th>` : '';
  return `<div class="oral-rubric" data-scoring="${task.scoring}">${head}<table><tr><th></th><th></th>${scoreHead}</tr>${rows}</table></div>`;
}

function taskBlock(oral, task, lang, t, w) {
  const c = contentFor(oral, task);
  const parts = [`<div class="oral-head"><span class="lab">${t(task[`label_${lang}`])}</span> <span class="m">${t(`(${task.marks})`)}</span></div>`];
  if (task[`instruction_${lang}`]) parts.push(`<div class="oral-ins">${t(task[`instruction_${lang}`])}</div>`);
  if (c.script) parts.push(`<div class="oral-script"><div class="k">${t(w.script)}</div>${t(task.kind === 'read_aloud' ? onceEach(c.script) : c.script)}</div>`);
  // A read-aloud script with bare, answerless words under it (v25 G2 Urdu dialogue) is no list to ask.
  const bare = task.kind === 'read_aloud' && c.script && Array.isArray(c.items) && c.items.every((it) => !String(it.answer || '').trim());
  if (Array.isArray(c.items) && c.items.length && !bare) {
    const items = c.items.map((it) => `<li>${t(it.ask)}${it.answer ? ` <span class="ans">${t(`${w.answer}: ${it.answer}`)}</span>` : ''}</li>`).join('');
    parts.push(`<div class="oral-items"><div class="k">${t(w.items)}</div><ol>${items}</ol></div>`);
  }
  parts.push(rubricBlock(task, lang, t, w));
  return `<div class="oral-task" data-task="${task.id}">${parts.join('')}</div>`;
}

function gridBlock(oral, lang, t, w) {
  const cols = oral.tasks.map((task) => `<th>${t(`${task[`label_${lang}`]} (${task.marks})`)}</th>`).join('');
  const blank = `<tr class="child"><td></td>${oral.tasks.map(() => '<td></td>').join('')}<td></td></tr>`;
  return `<div class="oral-grid"><div class="k">${t(w.grid)}</div><table><tr><th>${t(w.child)}</th>${cols}<th>${t(`${w.total} (${oral.marks})`)}</th></tr>${blank.repeat(GRID_ROWS)}</table></div>`;
}

/** The sheet's HTML, or '' for a paper with no oral part. */
function oralSheet(oral, ctx) {
  if (!oral) return '';
  const lang = ctx.medium === 'ur' ? 'ur' : 'en';
  const t = ctx.text;
  const w = COPY[lang];
  const tasks = oral.tasks.map((task) => taskBlock(oral, task, lang, t, w)).join('');
  return `<section class="oral"><div class="oral-title">${t(oral[`title_${lang}`])}</div>`
    + `<div class="oral-note">${t(oral[`note_${lang}`])}</div>${tasks}${gridBlock(oral, lang, t, w)}</section>`;
}

/**
 * The child's reading card (bd-5jmnfj.4.58.3): the read-aloud tasks' words or script alone, large, on a page of
 * their own, so the child reads from a card and never from the teacher's sheet with its answers (v27 G1/G2 Urdu).
 * '' when the paper has no oral part or no read-aloud task.
 */
function childCard(oral, ctx) {
  if (!oral) return '';
  const tasks = (oral.tasks || []).filter((task) => task && task.kind === 'read_aloud');
  if (!tasks.length) return '';
  const lang = ctx.medium === 'ur' ? 'ur' : 'en';
  const t = ctx.text;
  const blocks = tasks.map((task) => {
    const c = (oral.content || []).find((x) => x && x.id === task.id) || {};
    const body = c.script ? `<div class="card-script">${t(onceEach(c.script))}</div>`
      : `<div class="card-words">${(c.items || []).filter((it) => it && it.ask).map((it) => `<span>${t(it.ask)}</span>`).join('')}</div>`;
    return `<div class="card-task" data-task="${task.id}"><div class="card-head">${t(task[`label_${lang}`])}</div>${body}</div>`;
  });
  return `<section class="oral-card">${blocks.join('')}</section>`;
}

const ORAL_CSS = `
  section.oral { break-before: page; }
  section.oral-card { break-before: page; font-size: 22pt; line-height: 1.9; text-align: center; }
  .card-task { margin-bottom: 10mm; }
  .card-head { font-weight: 700; font-size: 0.75em; margin: 6px 0 10px; }
  .card-words span { display: inline-block; margin: 4px 14px; }
  .card-script { white-space: pre-line; text-align: start; }
  .oral-title { text-align: center; font-weight: 700; font-size: 1.15em; margin-bottom: 4px; }
  .oral-note { border: 1px solid #000; padding: 4px 8px; margin-bottom: 8px; }
  .oral-task { border-top: 1px solid #000; padding: 4px 0 6px; break-inside: avoid; }
  .oral-head { font-weight: 700; }
  .oral-script { border: 1px dashed #000; padding: 4px 8px; margin: 4px 0; font-size: 1.1em; }
  .oral .k { font-weight: 700; font-size: 0.9em; }
  .oral-items ol { margin: 2px 0; }
  .oral .ans { font-style: italic; }
  .oral-rubric table, .oral-grid table { border-collapse: collapse; width: 100%; margin-top: 3px; }
  .oral-rubric td, .oral-grid td, .oral-grid th { border: 1px solid #000; padding: 2px 6px; }
  .oral-rubric td.m { width: 12mm; text-align: center; }
  .oral-rubric td.box { width: 18mm; }
  .oral-rubric th { border: 0; }
  .oral-grid { margin-top: 8px; break-inside: avoid; }
  .oral-grid tr.child td { height: 7mm; }
`;

module.exports = { oralSheet, childCard, ORAL_CSS };
