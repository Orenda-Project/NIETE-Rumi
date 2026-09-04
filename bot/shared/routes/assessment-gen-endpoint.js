'use strict';
/**
 * The Assessment Generator Flow, driven from the server.
 *
 *   CLASS ──▶ COVERAGE ──┬─▶ QUESTIONS ──┬─▶ CONFIRM ──▶ (Flow closes)
 *                        └─▶ PAGES ──────┘   (via TYPES if she asks)
 *
 * CONFIRM is the terminal screen: it submits AND closes. The acknowledgement
 * arrives as a chat message rather than on a screen she has to dismiss.
 *
 * Every list she sees is built here as the screen is requested, rather than
 * published into the Flow and left to drift: the subjects offered are the books
 * we actually hold for her grade, the chapters are that book's real contents
 * page, and the question types are the ones valid for that subject. A teacher
 * cannot pick something we then have to refuse.
 *
 * State between screens lives in Redis under the flow token. Flows are
 * stateless by design — what she chose two screens ago is only knowable because
 * we wrote it down.
 */

const redis = require('../services/cache/railway-redis.service');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const BookContent = require('../services/assessment/book-content.service');
const QuestionTypes = require('../services/assessment/question-types');
const SQSQueueService = require('../services/queue');

const SESSION_TTL_SECONDS = 15 * 60;

const SUBJECT_TITLE = {
  english: 'English', urdu: 'Urdu', maths: 'Maths', islamiat: 'Islamiat',
  science: 'Science', general_knowledge: 'General Knowledge', social_studies: 'Social Studies',
};

// Which subjects a grade is actually taught. Science and Social Studies start at
// Grade 4; General Knowledge stops at Grade 3. Offering one outside its band
// produces a book we do not have and a refusal she cannot act on.
const GRADE_BANDS = {
  science: [4, 5],
  social_studies: [4, 5],
  general_knowledge: [1, 2, 3],
};

const COUNT_CHOICES = [10, 15, 20, 25, 30];

function sessionKey(token) { return `assessment_gen:${token || 'no-token'}`; }

async function readSession(token) {
  try {
    const s = await redis.get(sessionKey(token));
    return (s && typeof s === 'object') ? s : {};
  } catch (err) {
    logToFile('[assessment-flow] session read failed', { error: err.message });
    return {};
  }
}

async function writeSession(token, state) {
  try {
    await redis.set(sessionKey(token), state, SESSION_TTL_SECONDS);
  } catch (err) {
    logToFile('[assessment-flow] session write failed', { error: err.message });
  }
}

async function clearSession(token) {
  try { await redis.delete(sessionKey(token)); } catch { /* best effort */ }
}

// Meta requires a component's `visible` to be a boolean, not a truthy string,
// so the error TEXT and the decision to SHOW it are two fields. Deriving the
// flag here means no caller can set one and forget the other.
const screen = (id, data) => ({
  screen: id,
  data: ('error' in (data || {})) ? { ...data, has_error: Boolean(data.error) } : data,
});

/** Which grades we hold any book for. */
async function gradesOnOffer() {
  const { data } = await supabase
    .from('textbooks').select('grade').eq('curriculum', 'ict');
  const grades = [...new Set((data || []).map((r) => r.grade))].filter(Boolean).sort();
  return grades.map((g) => ({ id: String(g), title: `Grade ${g}` }));
}

/** Which subjects we hold a book for, in this grade. */
async function subjectsOnOffer(grade) {
  const { data } = await supabase
    .from('textbooks').select('subject').eq('curriculum', 'ict').eq('grade', Number(grade));
  return (data || [])
    .map((r) => r.subject)
    .filter((s) => {
      const band = GRADE_BANDS[s];
      return !band || band.includes(Number(grade));
    })
    .map((s) => ({ id: s, title: SUBJECT_TITLE[s] || s }));
}

function summaryOf(state) {
  return [
    state.grade ? `Grade ${state.grade}` : null,
    SUBJECT_TITLE[state.subject] || state.subject,
    state.chapterTitle ? `Chapter ${state.chapterNumber} · ${state.chapterTitle}` : null,
    (!state.chapterNumber && state.pageRanges) ? `Pages ${state.pageRanges}` : null,
  ].filter(Boolean).join(' · ');
}

