/**
 * bd-60113 — splitting an I-SAPS CRQ document into gradeable items.
 *
 * Each module ships one .docx with 4 constructed-response items in a uniform
 * shape: Item No. / Concept / Marks / Reference / Scenario / Question /
 * Possible Answer / Rubric.
 *
 * The one rule that matters: the teacher is shown `prompt` (scenario +
 * question) and must NEVER see `model_answer` or `rubric` — the documents ship
 * a full worked answer directly under the question, and leaking it mid-exam
 * would make the item worthless. Those two fields are extracted precisely so
 * they can be handed to the MARKER instead, which is what makes rubric-grounded
 * AI marking possible (I-SAPS doc section 4.3 permits AI marking "based on the
 * rubrics and notes on key components of a correct answer").
 *
 * Pure: takes already-extracted document lines, returns plain objects. The
 * .docx unzipping lives in the seeder.
 */

const DEFAULT_MARKS = 10;

const RE_ITEM = /^Item No\.?\s*(\d+)/i;
const RE_CONCEPT = /^Concept\s*:\s*(.+)$/i;
const RE_MARKS = /^Marks\s*\/?\s*points?\s*:\s*(\d+)/i;
const RE_REFERENCE = /^Reference\s*:\s*(.+)$/i;
// Every heading in these documents may be GLUED to the text that follows it —
// "ScenarioYou are a mentor teacher...", "QuestionWrite a 2-3 paragraph...".
// Each therefore captures its remainder, or the first paragraph is lost. M3
// item 1 and M4 item 2 ship a glued Scenario and are exactly this case.
const RE_SCENARIO = /^Scenario\s*:?\s*(.*)$/i;
const RE_ANSWER = /^Possible Answer\s*:?\s*(.*)$/i;
const RE_RUBRIC = /^Rubric\b(.*)$/i;
const RE_QUESTION = /^Question\s*:?\s*(.*)$/i;

/**
 * @param {string[]} lines document lines, in order, already de-XML'd
 * @returns {Array<{item_no:number, concept:string, marks:number,
 *                  reference:string, scenario:string, question:string,
 *                  model_answer:string, rubric:string, prompt:string}>}
 */
function splitCrqItems(lines) {
  const src = Array.isArray(lines) ? lines : [];
  const starts = [];
  src.forEach((l, i) => {
    if (RE_ITEM.test(l || '')) starts.push(i);
  });
  if (starts.length === 0) return [];

  const items = [];
  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : src.length;
    const block = src.slice(from, to).filter((l) => (l || '').trim());

    const item = {
      item_no: Number((block[0].match(RE_ITEM) || [])[1] || s + 1),
      concept: '',
      marks: DEFAULT_MARKS,
      reference: '',
      scenario: '',
      question: '',
      model_answer: '',
      rubric: '',
      prompt: '',
    };

    // `section` tracks which heading we are under, so a paragraph is filed by
    // position rather than by guessing from its own text.
    let section = null;
    const buf = { scenario: [], question: [], model_answer: [], rubric: [] };

    for (let i = 1; i < block.length; i += 1) {
      const line = block[i];
      const mConcept = line.match(RE_CONCEPT);
      if (mConcept) { item.concept = mConcept[1].trim(); continue; }
      const mMarks = line.match(RE_MARKS);
      if (mMarks) { item.marks = Number(mMarks[1]) || DEFAULT_MARKS; continue; }
      const mRef = line.match(RE_REFERENCE);
      if (mRef) { item.reference = mRef[1].trim(); continue; }
      // Each heading switches section AND keeps any text glued to it.
      const heading = [
        ['scenario', RE_SCENARIO],
        ['model_answer', RE_ANSWER],
        ['rubric', RE_RUBRIC],
        ['question', RE_QUESTION],
      ].find(([, re]) => re.test(line));
      if (heading) {
        const [name, re] = heading;
        section = name;
        const rest = (line.match(re) || [])[1];
        if (rest && rest.trim()) buf[name].push(rest.trim());
        continue;
      }
      if (section) buf[section].push(line);
    }

    item.scenario = buf.scenario.join('\n\n').trim();
    item.question = buf.question.join('\n').trim();
    item.model_answer = buf.model_answer.join('\n\n').trim();
    item.rubric = buf.rubric.join('\n').trim();
    // What the teacher sees. Deliberately assembled from only these two.
    item.prompt = [item.scenario, item.question].filter(Boolean).join('\n\n').trim();

    items.push(item);
  }
  return items;
}

module.exports = { splitCrqItems, DEFAULT_MARKS };
