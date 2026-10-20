'use strict';
/**
 * The candidate chapters for one recommendation (bd-gzfdu9, SPEC v1.2.1 §3.3). Pure and deterministic: no LLM,
 * no I/O, no embedding model (the bot has none and no external API is allowed). BM25 in plain JS over each
 * chapter's keywords + symptoms + summary + title + moves, against the lesson's own evidence text.
 *
 * The pedagogy rubric's ⛔ rows are code here: declared holes, recommendable / programme intro (⛔7), media
 * (⛔12), subject incl. content modules (⛔4), grade (⛔5), language (⛔3: preferred ∪ transcript ∪ mixed, the
 * chapter's own language first), level (⛔11: ±1, widened to 2 rungs only when nothing closer names the target,
 * every level for a teacher who finished the ladder), history (⛔6: a chapter never twice).
 * noneReason names the gate that emptied the list: hole | language | level | history | no_target.
 */

const MAX_CANDIDATES = 6;
const K1 = 1.2;
const B = 0.75;
const CARD_TEXT_FLOOR = 2.0;
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
  if (!subject) return false; // unknown subject: a subject-specific module is out (H6)
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

/**
 * @param {object} catalog  catalog.fromData(...) / catalog.load()
 * @param {object} target   target.pick(...)
 * @param {{language:string, languages:string[], level:number|null, ladderComplete:boolean, history:{segments:string[], modules:number[]}}} ctx
 * @param {string} signal   the lesson's evidence text
 * @param {{subject:string|null, grade:{lo:number,hi:number}|null, topic:string|null, inapplicable:string[]}} lesson
 * @returns {{candidates:Array<{seg_id, score, indicator, language_match, level_id}>, noneReason:string|null, repeatModule:boolean, levelMatch:string|null}}
 */
function build(catalog, target, ctx, signal, lesson) {
  const empty = (noneReason, levelMatch = null) => ({ candidates: [], noneReason, repeatModule: false, levelMatch });
  try {
    if (!catalog || !Array.isArray(catalog.modules) || !target) return empty('hole');
    const t = {
      source: target.source || null,
      indicator: target.indicator || null,
      indicators: (target.indicators && target.indicators.length ? target.indicators : [target.indicator]).filter(Boolean),
      moves: target.moves || [],
      native37: !!target.native37,
    };
    if (t.source !== 'card_text' && !t.indicators.length && !t.moves.length) return empty('hole');
    if (t.indicators.length && !t.native37) {
      const holes = new Set(catalog.holes || []);
      t.indicators = t.indicators.filter((id) => !holes.has(id));
      if (!t.indicators.length) return empty('hole');
      t.indicator = t.indicators[0];
    }
    const c = ctx || {};
    const l = lesson || {};
    const subject = subjectId(l.subject);
    const inapplicable = new Set(l.inapplicable || []);
    const preferred = c.language === 'en' ? 'en' : 'ur';
    const languages = new Set((c.languages && c.languages.length ? c.languages : [preferred, 'mixed']).filter(Boolean));

    const base = [];
    for (const module of catalog.modules) {
      if (!module || module.recommendable === false || module.media_ok === false) continue;
      if (((module.quality && module.quality.flags) || []).some((f) => BAD_MEDIA.has(f))) continue;
      if (!suitsSubject(module, subject)) continue;
      if (subject && module.not_for && tokens(module.not_for).some((tok) => subjectId(tok) === subject)) continue;
      if (!gradeOk(module.grade_band, l.grade)) continue;
      for (const seg of module.segments || []) {
        if (!seg || seg.recommendable === false || isIntro(module, seg)) continue;
        const fico = (seg.fico || []).map((f) => f && f.indicator).filter(Boolean);
        if (fico.length && fico.every((id) => SUBJECT_ONLY_ROWS.has(id) && inapplicable.has(id))) continue;
        const m = matchFor(seg, t);
        if (!m) continue;
        if (isContent(module, seg) && !(CONTENT_TARGETS.has(m.indicator) && topicMatches(module, l))) continue;
        base.push({ module, seg, ...m, lang: seg.language || module.language, level: Number(module.level_id) });
      }
    }
    if (!base.length) return empty('hole');

    const byLang = base.filter((x) => languages.has(x.lang));
    if (!byLang.length) return empty('language');

    let byLevel;
    let levelMatch;
    const L = c.level === null || c.level === undefined || !Number.isFinite(Number(c.level)) ? null : Number(c.level);
    if (c.ladderComplete) {
      byLevel = byLang; levelMatch = 'completed';
    } else if (L !== null) {
      byLevel = byLang.filter((x) => Math.abs(x.level - L) <= 1); levelMatch = 'within';
      if (!byLevel.length) { byLevel = byLang.filter((x) => Math.abs(x.level - L) <= 2); levelMatch = 'widened'; }
      if (!byLevel.length) return empty('level', levelMatch);
    } else {
      byLevel = byLang.some((x) => x.level < 4) ? byLang.filter((x) => x.level < 4) : byLang; levelMatch = 'unknown';
    }

    const seenSegs = new Set(((c.history && c.history.segments) || []).map(String));
    const seenMods = new Set(((c.history && c.history.modules) || []).map(Number));
    const fresh = byLevel.filter((x) => !seenSegs.has(String(x.seg.seg_id)));
    let pool = fresh.filter((x) => !seenMods.has(Number(x.module.module_id)));
    let repeatModule = false;
    if (!pool.length && fresh.length && seenMods.size) { pool = fresh; repeatModule = true; }
    if (!pool.length) return empty('history', levelMatch);

    const query = [t.source === 'card_text' ? target.cardText : '', signal].filter(Boolean).join('\n');
    const lexical = bm25(catalog, query);
    if (t.source === 'card_text' && Math.max(...pool.map((x) => lexical.get(x.seg.seg_id) || 0)) < CARD_TEXT_FLOOR) {
      return empty('no_target', levelMatch);
    }
    const ranked = pool.map((x) => {
      const ev = (x.seg.fico || []).some((f) => f && Number(f.evidence_s) >= Number(x.seg.start_s) && Number(f.evidence_s) <= Number(x.seg.end_s));
      const lead = t.moves.includes((x.seg.moves || [])[0]);
      const score = (lexical.get(x.seg.seg_id) || 0)
        + (x.isTarget && t.indicators.length ? 2.0 : 0) + 0.5 * x.strength
        + (x.lang === preferred ? 1.0 : 0)
        + (levelMatch === 'unknown' && x.level <= 2 ? 0.5 : 0)
        + (ev || lead ? 0.001 : 0);
      return {
        seg_id: x.seg.seg_id,
        score: Math.round(score * 1e4) / 1e4,
        indicator: x.indicator,
        language_match: x.lang === preferred ? 'preferred' : x.lang === 'mixed' ? 'mixed' : 'transcript',
        level_id: x.level,
      };
    }).sort((a, b) => b.score - a.score || String(a.seg_id).localeCompare(String(b.seg_id)));

    return { candidates: ranked.slice(0, MAX_CANDIDATES), noneReason: null, repeatModule, levelMatch };
  } catch (e) {
    return empty('hole');
  }
}

module.exports = { build, tokens, subjectId, gradeOk, MAX_CANDIDATES };