// ── The review journey ──────────────────────────────────────────────────────
//
// She comes back to this Flow already holding a paper, so her token names a
// PAPER rather than a half-built request: `<userId>:assessment-review:<paperId>`.
// Same Flow, same endpoint, different entry point — which is why the token, not
// a screen id, decides where INIT lands.
//
//   KEEP ──▶ PICK ──▶ one of six screens, by question shape ──▶ PICK_DONE
//
// Removing and editing are two jobs, so they are two screens. On one screen,
// unticking a question and then editing it are contradictory actions taken in
// the same breath; ordered, the second list never offers a question she already
// dropped.

// Required lazily, at call time, NOT at module scope. The revision service
// reaches R2 and so pulls in `@aws-sdk/client-s3`, which lives in bot/ — and CI
// runs the root suite before bot's deps are installed. A top-level require here
// kills every root suite that loads this endpoint for an unrelated reason.
const Selection = require('../services/assessment/assessment-selection');
const Edit = require('../services/assessment/assessment-edit');
const { isAssessmentEditingEnabled } = require('../config/feature-flags');
const revision = () => require('../services/assessment/assessment-revision.service');

const REVIEW_MARKER = ':assessment-review:';

/**
 * A NavigationList row's title, description and metadata are each capped at 20
 * characters — CLIENT-SIDE. The Flow JSON uploads and publishes clean because
 * these are data, not literals, so nothing catches an over-long value until a
 * teacher taps and the screen refuses to render. "1 mark · MCQs" fits;
 * "4 marks · Match the Column" does not, and it took the PICK screen down.
 */
const NAV_MAX = 20;

/** Fit a row field to the cap, cutting at a word boundary where one is close. */
function navFit(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= NAV_MAX) return t;
  const cut = t.slice(0, NAV_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > NAV_MAX * 0.5 ? cut.slice(0, space) : cut).replace(/[\s\W]+$/, '');
}

/**
 * What a question says on a list row.
 *
 * The MARKS lead, because they are the thing she is weighing when she decides
 * what to fix, and they are what survives the cap. The type follows only if
 * there is room left for it to be read.
 */
function navDescription(q) {
  const marks = `${q.marks} mark${q.marks === 1 ? '' : 's'}`;
  const withType = `${marks} · ${q.type || ''}`.trim();
  return withType.length <= NAV_MAX ? withType : marks;
}

/** Which screen each question shape is edited on. */
const SHAPE_SCREEN = {
  standard: 'EDIT_STANDARD',
  options: 'EDIT_OPTIONS',
  columns: 'EDIT_COLUMNS',
  words: 'EDIT_WORDS',
  passage: 'EDIT_PASSAGE',
  comprehension: 'EDIT_COMPREHENSION',
};

/** The paper id a review token names, or null for an ordinary session. */
function paperIdFromToken(flowToken) {
  const i = String(flowToken || '').indexOf(REVIEW_MARKER);
  return i === -1 ? null : String(flowToken).slice(i + REVIEW_MARKER.length) || null;
}

function totalsOf(items, selected) {
  const keep = new Set(selected);
  const kept = items.filter((q) => keep.has(q.id));
  const marks = kept.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  return { count: kept.length, marks, kept };
}

/**
 * One page of the tick list.
 *
 * `selected` is the running answer for the WHOLE paper and lives in the session,
 * not in the form: the form only knows the twenty rows on screen, so trusting it
 * alone would drop every question she never scrolled to.
 */
function keepScreen({ items, selected, page, error = '' }) {
  const view = Selection.pageOf(items, page);
  const keep = new Set(selected);
  const t = totalsOf(items, selected);
  return screen('KEEP', {
    summary: `${t.count} question${t.count === 1 ? '' : 's'} · ${t.marks} marks`,
    progress: view.total > view.items.length
      ? `Questions ${view.from}-${view.to} of ${view.total}` : '',
    questions: view.items.map((q) => ({
      id: q.id,
      title: Selection.optionTitle(q),
      description: `${q.marks} mark${q.marks === 1 ? '' : 's'}${q.type ? ` · ${q.type}` : ''}`,
    })),
    selected: view.items.filter((q) => keep.has(q.id)).map((q) => q.id),
    page: String(view.index),
    has_prev: view.hasPrev,
    has_next: view.hasNext,
    error,
  });
}

/** An empty tick list that explains itself, for when there is no paper. */
function reviewError(message) {
  return screen('KEEP', {
    summary: '', progress: '', questions: [], selected: [],
    page: '0', has_prev: false, has_next: false, error: message,
  });
}

