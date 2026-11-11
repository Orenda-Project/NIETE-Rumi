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

const {
  SECONDARY_WAYS, GRR_LINE, ROTE_LINE, bookLine, bandOf, gradeOfSegment, waysOfBand, waysOfGrade, purposesOfBand,
  purposesOfGrade, purposeLine,
} = require('./lp612-own-ways');
const { pagesLine612 } = require('./lp612-own-pages');
const { sloMix, sloCodes } = require('./lp612-own-slo');

const NOTE_MAX = 200;
const FOCI = ['summative', 'formative'];

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
/** the same codes as a 6–12 teacher means them (spec: same code, band label). */
const RESOURCES_612 = {
  ...RESOURCES,
  charts: 'charts or diagrams',
  objects: 'lab things or models (magnets, beakers, a globe, a ruler)',
  audio: 'a phone (video or audio)',
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

/**
 * bd-snkn32.13 — her grade band, from ctx.grade or the segment id: 'middle' / 'senior' for grades 6–12, else null
 * (grades 1–5, or no context at all: the primary ways, as before).
 */
const gradeOf = (c) => (c.grade != null ? c.grade : gradeOfSegment(c.segmentId));

function secondaryBand(ctx) {
  const c = ctx || {};
  const band = bandOf(gradeOf(c));
  if (band === 'middle' || band === 'senior') return band;
  // A segment is always a 6–12 lesson: one whose id names no grade gets the widest 6–12 set.
  return band == null && c.segmentId ? 'senior' : null;
}

/**
 * @param ctx {{grade?:number, segmentId?:string, sloMap?:object}} — grades 6–12 check the way against their band's
 *   set and also take `purpose` (what the lesson is for) and `focus` (Summative or Formative SLOs first; kept only
 *   when the segment's SLOs are mixed).
 * @returns {{ok:true, answers:object} | {ok:false, error:string}}
 */
function parseOwnAnswers(body, ctx) {
  const b = body && typeof body === 'object' ? body : null;
  if (!b) return bad('answers are required');
  if (!Object.prototype.hasOwnProperty.call(SIZES, b.size)) return bad('size is not one of the choices');
  if (!Object.prototype.hasOwnProperty.call(LEVELS, b.level)) return bad('level is not one of the choices');
  const band = secondaryBand(ctx);
  // by grade, so Grade 8 alone gets FDE exam practice; a segment naming no grade gets the senior set.
  const grade = gradeOf(ctx || {});
  const ways = !band ? Object.keys(WAYS) : (bandOf(grade) ? waysOfGrade(grade) : waysOfBand(band));
  // bd-snkn32.24 — she may combine ways: `ways` (a list) wins over the single `way`; once each, in her order.
  if (b.ways != null && !Array.isArray(b.ways)) return bad('ways must be a list');
  const picked = [...new Set(Array.isArray(b.ways) ? b.ways : [b.way])];
  if (!picked.length || picked.some((w) => !ways.includes(w))) return bad('way is not one of the choices');
  const given = b.resources == null ? [] : b.resources;
  if (!Array.isArray(given)) return bad('resources must be a list');
  if (given.some((r) => !Object.prototype.hasOwnProperty.call(RESOURCES, r))) return bad('resources has an unknown item');
  // The textbook is always there; the rest in the list's own order, once each.
  const resources = Object.keys(RESOURCES).filter((r) => r === 'textbook' || given.includes(r));
  const note = typeof b.note === 'string'
    ? b.note.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
    : '';
  const answers = { size: b.size, resources, level: b.level, way: picked[0], note };
  if (picked.length > 1) answers.ways = picked;
  if (!band) return { ok: true, answers };
  if (b.purpose != null) {
    // by grade too: Grade 8 has exam practice (FDE) where 6–7 do not.
    const purposes = bandOf(grade) ? purposesOfGrade(grade) : purposesOfBand(band);
    if (!purposes.includes(b.purpose)) return bad('purpose is not one of the choices');
    answers.purpose = b.purpose;
  }
  if (b.focus != null) {
    if (!FOCI.includes(b.focus)) return bad('focus is not one of the choices');
    if (sloMix(ctx.segmentId, ctx.sloMap)) answers.focus = b.focus;
  }
  return { ok: true, answers };
}

/** bd-snkn32.13 — the grades 6–12 lines: room to adapt, what the lesson is for, which SLOs come first. */
function secondaryLines(a, ctx) {
  const lines = ['Grades 6-12: the teacher may reorder or replace activities to fit her class, as long as every learning outcome is still taught.'];
  const purpose = purposeLine(a.purpose, gradeOf(ctx));
  if (purpose) lines.push(purpose);
  const codes = sloCodes(ctx.segmentId, ctx.sloMap);
  if (a.purpose === 'board' && codes.length) lines.push(`The SLO codes for these pages: ${codes.join(', ')}.`);
  const mix = FOCI.includes(a.focus) ? sloMix(ctx.segmentId, ctx.sloMap) : null;
  if (mix) {
    const [first, then] = a.focus === 'summative'
      ? [`${mix.summative.join(', ')} (Summative: tested in the board exam)`, `${mix.formative.join(', ')} (Formative)`]
      : [`${mix.formative.join(', ')} (Formative: assessed in class)`, `${mix.summative.join(', ')} (Summative)`];
    lines.push(`SLO focus: Focus first on ${first}; give them most of the time and practice. Treat ${then} more briefly.`);
  }
  return lines;
}

/**
 * The instruction for reviseLessonPlan. Takes parsed answers only; ctx as parseOwnAnswers's, plus `bookText` (her
 * book's page text, lp-own-book; optional).
 */
function buildOwnInstruction(answers, ctx) {
  const a = answers || {};
  const names = (a.ways || [a.way]).map((k) => WAYS[k] || SECONDARY_WAYS[k]);
  const way = names.every(Boolean) ? names : null;
  if (!SIZES[a.size] || !LEVELS[a.level] || !way || !Array.isArray(a.resources)) {
    throw new Error('buildOwnInstruction needs answers from parseOwnAnswers');
  }
  const secondary = secondaryBand(ctx);
  const have = a.resources.map((r) => (secondary ? RESOURCES_612 : RESOURCES)[r]).join(', ');
  const lines = [
    'Rewrite this lesson for ONE teacher\'s own class. Keep the same pages, the same learning outcomes and the same layout and length.',
    `Her class: ${SIZES[a.size]}; ${LEVELS[a.level]}.`,
    `What she has: ${have}. Do not use anything else (no slates, printing or electricity unless listed).`,
    way.length > 1 ? `Teaching ways (combine them): ${way.join(' ')}` : `Teaching way: ${way[0]}`,
    'Every part still names the book page it uses. Every part has a quick check for understanding.',
    'Activities may go beyond the book but stay rooted in the page.',
    GRR_LINE,
    ROTE_LINE,
  ];
  if (secondary) lines.push(...secondaryLines(a, ctx || {}));
  if (secondary && a.pages) lines.push(pagesLine612(a.pages)); // item 14
  const book = bookLine(ctx && ctx.bookText);
  if (book) lines.push(book);
  if (a.note) lines.push(`Her own note: "${a.note}"`);
  return lines.join('\n');
}

module.exports = { parseOwnAnswers, buildOwnInstruction, NOTE_MAX, SIZES, RESOURCES, RESOURCES_612, LEVELS, WAYS };
