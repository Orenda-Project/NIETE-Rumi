'use strict';
/**
 * The candidate chapters for one recommendation (bd-gzfdu9, SPEC v1.3 §3.3). Pure and deterministic: no LLM,
 * no I/O, no embedding model (the bot has none and no external API is allowed). BM25 in plain JS over each
 * chapter's keywords + symptoms + summary + title + moves.
 *
 * Two routes (design/RETRIEVAL_v1.3.md §3). The TAG route: chapters tagged with the step's indicator, ranked by
 * BM25 against the lesson's evidence text, up to 12. The STEP-TEXT route: BM25 over every chapter against the
 * card's own words (never the evidence), floor 2.0, up to 6 more, appended — ONLY when the indicator cannot name a
 * move: a 37-scheme LABEL, a v4 hole, an unknown indicator, an empty tag pool, or no indicator at all (card_text,
 * whose list is this route alone). On a move indicator the list stays step-indicator-only.
 *
 * The pedagogy rubric's ⛔ rows are code here: declared holes, recommendable / programme intro (⛔7), media
 * (⛔12), subject incl. content modules (⛔4), grade (⛔5), language (⛔3: preferred ∪ transcript ∪ mixed, the
 * chapter's own language first), history (⛔6: a chapter never twice). Level (⛔11) is a preference, never a
 * filter: +0.5 within one rung of a known level; unknown level keeps level 4 out while anything else exists.
 * noneReason names the gate that emptied the list: hole | language | history | unknown_indicator | no_target.
 */

const MAX_CANDIDATES = 12;
const MAX_TEXT = 6;
const K1 = 1.2;
const B = 0.75;
const TEXT_FLOOR = 2.0;
// 37-scheme indicators that name a subject or a resource, not a teaching move: the card's sentence is the step.
const LABEL_37 = new Set(['F5', 'F6', 'F7', 'F8', 'B7', 'B8', 'C10']);
const CONTENT_TARGETS = new Set(['F1', 'F2', 'F3']);
const SUBJECT_ONLY_ROWS = new Set(['F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);
const BAD_MEDIA = new Set(['broken_media', 'no_speech']);
const UNIVERSAL = new Set(['general', 'early_years']);
const NARROW_BANDS = Object.freeze({ ece: [0, 0], '1-3': [1, 3], '4-5': [4, 5], '6-8': [6, 8], '9-12': [9, 12] });

const SUBJECT_IDS = Object.freeze({
  maths: 'maths', math: 'maths', mathematics: 'maths', numeracy: 'maths',
  science: 'science', general_science: 'science', 'general science': 'science',
  english: 'english', urdu: 'urdu', literacy: 'literacy', islamiat: 'islamiat', islamiyat: 'islamiat',
  social_studies: 'social_studies', 'social studies': 'social_studies', computer: 'computer', 'computer science': 'computer',
});

function tokens(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{M}]+/gu) || []).filter((t) => t.length > 1);
}

function subjectId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return SUBJECT_IDS[s] || SUBJECT_IDS[s.replace(/_/g, ' ')] || null;
}

/** The module subjects a lesson in `subject` may use. */
function suitsSubject(module, subject) {
  const subs = (module.subjects || []).map((x) => String(x).toLowerCase());
  if (!subs.length || subs.some((x) => UNIVERSAL.has(x))) return true;
  if (!subject) return subs.length > 1; // unknown subject: only a single-subject module is out (H6, §3.3)
  const ok = new Set([subject]);
  if (subject === 'urdu' || subject === 'english') ok.add('literacy');
  return subs.map((x) => subjectId(x) || x).some((x) => ok.has(x));
}

function gradeOk(band, grade) {
  const b = String(band || 'all').toLowerCase();
  const narrow = NARROW_BANDS[b];
  const g = grade && Number.isFinite(Number(grade.lo)) ? grade : null;
  if (b === 'primary') return !g || (g.lo <= 5 && g.hi >= 1);
  if (!narrow) return true; // 'all' or anything unknown
  return !!g && g.lo <= narrow[1] && g.hi >= narrow[0];
}

/** §3.3: a chapter flagged recommendable counts even inside a not-recommendable module (m150/m152/m159/m162). */
function recommendable(module, seg) {
  return !!seg && (seg.recommendable === true || (module.recommendable !== false && seg.recommendable !== false));
}

function isContent(module, seg) {
  return (module.moves || []).includes('subject_content') || (seg.moves || []).includes('subject_content');
}

function isIntro(module, seg) {
  return (module.moves || [])[0] === 'programme_intro' || (seg.moves || [])[0] === 'programme_intro';
}