/**
 * The picker — built from what survived KEEP.
 *
 * A NavigationList must be the only component on its screen (the repo's own
 * guard enforces it), so the rebuild button lives on PICK_DONE next door rather
 * than under the list.
 */
function pickScreen({ items, selected }) {
  const { kept } = totalsOf(items, selected);
  return screen('PICK', {
    items: kept.map((q) => ({
      id: q.id,
      'main-content': {
        title: navFit(Selection.optionTitle(q)),
        description: navDescription(q),
        metadata: '',
      },
      'on-click-action': {
        name: 'data_exchange',
        payload: { _action: 'open', question_id: q.id },
      },
    })),
  });
}

function pickDoneScreen({ items, selected, error = '' }) {
  const t = totalsOf(items, selected);
  return screen('PICK_DONE', {
    summary: `${t.count} question${t.count === 1 ? '' : 's'} · ${t.marks} marks`,
    note: 'Nothing to fix? Just rebuild.',
    error,
  });
}

/** The edit screen for one question, pre-filled with what it currently says. */
function editScreen(item, { error = '', overrides = null } = {}) {
  const shape = item.shape || Edit.shapeOf(item.question);
  const f = Edit.fieldsFor(item.question);
  const data = {
    heading: `سوال ${item.number} · Question ${item.number}`,
    subheading: `${item.type || ''} · ${item.marks} mark${item.marks === 1 ? '' : 's'}`.trim(),
    marks_hint: 'A whole number, 1 or more.',
    question: f.question,
    marks: Number(f.marks) || 1,
    error,
  };

  if (shape === 'options' || shape === 'words') {
    const label = shape === 'words' ? 'لفظ' : 'جواب';
    f.slots.forEach((v, i) => {
      data[`slot_${i}`] = v;
      data[`slot_label_${i}`] = `${label} ${i + 1}`;
      // A blank beyond the first free one is hidden: showing six empty boxes on
      // a question that has two options is noise, not affordance.
      data[`slot_show_${i}`] = i < f.slots.filter((x) => x !== '').length + 1;
    });
  } else if (shape === 'columns') {
    const filled = f.pairs.filter((p) => p.left || p.right).length;
    f.pairs.forEach((p, i) => {
      data[`left_${i}`] = p.left;
      data[`right_${i}`] = p.right;
      data[`left_label_${i}`] = `جوڑا ${i + 1} — بائیں · Pair ${i + 1} left`;
      data[`right_label_${i}`] = `جوڑا ${i + 1} — دائیں · Pair ${i + 1} right`;
      data[`pair_show_${i}`] = i < filled + 1;
    });
  } else if (shape === 'passage') {
    data.passage = f.passage;
    data.section = f.section || '';
  } else if (shape === 'comprehension') {
    data.passage = f.passage;
    data.subs = f.subs.map((sub) => ({
      id: `sub-${sub.index}`,
      'main-content': {
        title: navFit(`${String.fromCharCode(97 + sub.index)}) ${sub.text}`),
        description: sub.marks == null ? '' : navFit(`${sub.marks} marks`),
        metadata: '',
      },
      'on-click-action': {
        name: 'data_exchange',
        payload: { _action: 'open_sub', question_id: item.id, sub_index: String(sub.index) },
      },
    }));
  }

  // On a refusal her typing must survive, or she retypes the whole question.
  if (overrides) Object.assign(data, overrides);
  return screen(SHAPE_SCREEN[shape] || 'EDIT_STANDARD', data);
}

/** The sub-question screen, carrying its passage as context. */
function subScreen(item, subIndex, { error = '', overrides = null } = {}) {
  const f = Edit.fieldsFor(item.question);
  const sub = f.subs[subIndex] || { text: '', marks: null };
  const raw = (item.question.questions || [])[subIndex] || {};
  const options = Array.isArray(raw.options) ? raw.options : [];
  const data = {
    heading: `سوال ${item.number} · ${String.fromCharCode(97 + subIndex)}`,
    subheading: sub.marks == null ? '' : `${sub.marks} marks`,
    marks_hint: 'A whole number, 1 or more.',
    passage_hint: `Passage: "${String(f.passage).slice(0, 60)}…"`,
    question: sub.text,
    marks: Number(sub.marks) || 1,
    error,
  };
  const slots = [...options.map(String)];
  while (slots.length < Edit.SLOT_CAP) slots.push('');
  slots.forEach((v, i) => {
    data[`slot_${i}`] = v;
    data[`slot_label_${i}`] = `جواب ${i + 1}`;
    data[`slot_show_${i}`] = i < options.length + 1;
  });
  if (overrides) Object.assign(data, overrides);
  return screen('EDIT_SUB', data);
}

