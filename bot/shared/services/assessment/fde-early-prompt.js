'use strict';
/**
 * The prompts of a Grade 1-2 FDE practice paper (bd-5jmnfj.4.1), and the checks
 * on what comes back.
 *
 * The section prompt is Grade 5's builder, run on the pattern with its key masked
 * (`early_<key>`), so none of Grade 5's per-subject rules (Urdu grammar lists,
 * Maths Section C's syllabus) reach a Grade 1 paper. Its "no pictures" rule is
 * swapped for the picture rule: a picture slot asks for one picture per item.
 *
 * The oral prompt asks for each oral task's script and questions, which the
 * marking scheme prints on the teacher sheet (fde-oral-sheet).
 *
 * Pure: the builder is passed in, so this never requires the service.
 */

const NO_PICTURES = 'The paper carries no pictures. A slot marked frame prints an empty frame: write the instruction and the labels/word bank only; never \'look at the picture\'.';

const PICTURE_RULE = 'Pictures: a slot whose rule names a picture gives EVERY item one "picture" object, in one of the shapes that slot lists. '
  + 'Write object names and scene descriptions in plain English, even on an Urdu paper. A picture never carries words, letters or numbers to read. '
  + 'A slot that names no picture carries none, and no item says "look at the picture" unless it has one. '
  + 'Each picture shows exactly that item\'s own word, one plain thing alone: for "h_t" a hat, never a cap or a scene. '
  + 'No two items show the same thing, even in different questions: a teacher never draws the cat twice on one paper. '
  + 'Another name for the same thing is still a repeat: "rooster" and "male chicken" are one picture. '
  + 'No fact is asked twice on one paper, in any two items or any two questions.';

/** What each picture kind must carry for the pipeline to draw it. */
const PICTURE_FIELDS = {
  count: (p) => Boolean(p.name) && Number.isInteger(p.n) && p.n >= 1,
  dots: (p) => Number.isInteger(p.n) && p.n >= 1,
  shapes: (p) => Array.isArray(p.shapes) && p.shapes.length > 0 && p.shapes.every((s) => s && s.shape),
  object: (p) => Boolean(p.name),
  scene: (p) => Boolean(p.describe),
  clock: (p) => Number.isInteger(p.hour),
  plant: () => true, // the paper draws it whole: nothing for the writer to fill in
};

/** The pattern with its key masked, so the builder and the layout skip Grade 5's subject rules. */
function maskP(P) {
  return { ...P, key: `early_${P.key}` };
}

/** One section's prompt: the builder's, with the picture rule in place of "no pictures". */
function sectionPrompt(build, args) {
  const prompt = build({ ...args, P: maskP(args.P) });
  if (!prompt.includes(NO_PICTURES)) throw new Error('the section prompt no longer carries the no-pictures rule to replace');
  return prompt.replace(NO_PICTURES, PICTURE_RULE);
}

/** A task needs a script when it is read to the child (a story, a poem) or read by the child (a passage). */
function needsScript(task) {
  return task.kind === 'listening' || !task.n;
}

function taskLine(task, lang) {
  const want = [needsScript(task) ? 'a "script"' : null, task.n ? `${task.n} "items"` : null].filter(Boolean).join(' and ');
  return `- id "${task.id}" (${task.marks} marks): ${task.ask} Write ${want}.`
    + (task[`instruction_${lang}`] ? ` The teacher will: ${task[`instruction_${lang}`]}` : '');
}

/** The oral part's prompt: one entry per task, in the paper's medium. */
function oralPrompt({ oral, grade, P, pageContent }) {
  const lang = P.medium === 'ur' ? 'ur' : 'en';
  const language = lang === 'ur' ? 'Urdu' : 'English';
  return [
    `Write the oral part of a Grade ${grade} ${P.name_en} practice paper, taken by the teacher one child at a time.`,
    `Write everything in ${language}, at a Grade ${grade} child's level, from the book below: its words, themes and stories.`,
    '',
    '**Book Text Content:**',
    '```',
    pageContent,
    '```',
    '',
    'Tasks:',
    ...oral.tasks.map((t) => taskLine(t, lang)),
    '',
    'A "script" is what is read aloud: a story or poem the teacher reads, or a passage the child reads. '
      + 'Each item is {"ask", "answer"}: a question with its answer, or, for a reading task, one word or line the child reads as "ask" with no answer.',
    'Return JSON only: {"oral":[{"id":"<task id>","script":"<text or empty>","items":[{"ask":"…","answer":"…"}]}]}, one entry per task.',
  ].join('\n');
}