function topicMatches(module, lesson) {
  const want = new Set(tokens([lesson.topic, lesson.subject].filter(Boolean).join(' ')));
  return want.size > 0 && tokens((module.topic || []).join(' ')).some((t) => want.has(t));
}

/** {indicator, strength, isTarget} when a chapter is a candidate for this target, else null. */
function matchFor(seg, t) {
  if (t.source === 'card_text') return { indicator: ((seg.fico || [])[0] || {}).indicator || null, strength: 0, isTarget: false };
  if (t.source === 'phase' || (!t.indicators.length && t.moves.length)) {
    const hit = (seg.moves || []).some((m) => t.moves.includes(m));
    return hit ? { indicator: ((seg.fico || [])[0] || {}).indicator || null, strength: 0, isTarget: true } : null;
  }
  if (t.native37) return (seg.fico_main37 || []).includes(t.indicator) ? { indicator: t.indicator, strength: 1, isTarget: true } : null;
  for (const id of t.indicators) {
    const f = (seg.fico || []).find((x) => x && x.indicator === id && Number(x.strength) >= 1);
    if (f) return { indicator: id, strength: Number(f.strength), isTarget: true };
  }
  return null;
}

function docOf(module, seg) {
  return tokens([
    ...(seg.keywords || []), ...(module.symptoms || []), seg.summary_en, seg.title_en,
    ...(seg.moves || []).map((m) => m.replace(/_/g, ' ')),
  ].join(' '));
}

function bm25(catalog, query) {
  const docs = [];
  for (const module of catalog.modules) for (const seg of module.segments || []) docs.push({ id: seg.seg_id, toks: docOf(module, seg) });
  const N = docs.length || 1;
  const avg = docs.reduce((n, d) => n + d.toks.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
  const q = [...new Set(tokens(query))];
  const scores = new Map();
  for (const d of docs) {
    const tf = new Map();
    for (const t of d.toks) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) || 0;
      s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.toks.length) / avg)));
    }
    scores.set(d.id, s);
  }
  return scores;
}

/** Every chapter that passes the module and chapter gates (subject, grade, media, recommendable, intro). */
function eligible(catalog, lesson) {
  const l = lesson || {};
  const subject = subjectId(l.subject);
  const inapplicable = new Set(l.inapplicable || []);
  const out = [];
  for (const module of catalog.modules) {
    if (!module || module.media_ok === false) continue;
    if (((module.quality && module.quality.flags) || []).some((f) => BAD_MEDIA.has(f))) continue;
    if (!suitsSubject(module, subject)) continue;
    if (subject && module.not_for && tokens(module.not_for).some((tok) => subjectId(tok) === subject)) continue;
    if (!gradeOk(module.grade_band, l.grade)) continue;
    for (const seg of module.segments || []) {
      if (!recommendable(module, seg) || isIntro(module, seg)) continue;
      const fico = (seg.fico || []).map((f) => f && f.indicator).filter(Boolean);
      if (fico.length && fico.every((id) => SUBJECT_ONLY_ROWS.has(id) && inapplicable.has(id))) continue;
      out.push({ module, seg, lang: seg.language || module.language, level: Number(module.level_id) });
    }
  }
  return out;
}

function levelOf(ctx) {
  const c = ctx || {};
  if (c.ladderComplete) return { L: null, mode: 'completed' };
  const L = c.level === null || c.level === undefined || !Number.isFinite(Number(c.level)) ? null : Number(c.level);
  return L === null ? { L, mode: 'unknown' } : { L, mode: 'known' };
}

function levelMatchOf(lv, level) {
  if (lv.mode !== 'known') return lv.mode;
  return Math.abs(level - lv.L) <= 1 ? 'near' : 'far';
}

function languagesOf(ctx) {
  const c = ctx || {};
  const preferred = c.language === 'en' ? 'en' : 'ur';
  return { preferred, languages: new Set((c.languages && c.languages.length ? c.languages : [preferred, 'mixed']).filter(Boolean)) };
}

function languageMatch(lang, preferred) {
  return lang === preferred ? 'preferred' : lang === 'mixed' ? 'mixed' : 'transcript';
}

/** The step-text query: the card's own words + the indicator's display name. Never the evidence (it dilutes). */
function stepQuery(step) {
  const s = step || {};
  return [s.action, s.tryTomorrow, s.thingToTry, s.name].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).join('\n');
}

/**
 * The step-text route (R3): BM25 of the card's words over every chapter that passes subject, grade, language,
 * history and media; floor 2.0; up to 6 not in `exclude`, BM25 order. Content modules never (they need F1–F3).
 */