/** Collect slot_0..slot_N off a submitted form, in order. */
function slotsFrom(data, prefix = 'slot_') {
  const out = [];
  for (let i = 0; i < Edit.SLOT_CAP; i += 1) out.push(String(data[`${prefix}${i}`] ?? ''));
  return out;
}

async function loadItems(state, flowToken, userId) {
  const paperId = state.paperId || paperIdFromToken(flowToken);
  const owner = state.userId || userId;
  const { items, code } = await revision().listQuestions({ paperId, userId: owner });
  return { items, code, paperId, owner };
}

async function openReview(userId, paperId, flowToken) {
  const { items, code } = await revision().listQuestions({ paperId, userId });
  if (!items) {
    return reviewError(code === 'NOT_READY'
      ? 'That paper is still being made. I will send it here when it is done.'
      : "I couldn't find that paper. Send /assessment to make a new one.");
  }
  const selected = items.filter((q) => q.selected).map((q) => q.id);
  await writeSession(flowToken, { userId, paperId, page: 0, selected });
  return keepScreen({ items, selected, page: 0 });
}

/**
 * Fold this page's ticks into the answer for the whole paper.
 *
 * Only the ids ON THIS PAGE are decided by `keep`; everything else keeps what it
 * had. Replacing the whole set would untick every question she has not scrolled
 * to — the paper would quietly shrink to one screenful.
 */
function mergePageTicks({ selected, pageIds, keep }) {
  const onPage = new Set(pageIds);
  const ticked = new Set(Array.isArray(keep) ? keep : []);
  const out = new Set((selected || []).filter((id) => !onPage.has(id)));
  for (const id of pageIds) if (ticked.has(id)) out.add(id);
  return out;
}

async function handleKeep(userId, data, flowToken) {
  const state = await readSession(flowToken);
  const { items, paperId, owner } = await loadItems(state, flowToken, userId);
  if (!items) return reviewError("I couldn't find that paper. Send /assessment to make a new one.");

  const page = Number.parseInt(data.page, 10) || 0;
  const view = Selection.pageOf(items, page);
  const selected = [...mergePageTicks({
    selected: state.selected ?? items.map((q) => q.id),
    pageIds: view.items.map((q) => q.id),
    keep: data.keep,
  })];

  const action = String(data._action || 'done');
  const save = (extra) => writeSession(flowToken, { ...state, userId: owner, paperId, ...extra });

  if (action === 'next' || action === 'prev') {
    const nextPage = action === 'next' ? view.index + 1 : view.index - 1;
    await save({ page: nextPage, selected });
    return keepScreen({ items, selected, page: nextPage });
  }

  // She can untick everything; it is a real state and it means something. Saying
  // so here keeps her one tap from a paper.
  if (selected.length === 0) {
    await save({ page: view.index, selected });
    return keepScreen({
      items, selected, page: view.index,
      error: 'Keep at least one question, then tap Next.',
    });
  }

  await save({ page: view.index, selected });

  // Editing off: ticking is the whole journey, so Next rebuilds rather than
  // handing her a picker whose every row leads to a screen she cannot open.
  if (!(await isAssessmentEditingEnabled())) {
    return rebuildAndClose({ paperId, owner, selected, flowToken });
  }
  return pickScreen({ items, selected });
}

async function handlePick(userId, data, flowToken) {
  const state = await readSession(flowToken);
  const { items } = await loadItems(state, flowToken, userId);
  if (!items) return reviewError("I couldn't find that paper. Send /assessment to make a new one.");
  const selected = state.selected ?? items.map((q) => q.id);

  const action = String(data._action || 'summary');
  if (action === 'open') {
    // A gate, not a UI hint: a stale or hand-built client must not be able to
    // walk into a screen the deployment has switched off.
    if (!(await isAssessmentEditingEnabled())) {
      return pickDoneScreen({ items, selected });
    }
    const item = items.find((q) => q.id === data.question_id);
    if (!item) {
      return pickDoneScreen({
        items, selected, error: 'That question is no longer on the paper.',
      });
    }
    await writeSession(flowToken, { ...state, editing: item.id, editingSub: null });
    return editScreen(item);
  }
  return pickDoneScreen({ items, selected });
}

