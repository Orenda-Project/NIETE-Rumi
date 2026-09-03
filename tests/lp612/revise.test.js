/**
 * reviseLessonPlan — one teacher instruction applied to a lesson she already has.
 *
 * The difference from `authorLessonPlan` is that there is NO authoring call. The document we
 * already paid ~$0.97 to write is the starting point, and her sentence enters through the same
 * `notes` channel the revision prompt already ranks above every gate finding.
 *
 * THE CENTREPIECE OF THIS SUITE is the rejection contract, because the prototype got it wrong in
 * a way that would have shipped broken lessons. To let a second round REPAIR what the first one
 * broke, the loop keeps climbing from the candidate — so on a FINAL rejected round the working
 * document is the broken one. The prototype returned exactly that, with `accepted: false` beside
 * it, and a caller that trusted `lpDoc` would have rendered and sent the very document the gates
 * had just refused.
 *
 * So the contract is absolute and asserted byte-for-byte below:
 *
 *   ACCEPTED  -> the edited document
 *   REJECTED  -> HER ORIGINAL, unchanged, every time, whatever went wrong
 *
 * The other measured behaviours, each from the 12-cell study:
 *
 *  • ROUND 1 CARRIES THE INSTRUCTION; LATER ROUNDS MUST NOT. Re-asking for "shorter homework"
 *    against an already-shortened document is how a lesson gets cut twice. 7 of 12 cells needed
 *    a repair round, so this is the common path, not the corner.
 *  • ACCEPTANCE IS ABSOLUTE, NOT RELATIVE. The authoring ladder's `notWorse` compares two
 *    candidates chasing the same target; here the incumbent is a document she ALREADY HAS and
 *    which already renders. So the bar is "introduces no new blocking defect", not "is better".
 *  • THE GATES ARE THE SAME ONES. Schema, the vendored canon lint, and — when the caller has a
 *    browser — the renderer's page caps. An edit cannot ship a document the author could not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { reviseLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const BOOK = {
  title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9,
  medium: 'en', language: 'English', offset: 4,
};
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };

const SEGMENT = {
  segment_id: 'seg-1',
  book_stem: 'grade_9_biology',
  grade: 9,
  subject: 'biology',
  medium: 'en',
  language: 'English',
  chapter_number: 1,
  chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1',
  subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis',
  section_ref: '1.2',
  printed_page_start: 11,
  printed_page_end: 12,
  pages_covered: [11, 12],
  lp_type: 'SCI-9-10',
  day_number: 1,
  skill_type: 'concept',
  slo_text: 'Describe the steps of the biological method.',
  yt: null,
  notes: null,
};

const clone = (d) => JSON.parse(JSON.stringify(d));

/** The clean fixture with its pacing knocked out — exactly one deterministic lint FAIL. */
function pacingBrokenDoc() {
  const d = clone(CLEAN_DOC);
  d.sections.find((s) => s.id === 'activity').minutes += 7;
  return d;
}

/** A plausible EDITED document: clean, but visibly different from the original. */
function editedCleanDoc() {
  const d = clone(CLEAN_DOC);
  d.one_screen = `${d.one_screen} (adjusted)`;
  return d;
}

const reply = (obj, usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage,
});

const INSTRUCTION = 'make the homework shorter';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-revise-'));
  const d = path.join(dir, SEGMENT.book_stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n,
      pdf_page_index: n + 4,
      page_type: 'content',
      blocks: [
        { t: 'heading', text: `1.${n} Observation` },
        { t: 'prose', text: `The observable body text of printed page ${n}.` },
        { t: 'list', title: 'Learning Outcomes', items: ['Describe the steps of the biological method.'] },
      ],
    }));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  delete process.env.LP_AUTHOR_MODEL;
});
afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const revise = (over = {}) => reviseLessonPlan({
  doc: CLEAN_DOC,
  instruction: INSTRUCTION,
  segment: SEGMENT,
  lang: 'en',
  model: 'test/model',
  ...over,
});

describe('it edits, it does not re-author', () => {
  it('never makes an authoring call — round 1 is already a revision', async () => {
    create.mockResolvedValue(reply(editedCleanDoc()));
    await revise();
    expect(create).toHaveBeenCalledTimes(1);
    // The authoring prompt asks for a document from page-truth; the revision prompt carries the
    // PREVIOUS document. If this were an authoring call there would be no previous doc in it.
    expect(create.mock.calls[0][0].messages[1].content).toContain('=== PREVIOUS lp_doc ===');
  });

  it('carries HER INSTRUCTION into the first round, ranked above the gate findings', async () => {
    create.mockResolvedValue(reply(editedCleanDoc()));
    await revise();
    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).toContain(INSTRUCTION);
    // The notes slot is rendered above the defect lists — that ordering is the precedence.
    expect(user.indexOf(INSTRUCTION)).toBeLessThan(user.indexOf('=== SCHEMA ERRORS ==='));
  });

  it('returns the edited document when the gates stay clean', async () => {
    const edited = editedCleanDoc();
    create.mockResolvedValue(reply(edited));
    const out = await revise();
    expect(out.accepted).toBe(true);
    expect(out.lpDoc.one_screen).toBe(edited.one_screen);
  });

  it('accounts for what the edit cost', async () => {
    create.mockResolvedValue(reply(editedCleanDoc()));
    const out = await revise();
    expect(out.usage.calls).toBe(1);
    expect(out.usage.prompt_tokens).toBe(100);
    expect(out.usage.completion_tokens).toBe(50);
  });
});

