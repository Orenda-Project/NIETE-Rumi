/**
 * E2E harness for bd-yhd16 — a teacher taps «اردو» and the chain runs for real.
 *
 * Doubled here, and ONLY here, are the network hops: the model (`llm-client`), R2, PostgREST,
 * SQS and Meta. `lp612-render.service` is doubled too because it launches Chromium as a separate
 * process; it is given a real PDF on disk so the worker's own `fs` read is not faked.
 *
 * Everything between the tap and the upload is the shipped code: `requestLesson`'s cache
 * decision, the worker, `reuseFromPreviousVersion`, `authorLessonPlan`, `overlayLessonPlan` and
 * the linter's own `overlayTargets`.
 *
 * `jest.mock(...)` is hoisted per FILE, so the mock factories stay in the test file and this
 * module is required after them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLEAN_DOC = require('../__fixtures__/v9_gate_base.lp.json');

const { overlayDefects } = require(path.join(
  __dirname, '..', '..', '..', 'bot', 'vendor', 'lp-v9', 'lint_lp.js',
));

const SEG_ID = 'grade_9_mathematics.c01.p024-025';

const SEGMENT = {
  segment_id: SEG_ID, book_stem: 'grade_9_mathematics', grade: 9, subject: 'Mathematics',
  medium: 'en', language: 'en', chapter_number: 1, chapter_title: 'Matrices and Determinants',
  chapter_key: 'g9-math-ch1', subtopic_title: 'Multiplying two 2×2 matrices',
  menu_title: 'Multiplying 2×2 matrices', printed_page_start: 24, printed_page_end: 25,
  pages_covered: [24, 25], order_index: 2, lp_type: 'MATH-9-10', yt: null,
  is_current: true, is_religious: false,
};

const BOOK = {
  title: 'Mathematics 9', publisher: 'PCTB', subject: 'mathematics', grade: 9,
  medium: 'en', language: 'English', offset: 10,
};
const TOC = { chapters: [{ number: 1, title: 'Matrices and Determinants', printed_start: 20 }] };

const clean = () => JSON.parse(JSON.stringify(CLEAN_DOC));

/**
 * The stored v9.2 Urdu document — the shape 82 production rows are in today.
 *
 * Its body overlay is COMPLETE, so `overlayDefects` coverage is satisfied and nothing else has a
 * reason to refuse it. The only thing missing is the chrome bd-x3dn6 added to the target set.
 */
function staleStoredUrdu() {
  const d = clean();
  d.template_version = 'v9.2';
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = 'اردو ہدایت';
  }
  return d;
}

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

/** The Urdu the overlay pass would get back: every pointer it asked for, translated. */
const URDU_TOPIC = 'دو ۲×۲ میٹرکس کا ضرب';
function overlayReplyFor(user) {
  const map = JSON.parse(user.slice(user.indexOf('{')));
  const out = {};
  for (const ptr of Object.keys(map)) {
    out[ptr] = ptr === '/provenance/topic' ? URDU_TOPIC : 'اردو ہدایت برائے استاد';
  }
  return out;
}

/** Author call or overlay call? The overlay brief names itself in its first sentence. */
const isOverlayCall = (args) =>
  /You translate the INSTRUCTION STRINGS/.test(String((args.messages || [])
    .map((m) => m.content).join('\n')));

function installLlm(create) {
  create.mockImplementation(async (args) => {
    const msgs = args.messages || [];
    const user = String((msgs.find((m) => m.role === 'user') || {}).content || '');
    if (isOverlayCall(args)) return reply(overlayReplyFor(user));
    return reply(clean());
  });
}

/** A throwaway page-truth tree, and a real one-byte PDF for the worker to read. */
function installFixtureTree() {
  const state = {};
  beforeEach(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-chrome-'));
    const d = path.join(state.dir, SEGMENT.book_stem);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
    for (const n of [24, 25]) {
      fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
        printed_page_number: n, pdf_page_index: n + 10, page_type: 'content',
        blocks: [{ t: 'heading', text: `1.${n} Matrix multiplication` }],
      }));
    }
    state.pdfPath = path.join(state.dir, 'lesson.pdf');
    fs.writeFileSync(state.pdfPath, Buffer.from('%PDF-1.7 e2e\n%%EOF\n'));
    process.env.LP612_PAGE_TRUTH_DIR = state.dir;
  });
  afterEach(() => { delete process.env.LP612_PAGE_TRUTH_DIR; });
  return state;
}

module.exports = {
  SEG_ID, SEGMENT, BOOK, TOC, URDU_TOPIC,
  clean, staleStoredUrdu, reply, installLlm, installFixtureTree, overlayDefects,
};