/** Rebuild the paper from her ticks and end the Flow. Shared by two paths. */
async function rebuildAndClose({ paperId, owner, selected, flowToken }) {
  const result = await revision().rerender({ paperId, userId: owner, selectedIds: selected });
  await clearSession(flowToken);

  if (result.status !== 'ready') return done('rebuild_failed', result.code || '');

  const n = result.questionCount;
  return done('rebuilt', `${n} question${n === 1 ? '' : 's'}`
    + `${result.marks ? ` · ${result.marks} marks` : ''}`);
}

async function handlePickDone(userId, data, flowToken) {
  const state = await readSession(flowToken);
  const { items, paperId, owner } = await loadItems(state, flowToken, userId);
  if (!items) return reviewError("I couldn't find that paper. Send /assessment to make a new one.");
  const selected = state.selected ?? items.map((q) => q.id);

  if (String(data._action) === 'pick') return pickScreen({ items, selected });

  if (!selected.length) {
    return pickDoneScreen({ items, selected, error: 'Keep at least one question.' });
  }

  return rebuildAndClose({ paperId, owner, selected, flowToken });
}

async function handleEditSave(userId, screenId, data, flowToken) {
  const state = await readSession(flowToken);
  const { items, paperId, owner } = await loadItems(state, flowToken, userId);
  if (!items) return reviewError("I couldn't find that paper. Send /assessment to make a new one.");
  const selected = state.selected ?? items.map((q) => q.id);

  // Checked here too, and before anything is written: the screen is only one of
  // three ways into this handler, and the other two do not pass through PICK.
  if (!(await isAssessmentEditingEnabled())) {
    return pickDoneScreen({ items, selected });
  }

  // The payload names the question wherever it can — a NavigationList row
  // carries its own id, and trusting only the session breaks when she reopens
  // the Flow or the session has rolled.
  const wantedId = data.question_id || state.editing;
  const item = items.find((q) => q.id === wantedId);
  if (!item) return pickDoneScreen({ items, selected, error: 'That question is no longer there.' });

  // A comprehension screen is a list, not a form: its only action is opening a
  // sub-question.
  if (screenId === 'EDIT_COMPREHENSION') {
    if (String(data._action) === 'open_sub') {
      const idx = Number.parseInt(data.sub_index, 10) || 0;
      await writeSession(flowToken, { ...state, editing: item.id, editingSub: idx });
      return subScreen(item, idx);
    }
    return pickDoneScreen({ items, selected });
  }

  const shape = item.shape || Edit.shapeOf(item.question);
  const edit = {};
  if (data.question !== undefined) edit.question = data.question;
  if (data.passage !== undefined) edit.passage = data.passage;
  if (data.marks !== undefined) edit.marks = data.marks;

  const isSub = screenId === 'EDIT_SUB';
  if (isSub) edit.subIndex = state.editingSub ?? 0;

  if (isSub || shape === 'options' || shape === 'words') edit.slots = slotsFrom(data);
  if (shape === 'columns') {
    edit.pairs = [];
    for (let i = 0; i < Edit.SLOT_CAP; i += 1) {
      edit.pairs.push({ left: String(data[`left_${i}`] ?? ''), right: String(data[`right_${i}`] ?? '') });
    }
  }

  const res = await revision().saveEdit({ paperId, userId: owner, questionId: item.id, edit });

  if (res.status !== 'ok') {
    // Back to the SAME screen, carrying what she typed — a refusal that clears
    // the form makes her retype the whole question to fix one field.
    const overrides = { question: data.question ?? undefined };
    if (edit.slots) edit.slots.forEach((v, i) => { overrides[`slot_${i}`] = v; });
    if (edit.pairs) {
      edit.pairs.forEach((p, i) => { overrides[`left_${i}`] = p.left; overrides[`right_${i}`] = p.right; });
    }
    return isSub
      ? subScreen(item, edit.subIndex, { error: res.message, overrides })
      : editScreen(item, { error: res.message, overrides });
  }

  const fresh = await revision().listQuestions({ paperId, userId: owner });
  const nextItems = fresh.items || items;
  if (isSub) {
    const parent = nextItems.find((q) => q.id === item.id) || item;
    await writeSession(flowToken, { ...state, editingSub: null });
    return editScreen(parent);
  }
  await writeSession(flowToken, { ...state, editing: null, editingSub: null });
  return pickDoneScreen({ items: nextItems, selected });
}