function textRoute(catalog, step, ctx, lesson, exclude = [], route = 'step_text') {
  try {
    const query = stepQuery(step);
    if (!catalog || !Array.isArray(catalog.modules) || !query) return [];
    const { preferred, languages } = languagesOf(ctx);
    const lv = levelOf(ctx);
    const h = (ctx && ctx.history) || {};
    const seenSegs = new Set((h.segments || []).map(String));
    const seenMods = new Set((h.modules || []).map(Number));
    const skip = new Set((exclude || []).map(String));
    const lexical = bm25(catalog, query);
    return eligible(catalog, lesson)
      .filter((x) => !isContent(x.module, x.seg) && languages.has(x.lang))
      .filter((x) => !seenSegs.has(String(x.seg.seg_id)) && !seenMods.has(Number(x.module.module_id)) && !skip.has(String(x.seg.seg_id)))
      .map((x) => ({ x, score: lexical.get(x.seg.seg_id) || 0 }))
      .filter((y) => y.score >= TEXT_FLOOR)
      .sort((a, b) => b.score - a.score || String(a.x.seg.seg_id).localeCompare(String(b.x.seg.seg_id)))
      .slice(0, MAX_TEXT)
      .map(({ x, score }) => ({
        seg_id: x.seg.seg_id,
        score: Math.round(score * 1e4) / 1e4,
        indicator: ((x.seg.fico || [])[0] || {}).indicator || null,
        language_match: languageMatch(x.lang, preferred),
        level_id: x.level,
        level_match: levelMatchOf(lv, x.level),
        route,
      }));
  } catch (e) {
    return [];
  }
}

/** Why the step-text route runs for this target (null: a move indicator — tag route only). Before the tag pool. */
function textReasonOf(target, catalog) {
  if (target.source === 'card_text') return 'card_text';
  if (target.none === 'unknown_indicator') return target.aliasKind === 'subject_blocked' ? 'subject_blocked' : 'unknown';
  if (target.scheme === 'fico_main_37' && LABEL_37.has(target.storedIndicator)) return 'label';
  const holes = new Set(catalog.holes || []);
  if (target.native37) {
    const alias = (catalog.aliases || {})[target.storedIndicator || target.indicator];
    if (alias && typeof alias === 'object' && alias.exact && holes.has(alias.exact)) return 'hole';
    return null;
  }
  const ids = (target.indicators && target.indicators.length ? target.indicators : [target.indicator]).filter(Boolean);
  return ids.length && ids.every((id) => holes.has(id)) ? 'hole' : null;
}

/** The tag route: {candidates, noneReason, repeatModule}. Level ranks, never filters (R1); up to 12 (R2). */
function tagRoute(catalog, t, ctx, signal, lesson) {
  const empty = (noneReason) => ({ candidates: [], noneReason, repeatModule: false });
  if (t.source !== 'card_text' && !t.indicators.length && !t.moves.length) return empty('hole');
  if (t.indicators.length && !t.native37) {
    const holes = new Set(catalog.holes || []);
    t.indicators = t.indicators.filter((id) => !holes.has(id));
    if (!t.indicators.length) return empty('hole');
    t.indicator = t.indicators[0];
  }
  const l = lesson || {};
  const { preferred, languages } = languagesOf(ctx);
  const base = [];
  for (const x of eligible(catalog, l)) {
    const m = matchFor(x.seg, t);
    if (!m) continue;
    if (isContent(x.module, x.seg) && !(CONTENT_TARGETS.has(m.indicator) && topicMatches(x.module, l))) continue;
    base.push({ ...x, ...m });
  }
  if (!base.length) return empty('hole');

  const byLang = base.filter((x) => languages.has(x.lang));
  if (!byLang.length) return empty('language');

  const lv = levelOf(ctx);
  const byLevel = lv.mode === 'unknown' && byLang.some((x) => x.level < 4) ? byLang.filter((x) => x.level < 4) : byLang;

  const h = (ctx && ctx.history) || {};
  const seenSegs = new Set((h.segments || []).map(String));
  const seenMods = new Set((h.modules || []).map(Number));
  const fresh = byLevel.filter((x) => !seenSegs.has(String(x.seg.seg_id)));
  let pool = fresh.filter((x) => !seenMods.has(Number(x.module.module_id)));
  let repeatModule = false;
  if (!pool.length && fresh.length && seenMods.size) { pool = fresh; repeatModule = true; }
  if (!pool.length) return empty('history');

  const lexical = bm25(catalog, signal || '');
  const ranked = pool.map((x) => {
    const ev = (x.seg.fico || []).some((f) => f && Number(f.evidence_s) >= Number(x.seg.start_s) && Number(f.evidence_s) <= Number(x.seg.end_s));
    const lead = t.moves.includes((x.seg.moves || [])[0]);
    const levelMatch = levelMatchOf(lv, x.level);
    const score = (lexical.get(x.seg.seg_id) || 0)
      + (x.isTarget && t.indicators.length ? 2.0 : 0) + 0.5 * x.strength
      + (x.lang === preferred ? 1.0 : 0)
      + (levelMatch === 'near' || (levelMatch === 'unknown' && x.level <= 2) ? 0.5 : 0)
      + (ev && (t.moves.length ? lead : true) ? 0.001 : 0); // §3.3: moves[0] is the target AND evidence_s inside
    return {
      seg_id: x.seg.seg_id,
      score: Math.round(score * 1e4) / 1e4,
      indicator: x.indicator,
      language_match: languageMatch(x.lang, preferred),
      level_id: x.level,
      level_match: levelMatch,
      route: 'tag',
    };
  }).sort((a, b) => b.score - a.score || String(a.seg_id).localeCompare(String(b.seg_id)));
  return { candidates: ranked.slice(0, MAX_CANDIDATES), noneReason: null, repeatModule };
}