describe('THE REJECTION CONTRACT — she gets her original back, never the broken candidate', () => {
  it('returns the ORIGINAL byte-for-byte when every round introduces a blocking defect', async () => {
    create.mockResolvedValue(reply(pacingBrokenDoc()));
    const out = await revise({ rounds: 2 });

    expect(out.accepted).toBe(false);
    // The whole point. Not "close to" the original — the original.
    expect(out.lpDoc).toEqual(CLEAN_DOC);
    expect(JSON.stringify(out.lpDoc)).toBe(JSON.stringify(CLEAN_DOC));
  });

  it('returns the ORIGINAL when the model is unreachable', async () => {
    create.mockRejectedValue(new Error('502 upstream'));
    const out = await revise();
    expect(out.accepted).toBe(false);
    expect(out.lpDoc).toEqual(CLEAN_DOC);
  });

  it('returns the ORIGINAL when the reply carries no usable JSON', async () => {
    create.mockResolvedValue(reply('I have made the homework shorter for you!'));
    const out = await revise();
    expect(out.accepted).toBe(false);
    expect(out.lpDoc).toEqual(CLEAN_DOC);
  });

  it('returns the ORIGINAL when the edit breaks the SCHEMA outright', async () => {
    create.mockResolvedValue(reply({ lesson_id: 'x' }));
    const out = await revise();
    expect(out.accepted).toBe(false);
    expect(out.lpDoc).toEqual(CLEAN_DOC);
  });

  it('reports what the edit would have broken, so the copy can be honest about it', async () => {
    create.mockResolvedValue(reply(pacingBrokenDoc()));
    const out = await revise({ rounds: 1 });
    expect(out.accepted).toBe(false);
    expect(out.rejectedFails.join(' ')).toMatch(/PACING/);
  });
});

describe('repair rounds fix the edit — they do not re-apply it', () => {
  it('a second round repairs what the first broke, and the result is accepted', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))   // round 1: edit, but breaks pacing
      .mockResolvedValueOnce(reply(editedCleanDoc()));   // round 2: repaired
    const out = await revise({ rounds: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.accepted).toBe(true);
    expect(out.rounds).toBe(2);
  });

  it('the REPAIR round does not repeat her instruction — that is how a lesson gets cut twice', async () => {
    create
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(editedCleanDoc()));
    await revise({ rounds: 2 });

    const second = create.mock.calls[1][0].messages[1].content;
    expect(second).not.toContain(INSTRUCTION);
    // …and it must say the edit is already applied, or the model will helpfully undo it.
    expect(second).toMatch(/already been applied|already applied/i);
  });

  it('stops as soon as the document is clean — an accepted edit buys no further rounds', async () => {
    create.mockResolvedValue(reply(editedCleanDoc()));
    await revise({ rounds: 3 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('the gates are the author\'s gates', () => {
  it('runs the caller\'s render check on the candidate, so page caps still bind', async () => {
    const edited = editedCleanDoc();
    // HER document renders; the EDIT overflows. Modelled per-document rather than as a blanket
    // failure, because a renderCheck that also fails the original would raise the bar to match
    // and the edit would be accepted — correctly, but it would prove nothing about page caps.
    const renderCheck = jest.fn(async (d) => (
      d.one_screen === edited.one_screen
        ? ['PAGE COUNT: support needs 6 pages; the cap is 4']
        : []
    ));
    create.mockResolvedValue(reply(edited));

    const out = await revise({ rounds: 1, renderCheck });

    expect(renderCheck).toHaveBeenCalled();
    // A render defect the ORIGINAL does not have is a new blocking defect: reject, keep hers.
    expect(out.accepted).toBe(false);
    expect(out.lpDoc).toEqual(CLEAN_DOC);
    expect(out.rejectedFails.join(' ')).toMatch(/PAGE COUNT/);
  });

  it('a render defect the ORIGINAL already has does not block the edit', async () => {
    // The mirror of the case above, and the reason acceptance is measured against HER bar rather
    // than against zero: a lesson that already runs long must still be editable.
    const renderCheck = jest.fn().mockResolvedValue(['PAGE COUNT: support needs 5 pages; the cap is 4']);
    create.mockResolvedValue(reply(editedCleanDoc()));

    const out = await revise({ rounds: 1, renderCheck });

    expect(out.accepted).toBe(true);
  });

  it('an edit that FIXES an existing defect is accepted', async () => {
    // She is starting from a document that already carries one blocking defect.
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await revise({ doc: pacingBrokenDoc() });
    expect(out.accepted).toBe(true);
  });
});

describe('input contract', () => {
  it.each([null, undefined, ''])('refuses an empty instruction (%p) without calling the model', async (instruction) => {
    await expect(revise({ instruction })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a missing document without calling the model', async () => {
    await expect(revise({ doc: null })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