/**
 * Finish the Flow.
 *
 * There is no closing screen. "Making your paper — about a minute, it will
 * arrive in this chat" is a sentence ABOUT the chat, so the chat is where it
 * belongs; a screen carrying it cost the teacher a tap to dismiss and told her
 * nothing she could act on.
 *
 * Meta only allows `complete` on a terminal screen, so CONFIRM and PICK_DONE
 * ARE the terminal screens — their Footer completes and the Flow closes. What
 * comes back here is the payload that rides out with the completion: the router
 * matches on `assessment_action` and sends the acknowledgement as a message.
 */
function done(action, summary) {
  return {
    screen: 'SUCCESS',
    data: {
      extension_message_response: { params: { assessment_action: action, summary: summary || '' } },
    },
  };
}

async function handleInit(userId, flowToken) {
  // A review token means she already has a paper and wants to trim it. Checked
  // before anything else, because every screen below assumes a fresh request.
  const reviewPaperId = paperIdFromToken(flowToken);
  if (reviewPaperId) return openReview(userId, reviewPaperId, flowToken);

  await writeSession(flowToken, { userId });
  const grades = await gradesOnOffer();
  if (grades.length === 0) {
    // Nothing imported yet. Say so rather than showing an empty dropdown.
    return screen('CLASS', {
      grades: [], subjects: [],
      error: 'No books are loaded yet. Please try again later.',
    });
  }
  // Subjects are filled in properly once she picks a grade; the first render
  // needs a non-empty list because the component requires one.
  const subjects = await subjectsOnOffer(grades[0].id);
  return screen('CLASS', { grades, subjects, error: '' });
}