/**
 * @param {object} catalog  catalog.fromData(...) / catalog.load()
 * @param {object} target   target.pick(...) — incl. an unknown_indicator target, which goes to the step-text route
 * @param {{language:string, languages:string[], level:number|null, ladderComplete:boolean, history:{segments:string[], modules:number[]}}} ctx
 * @param {string} signal   the lesson's evidence text (tag route ranking)
 * @param {{subject:string|null, grade:{lo:number,hi:number}|null, topic:string|null, inapplicable:string[]}} lesson
 * @param {{action:string, tryTomorrow:string, thingToTry:string, name:string}} [step]  the card's words (step-text route)
 * @returns {{candidates:Array<{seg_id, score, indicator, language_match, level_id, level_match, route}>, noneReason:string|null,
 *   repeatModule:boolean, levelMatch:'completed'|'unknown'|null, textReason:string|null, stepTextQuery:string|null, route:string|null}}
 */
function build(catalog, target, ctx, signal, lesson, step) {
  const empty = (noneReason, extra = {}) => ({
    candidates: [], noneReason, repeatModule: false, levelMatch: null, textReason: null, stepTextQuery: null, route: null, ...extra,
  });
  try {
    if (!catalog || !Array.isArray(catalog.modules) || !target) return empty('hole');
    if (target.none && target.none !== 'unknown_indicator') return empty(target.none);
    const t = {
      source: target.source || null,
      indicator: target.indicator || null,
      indicators: (target.indicators && target.indicators.length ? target.indicators : [target.indicator]).filter(Boolean),
      moves: target.moves || [],
      native37: !!target.native37,
    };
    const lv = levelOf(ctx);
    const levelMatch = lv.mode === 'known' ? null : lv.mode;
    const early = textReasonOf(target, catalog);
    const textOnly = early === 'card_text' || early === 'unknown' || early === 'subject_blocked';
    const tag = textOnly ? { candidates: [], noneReason: null, repeatModule: false } : tagRoute(catalog, t, ctx, signal, lesson);
    const textReason = early || (tag.candidates.length ? null : 'empty');
    const s = step || (target.source === 'card_text' ? { action: target.cardText } : null);
    const query = textReason ? stepQuery(s) : '';
    const routeName = textReason === 'card_text' ? 'card_text' : 'step_text';
    const text = query ? textRoute(catalog, s, ctx, lesson, tag.candidates.map((c) => c.seg_id), routeName) : [];
    const candidates = [...tag.candidates, ...text];
    const common = { repeatModule: tag.repeatModule, levelMatch, textReason, stepTextQuery: query || null };
    if (!candidates.length) {
      const why = textReason === 'card_text' ? 'no_target' : textOnly ? 'unknown_indicator' : (tag.noneReason || 'hole');
      return empty(why, { ...common, route: textReason ? routeName : 'tag' });
    }
    return { candidates, noneReason: null, ...common, route: tag.candidates.length ? 'tag' : routeName };
  } catch (e) {
    return empty('hole');
  }
}

module.exports = { build, textRoute, recommendable, stepQuery, tokens, subjectId, gradeOk, MAX_CANDIDATES, MAX_TEXT, TEXT_FLOOR, LABEL_37 };