/** The reply read against the tasks: `content` for the sheet, `missing` the task ids it did not fill. */
function oralContent(tree, oral) {
  const list = Array.isArray(tree && tree.oral) ? tree.oral : [];
  const content = [];
  const missing = [];
  for (const task of oral.tasks) {
    const got = list.find((x) => x && x.id === task.id);
    const items = got && Array.isArray(got.items) ? got.items.filter((it) => it && String(it.ask || '').trim()) : [];
    const script = got && typeof got.script === 'string' ? got.script.trim() : '';
    const whole = (!needsScript(task) || script) && items.length >= (task.n || 0);
    if (!got || !whole) { missing.push(task.id); continue; }
    content.push({ id: task.id, ...(script ? { script } : {}), items: task.n ? items.slice(0, task.n) : items });
  }
  return { content, missing };
}

function eachItem(examJson, fn) {
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) list.forEach((q) => { if (q) fn(q); });
      }
    }
  }
}

/** Items in a picture slot with no drawable picture of an allowed kind, as `{slot, reason:'picture'}`. */
function pictureShortfall(examJson, P) {
  const kinds = new Map();
  P.sections.forEach((s) => s.slots.forEach((sl) => { if (sl.picture) kinds.set(sl.slot, sl.picture); }));
  const short = new Map();
  eachItem(examJson, (q) => {
    const allowed = kinds.get(q.slot);
    if (!allowed) return;
    const p = q.picture;
    const ok = p && allowed.includes(p.kind) && PICTURE_FIELDS[p.kind] && PICTURE_FIELDS[p.kind](p);
    if (!ok) short.set(q.slot, { slot: q.slot, reason: 'picture' });
  });
  return [...short.values()];
}

/** "A Hat", "hats" -> "hat": one key for one thing. */
function thingKey(name) {
  const k = String(name).toLowerCase().trim().replace(/^(a|an|the)\s+/, '').replace(/\s+/g, ' ');
  return k.length > 3 && /[^s]s$/.test(k) ? k.slice(0, -1) : k;
}

/** The item's own word when the question is one word (Urdu Q6 «مرغا»), else null; "c + at = ____" is not. */
function itemWord(q) {
  const w = String((q && q.question) || '').trim();
  return /^[\p{L}\p{M}]+$/u.test(w) ? w.toLowerCase() : null;
}

/** "male chicken (مرغا)": the artist's name, and the word it pictures when there is one. */
function pictureLabel(q) {
  const name = String(q.picture.name).trim();
  const word = itemWord(q);
  return word && word !== name.toLowerCase() ? `${name} (${String(q.question).trim()})` : name;
}

/**
 * Object pictures shown more than once, as `{slot, reason:'repeat', pictures}` for each question
 * that repeats one. The question set first on the paper keeps the thing; a later one is flagged.
 * Two items repeat when their pictures share a name or picture one word: v14 drew «مرغا» as "rooster"
 * in Q6 and "male chicken" in Q7. Scenes, counts, dots and shapes are not one thing, so they never repeat.
 */
function repeatedPictures(examJson, P) {
  const order = new Map();
  P.sections.forEach((s) => s.slots.forEach((sl) => order.set(sl.slot, order.size)));
  const objects = [];
  eachItem(examJson, (q) => {
    const p = q.picture;
    if (p && p.kind === 'object' && p.name && order.has(q.slot)) {
      const keys = [thingKey(p.name), itemWord(q)].filter(Boolean);
      objects.push({ slot: q.slot, keys, label: pictureLabel(q), at: objects.length });
    }
  });
  objects.sort((a, b) => order.get(a.slot) - order.get(b.slot) || a.at - b.at);
  const seen = new Set();
  const out = new Map();
  for (const o of objects) {
    const again = o.keys.some((k) => seen.has(k));
    o.keys.forEach((k) => seen.add(k));
    if (!again) continue;
    const r = out.get(o.slot) || { slot: o.slot, reason: 'repeat', pictures: [] };
    if (!r.pictures.includes(o.label)) r.pictures.push(o.label);
    out.set(o.slot, r);
  }
  return [...out.values()];
}