async function handleDataExchange(userId, screenId, formData, flowToken) {
  const state = await readSession(flowToken);
  state.userId = state.userId || userId;
  const data = formData || {};

  // ── The review journey ───────────────────────────────────────────────────
  // Its own path, entered by token rather than by walking the screens above.
  if (screenId === 'KEEP') return handleKeep(userId, data, flowToken);
  if (screenId === 'PICK') return handlePick(userId, data, flowToken);
  if (screenId === 'PICK_DONE') return handlePickDone(userId, data, flowToken);
  if (String(screenId).startsWith('EDIT_')) {
    return handleEditSave(userId, screenId, data, flowToken);
  }

  // ── CLASS → COVERAGE ─────────────────────────────────────────────────────
  if (screenId === 'CLASS') {
    const grade = Number(data.grade);
    const subject = String(data.subject || '');
    const subjects = await subjectsOnOffer(grade);

    // A stale client can submit a pair that is not on offer. Re-render rather
    // than accept it — the next screen would only fail on a missing book.
    if (!subjects.some((s) => s.id === subject)) {
      return screen('CLASS', {
        grades: await gradesOnOffer(), subjects,
        error: `We don't have that subject for Grade ${grade}. Please pick another.`,
      });
    }

    Object.assign(state, { grade, subject, chapterNumber: null, chapterTitle: null, pageRanges: null });
    await writeSession(flowToken, state);

    let chapters = [];
    try {
      chapters = await BookContent.listChapters({ grade, subject });
    } catch (err) {
      logToFile('[assessment-flow] chapter list failed', { grade, subject, error: err.message });
    }

    if (chapters.length === 0) {
      // No contents page for this book — page numbers are the only way in.
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: 'Type the pages you want, for example 4-14.',
        error: '',
      });
    }

    return screen('COVERAGE', {
      summary: summaryOf(state),
      has_chapters: true,
      chapters: chapters.map((c) => ({
        id: String(c.chapterNumber),
        title: `${c.chapterNumber} · ${c.title}`
          + (c.pageStart ? ` (pages ${c.pageStart}-${c.pageEnd})` : ''),
      })),
      error: '',
    });
  }

  // ── COVERAGE → PAGES | QUESTIONS ─────────────────────────────────────────
  if (screenId === 'COVERAGE') {
    const wantsPages = data.use_pages === true || data.use_pages === 'true';
    if (wantsPages) {
      const book = await bookFacts(state);
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: book.totalPages
          ? `This book has pages 1-${book.totalPages}.`
          : 'Type the pages you want, for example 4-14.',
        error: '',
      });
    }

    const chapterNumber = Number(data.chapter);
    if (!chapterNumber) {
      return screen('COVERAGE', {
        summary: summaryOf(state), has_chapters: true,
        chapters: await chapterOptions(state),
        error: 'Please choose a chapter, or tick the box to type page numbers.',
      });
    }

    const chapters = await BookContent.listChapters({ grade: state.grade, subject: state.subject });
    const chosen = chapters.find((c) => c.chapterNumber === chapterNumber);
    Object.assign(state, { chapterNumber, chapterTitle: chosen ? chosen.title : null, pageRanges: null });
    await writeSession(flowToken, state);
    return questionsScreen(state);
  }

  // ── PAGES → QUESTIONS ────────────────────────────────────────────────────
  if (screenId === 'PAGES') {
    const pageRanges = String(data.page_ranges || '').trim();
    const book = await bookFacts(state);
    try {
      const pages = BookContent.parsePageRanges(pageRanges);
      const beyond = book.totalPages ? pages.filter((p) => p > book.totalPages) : [];
      if (beyond.length) {
        return screen('PAGES', {
          summary: summaryOf(state),
          hint: `This book has pages 1-${book.totalPages}.`,
          error: `This book has pages 1-${book.totalPages}. You asked for ${beyond.join(', ')}.`,
        });
      }
    } catch (err) {
      return screen('PAGES', {
        summary: summaryOf(state),
        hint: book.totalPages ? `This book has pages 1-${book.totalPages}.` : '',
        error: 'Try something like 4-14, or 4, 9, 12.',
      });
    }
    Object.assign(state, { pageRanges, chapterNumber: null, chapterTitle: null });
    await writeSession(flowToken, state);
    return questionsScreen(state);
  }

  // ── QUESTIONS → TYPES | CONFIRM ──────────────────────────────────────────
  if (screenId === 'QUESTIONS') {
    Object.assign(state, {
      contentSource: String(data.content_source || 'unseen'),
      questionCount: Number(data.question_count) || 20,
    });
    await writeSession(flowToken, state);

    const wantsTypes = data.pick_types === true || data.pick_types === 'true';
    if (wantsTypes) {
      return screen('TYPES', {
        summary: summaryOf(state),
        types: QuestionTypes.forSubject(state.subject, state.grade)
          .map((t) => ({ id: t.id, title: t.id })),
        error: '',
      });
    }
    return confirmScreen(state);
  }

  // ── TYPES → CONFIRM ──────────────────────────────────────────────────────
  if (screenId === 'TYPES') {
    const picked = Array.isArray(data.question_types) ? data.question_types : [];
    if (picked.length === 0) {
      return screen('TYPES', {
        summary: summaryOf(state),
        types: QuestionTypes.forSubject(state.subject, state.grade).map((t) => ({ id: t.id, title: t.id })),
        error: 'Please choose at least one kind of question.',
      });
    }
    state.pickedTypes = picked;
    await writeSession(flowToken, state);
    return confirmScreen(state);
  }

  // ── CONFIRM → queue the job, then close the Flow ─────────────────────────
  if (screenId === 'CONFIRM') {
    Object.assign(state, {
      outputFormat: String(data.output_format || 'pdf'),
      answerLines: data.answer_lines !== false && data.answer_lines !== 'false',
      answerKey: data.answer_key === true || data.answer_key === 'true',
    });

    try {
      await submit(state);
    } catch (err) {
      logToFile('[assessment-flow] submit failed', { error: err.message, userId: state.userId });
      // The terminal screen is shared, so every line of it has to change on the
      // failure path. Leaving the heading and caption saying a paper is coming
      // is worse than the failure: she waits for something nobody is making.
      return done('queue_failed');
    }

    await clearSession(flowToken);
    return done('queued', summaryOf(state));
  }

  logToFile('[assessment-flow] unknown screen', { screenId });
  return screen('CLASS', { grades: await gradesOnOffer(), subjects: [], error: '' });
}

async function chapterOptions(state) {
  try {
    const chapters = await BookContent.listChapters({ grade: state.grade, subject: state.subject });
    return chapters.map((c) => ({
      id: String(c.chapterNumber),
      title: `${c.chapterNumber} · ${c.title}${c.pageStart ? ` (pages ${c.pageStart}-${c.pageEnd})` : ''}`,
    }));
  } catch { return []; }
}

async function bookFacts(state) {
  const { data } = await supabase
    .from('textbooks').select('id, total_pages')
    .eq('curriculum', 'ict').eq('grade', Number(state.grade)).eq('subject', state.subject)
    .maybeSingle();
  return { id: data?.id || null, totalPages: data?.total_pages || null };
}

