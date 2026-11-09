/**
 * bd-snkn32 — "Make my own" lesson plan: her answers, checked, and the ONE instruction they become.
 *
 * The portal sends codes (class size, what she has, her class against the book, the teaching way) and one optional
 * note. Codes off these lists are refused, so a forged body can put no prose in front of the model but the note, and
 * the note is bounded, stripped of quote marks and quoted as hers. The instruction then goes through the existing
 * edit lane (lp612-author reviseLessonPlan), which keeps page-truth, the gates and her original on any failure.
 *
 * Pure: no I/O. The same answers always give the same text, so the fork's content hash (editHash) is stable.
 */

const NOTE_MAX = 200;

const SIZES = {
  up30: 'up to 30 children',
  '31_50': '31 to 50 children',
  '51_70': '51 to 70 children',
  over70: 'more than 70 children',
};

const RESOURCES = {
  textbook: 'textbook',
  board: 'board',
  charts: 'charts or flashcards',
  objects: 'things from around (stones, sticks, bottle caps)',
  audio: 'a phone or speaker',
};

const LEVELS = {
  behind: 'most children are BEHIND these pages',
  on_track: 'most children are ON TRACK with these pages',
  ahead: 'most children are AHEAD of these pages',
  mixed: 'the class is MIXED: some children behind, some on track, some ahead',
};

const WAYS = {
  tarl: 'Teach at the right level: group the children by level, not grade; each group gets its own task, with choral checks. In a large room each row is a level group.',
  cpa: 'Things, pictures, numbers: objects first, then pictures, then numbers. Children handle real objects, then see a board drawing, then do the book\'s sums.',
  phonics: 'Sounds first: sound, blend, read, using the book\'s own words.',
  games: 'Games and movement: short games tied to the page\'s learning outcome (for example a floor number line, a word hunt, clap and count).',
  story: 'Story and talk: read-aloud, picture talk and retelling. Children speak before they write.',
};

function bad(error) {
  return { ok: false, error };
}

/** @returns {{ok:true, answers:object} | {ok:false, error:string}} */
function parseOwnAnswers(body) {
  const b = body && typeof body === 'object' ? body : null;
  if (!b) return bad('answers are required');
  if (!Object.prototype.hasOwnProperty.call(SIZES, b.size)) return bad('size is not one of the choices');
  if (!Object.prototype.hasOwnProperty.call(LEVELS, b.level)) return bad('level is not one of the choices');
  if (!Object.prototype.hasOwnProperty.call(WAYS, b.way)) return bad('way is not one of the choices');
  const given = b.resources == null ? [] : b.resources;
  if (!Array.isArray(given)) return bad('resources must be a list');
  if (given.some((r) => !Object.prototype.hasOwnProperty.call(RESOURCES, r))) return bad('resources has an unknown item');
  // The textbook is always there; the rest in the list's own order, once each.
  const resources = Object.keys(RESOURCES).filter((r) => r === 'textbook' || given.includes(r));
  const note = typeof b.note === 'string'
    ? b.note.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
    : '';
  return { ok: true, answers: { size: b.size, resources, level: b.level, way: b.way, note } };
}

/** The instruction for reviseLessonPlan. Takes parsed answers only. */
function buildOwnInstruction(answers) {
  const a = answers || {};
  if (!SIZES[a.size] || !LEVELS[a.level] || !WAYS[a.way] || !Array.isArray(a.resources)) {
    throw new Error('buildOwnInstruction needs answers from parseOwnAnswers');
  }
  const have = a.resources.map((r) => RESOURCES[r]).join(', ');
  const lines = [
    'Rewrite this lesson for ONE teacher\'s own class. Keep the same pages, the same learning outcomes and the same layout and length.',
    `Her class: ${SIZES[a.size]}; ${LEVELS[a.level]}.`,
    `What she has: ${have}. Do not use anything else (no slates, printing or electricity unless listed).`,
    `Teaching way: ${WAYS[a.way]}`,
    'Every part still names the book page it uses. Every part has a quick check for understanding.',
    'Activities may go beyond the book but stay rooted in the page; they are not only copying, repeating or memorising.',
  ];
  if (a.note) lines.push(`Her own note: "${a.note}"`);
  return lines.join('\n');
}

module.exports = { parseOwnAnswers, buildOwnInstruction, NOTE_MAX, SIZES, RESOURCES, LEVELS, WAYS };