/**
 * A re-ask's note naming the object pictures the paper's other sections already show, and the items in this
 * section that repeat an earlier question (`repeats`, from repeatedPictures); null if there is neither.
 */
function takenPicturesNote(trees, repeats = []) {
  const names = new Map();
  trees.forEach((t) => eachItem(t, (q) => {
    const p = q.picture;
    if (p && p.kind === 'object' && p.name && !names.has(thingKey(p.name))) names.set(thingKey(p.name), pictureLabel(q));
  }));
  const own = repeats.filter((f) => f.reason === 'repeat').flatMap((f) => f.pictures);
  const parts = [];
  if (names.size) {
    parts.push(`These pictures are already on this paper, in other questions: ${[...names.values()].join(', ')}. `
      + 'Draw none of them again, and no two items you write may show the same thing.');
  }
  if (own.length) {
    parts.push(`In this section these items repeat a picture or word from an earlier question: ${[...new Set(own)].join(', ')}. `
      + 'Give each a different word, not another name for the same thing.');
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * What a later section is told before it is written (bd-5jmnfj.4.16): every question the earlier
 * sections ask, with its answer, and never to ask those facts again; null when nothing is written yet.
 */
function askedNote(trees) {
  const lines = [];
  trees.forEach((t) => eachItem(t, (q) => {
    if (q.question) lines.push(`- ${String(q.question).trim()} → ${String(q.answer == null ? '' : q.answer).trim()}`);
  }));
  if (!lines.length) return null;
  return `The paper already asks these (question → answer):\n${lines.join('\n')}\n`
    + 'Never ask any of these facts again, in any form (a blank, a choice, true or false, a match, a short answer), '
    + 'and give none of these answers as an answer.';
}

const slotsOf = (P) => new Map(P.sections.flatMap((s) => s.slots).map((sl) => [sl.slot, sl]));

// v18 G2 Urdu: a "which spelling is correct" item offered آلودگی three times (bd-5jmnfj.4.35).
const choice = (o) => String(o).replace(/^\s*\(?[^\s)]{1,3}\)\s*/, '').trim().normalize('NFC');
const sameOptions = (q) => Array.isArray(q.options) && new Set(q.options.map(choice)).size < q.options.length;

/** Items whose key breaks their slot's `answer_ok`, or whose choices repeat, as `{slot, reason:'answer', items}` ("question → answer"). */
function answerShortfall(examJson, P) {
  const slots = slotsOf(P);
  const out = new Map();
  eachItem(examJson, (q) => {
    const sl = slots.get(q.slot);
    if (!sl || (!sameOptions(q) && (!sl.answer_ok || sl.answer_ok(q)))) return;
    const r = out.get(q.slot) || { slot: q.slot, reason: 'answer', items: [] };
    r.items.push(`${String(q.question).trim()} → ${String(q.answer).trim()}`);
    out.set(q.slot, r);
  });
  return [...out.values()];
}

/** A re-ask's note naming each item keyed off its slot's rule, and the rule; null if none. */
function answerNote(shortfall, P) {
  const slots = slotsOf(P);
  const notes = shortfall.filter((f) => f.reason === 'answer' && slots.has(f.slot)).map((f) => {
    const sl = slots.get(f.slot);
    const label = sl.label_en || f.slot;
    return `${label} broke its rule in these items (question → answer):\n${f.items.map((i) => `- ${i}`).join('\n')}\n`
      + `Write ${label} again so every item follows it: ${sl.prompt_rule}`
      + (sl.shape === 'mcq' ? '\nEvery choice must be different. A which-spelling item gives one right spelling and wrong ones.' : '');
  });
  return notes.length ? notes.join('\n\n') : null;
}

module.exports = {
  NO_PICTURES, PICTURE_RULE, maskP, sectionPrompt, oralPrompt, oralContent, pictureShortfall, repeatedPictures, takenPicturesNote,
  answerShortfall, answerNote, askedNote,
};