function questionsScreen(state) {
  return screen('QUESTIONS', {
    summary: summaryOf(state),
    counts: COUNT_CHOICES.map((n) => ({ id: String(n), title: `${n} questions` })),
    error: '',
  });
}

function confirmScreen(state) {
  const source = {
    seen: 'Questions from the book',
    unseen: 'New questions',
    both: 'A mix',
  }[state.contentSource] || 'New questions';
  return screen('CONFIRM', {
    recap: [summaryOf(state), `${source} · ${state.questionCount} questions`].join('\n'),
    error: '',
  });
}

/**
 * Write the request down, then queue the work. In that order: the row is what
 * the worker is handed and what the watchdog looks for, so a queued job that
 * refers to nothing is worse than a row with no job.
 */
/**
 * The pages a chapter covers, or null when the contents page never said.
 * Best-effort: a request whose coverage cannot be named is still a request,
 * and the generator works from the chapter number regardless.
 */
async function chapterPageRange(state) {
  try {
    const chapters = await BookContent.listChapters({
      grade: state.grade, subject: state.subject,
    });
    const c = chapters.find((x) => x.chapterNumber === Number(state.chapterNumber));
    return (c && c.pageStart != null && c.pageEnd != null)
      ? `${c.pageStart}-${c.pageEnd}` : null;
  } catch (err) {
    logToFile('[assessment-flow] could not resolve chapter pages', {
      grade: state.grade, subject: state.subject,
      chapter: state.chapterNumber, error: err.message,
    });
    return null;
  }
}

async function submit(state) {
  const book = await bookFacts(state);

  // She chose a chapter, not pages — but the row should still say which pages
  // it covers, so a request is readable later without re-reading the contents
  // page (which can change under a re-import).
  const pageRanges = state.pageRanges
    || (state.chapterNumber != null ? await chapterPageRange(state) : null);

  const types = (state.pickedTypes && state.pickedTypes.length)
    ? QuestionTypes.withCounts(state.pickedTypes, state.questionCount, state.subject, state.grade)
    : QuestionTypes.defaultMix(state.subject, state.grade, state.questionCount);

  const { data: request, error } = await supabase
    .from('assessment_requests')
    .insert({
      user_id: state.userId,
      surface: 'whatsapp',
      grade_code: `grade_${state.grade}`,
      subject_code: state.subject,
      textbook_id: book.id,
      chapter_number: state.chapterNumber || null,
      page_ranges: pageRanges,
      content_source: state.contentSource || 'unseen',
      question_count: state.questionCount || 20,
      question_types: types,
      has_answer_key: !!state.answerKey,
      has_answer_lines: state.answerLines !== false,
      output_format: state.outputFormat || 'pdf',
    })
    .select('id')
    .single();

  if (error || !request) throw new Error(`could not record the request: ${error?.message}`);

  await SQSQueueService.queueJob(state.userId, 'assessment_generate', {
    userId: state.userId,
    requestId: request.id,
    grade: state.grade,
    subject: state.subject,
    chapterNumber: state.chapterNumber || null,
    pageRanges,
    contentSource: state.contentSource || 'unseen',
    questionCount: state.questionCount || 20,
    questionTypes: types,
    includeAnswerKey: !!state.answerKey,
    answerLines: state.answerLines !== false,
    outputFormat: state.outputFormat || 'pdf',
  });

  logToFile('[assessment-flow] queued', {
    userId: state.userId, requestId: request.id,
    grade: state.grade, subject: state.subject, chapter: state.chapterNumber,
  });
}

async function handleBack(userId, screenId, flowToken) {
  const state = await readSession(flowToken);
  if (screenId === 'CONFIRM' || screenId === 'TYPES') return questionsScreen(state);
  if (screenId === 'QUESTIONS' || screenId === 'PAGES') {
    return screen('COVERAGE', {
      summary: summaryOf(state), has_chapters: true,
      chapters: await chapterOptions(state), error: '',
    });
  }
  return handleInit(userId, flowToken);
}

module.exports = {
  handleAssessmentGenInit: handleInit,
  handleAssessmentGenDataExchange: handleDataExchange,
  handleAssessmentGenBack: handleBack,
  // exported for tests
  _internal: { summaryOf, submit, chapterPageRange, GRADE_BANDS, COUNT_CHOICES,
    paperIdFromToken, mergePageTicks, REVIEW_MARKER, SHAPE_SCREEN, navFit, NAV_MAX },
};
