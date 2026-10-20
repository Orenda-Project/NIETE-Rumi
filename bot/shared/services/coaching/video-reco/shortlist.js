'use strict';
/**
 * The candidate clips for one recommendation (bd-gzfdu9, SPEC §3.3). Pure and deterministic: no LLM,
 * no I/O, no embedding model (the bot has none and no external API is allowed). BM25 in plain JS over
 * each chapter's keywords + symptoms + summary + title + moves, against the lesson's own evidence text.
 *
 * The pedagogy rubric's ⛔ rows are code filters here (SPEC §4.8): language (⛔3), content modules only
 * for F1–F3 with a matching topic and subject (⛔4), grade band (⛔5), 180-day history (⛔6),
 * recommendable / programme_intro (⛔7), level ±1 (⛔11), broken media / no speech (⛔12).
 */

const MAX_CANDIDATES = 6;
const MIN_TARGET = 3;
const K1 = 1.2;
const B = 0.75;
const CONTENT_TARGETS = new Set(['F1', 'F2', 'F3']);
const BAD_MEDIA = new Set(['broken_media', 'no_speech']);

const SUBJECT_IDS = Object.freeze({
  maths: 'maths', math: 'maths', mathematics: 'maths', numeracy: 'maths',
  science: 'science', general_science: 'science', 'general science': 'science',
  english: 'english', urdu: 'urdu', islamiat: 'islamiat', islamiyat: 'islamiat',
  social_studies: 'social_studies', 'social studies': 'social_studies', computer: 'computer', 'computer science': 'computer',
});

function tokens(text) {
  return (String(text || '').toLowerCase().match(/[\p{L}\p{M}]+/gu) || []).filter((t) => t.length > 1);
}

function subjectId(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return SUBJECT_IDS[s] || SUBJECT_IDS[s.replace(/_/g, ' ')] || null;
}

function gradeIn(band, grade) {
  if (grade === null || grade === undefined || !Number.isFinite(Number(grade))) return true;
  const g = Number(grade);
  const b = String(band || 'all').toLowerCase();
  if (b === 'all' || b === '') return true;
  if (b === 'ece') return g <= 0;
  if (b === 'primary') return g >= 1 && g <= 5;
  const m = b.match(/^(\d+)-(\d+)$/);
  return m ? g >= Number(m[1]) && g <= Number(m[2]) : true;
}

function isContent(module, seg) {
  return (module.moves || []).includes('subject_content') || (seg.moves || []).includes('subject_content');
}

function isIntro(module, seg) {
  return (module.moves || [])[0] === 'programme_intro' || (seg.moves || [])[0] === 'programme_intro';
}

/** The indicator a chapter is matched for: the target first, then the other weak rows, strength ≥ 1. */
function matchFor(seg, target) {
  if (!target.indicator) {
    const hit = (seg.moves || []).some((m) => target.moves.includes(m));
    return hit ? { indicator: ((seg.fico || [])[0] || {}).indicator || null, strength: 0, isTarget: true } : null;
  }
  for (const id of [target.indicator, ...target.alsoWeak]) {
    const f = (seg.fico || []).find((x) => x && x.indicator === id && Number(x.strength) >= 1);
    if (f) return { indicator: id, strength: Number(f.strength), isTarget: id === target.indicator };
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
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.toks.length) / avg)));
    }
    scores.set(d.id, s);
  }
  return scores;
}

function topicMatches(module, lesson) {
  const want = new Set(tokens([lesson.topic, lesson.subject].filter(Boolean).join(' ')));
  if (!want.size) return false;
  return tokens((module.topic || []).join(' ')).some((t) => want.has(t));
}

/**
 * @param {object} catalog  catalog.fromData(...) / catalog.load()
 * @param {object} target   target.pick(...)
 * @param {{language:string, level:number|null, history:number[]}} ctx
 * @param {string} signal   the lesson's evidence text
 * @param {{subject?:string, grade?:number, topic?:string}} lesson
 * @returns {{candidates:Array<{seg_id:string, score:number, indicator:string|null}>, noneReason:string|null, repeatModule:boolean}}
 */
function build(catalog, target, ctx, signal, lesson) {
  const empty = (noneReason) => ({ candidates: [], noneReason, repeatModule: false });
  try {
    if (!catalog || !Array.isArray(catalog.modules) || !target) return empty('hole');
    const t = { indicator: target.indicator || null, moves: target.moves || [], alsoWeak: target.alsoWeak || [] };
    if (!t.indicator && !t.moves.length) return empty('hole');
    const c = ctx || {};
    const l = lesson || {};
    const lessonSubject = subjectId(l.subject);
    const level = Number.isFinite(Number(c.level)) && c.level !== null ? Number(c.level) : 2;
    const history = new Set((c.history || []).map(Number));

    const base = [];
    for (const module of catalog.modules) {
      if (!module || module.recommendable === false || module.media_ok === false) continue;
      if (((module.quality && module.quality.flags) || []).some((f) => BAD_MEDIA.has(f))) continue;
      if (!gradeIn(module.grade_band, l.grade)) continue;
      const subjects = (module.subjects || []).map(subjectId).filter(Boolean);
      if (lessonSubject && subjects.length && !(module.subjects || []).includes('general') && !subjects.includes(lessonSubject)) continue;
      if (lessonSubject && module.not_for && tokens(module.not_for).some((tok) => subjectId(tok) === lessonSubject)) continue;
      for (const seg of module.segments || []) {
        if (!seg || seg.recommendable === false || isIntro(module, seg)) continue;
        const m = matchFor(seg, t);
        if (!m) continue;
        if (isContent(module, seg) && !(CONTENT_TARGETS.has(m.indicator) && topicMatches(module, l))) continue;
        base.push({ module, seg, ...m });
      }
    }
    if (!base.length) return empty('hole');
    const lang = c.language === 'en' ? 'en' : 'ur';
    const byLang = base.filter((x) => x.module.language === lang || x.module.language === 'mixed');
    if (!byLang.length) return empty('language');
    const byLevel = byLang.filter((x) => Math.abs(Number(x.module.level_id) - level) <= 1);
    if (!byLevel.length) return empty('level');
    let pool = byLevel.filter((x) => !history.has(Number(x.module.module_id)));
    let repeatModule = false;
    if (!pool.length) {
      if (!history.size) return empty('history');
      pool = byLevel;
      repeatModule = true;
    }

    const lexical = bm25(catalog, signal);
    const ranked = pool.map((x) => ({
      seg_id: x.seg.seg_id,
      indicator: x.indicator,
      isTarget: x.isTarget,
      score: Math.round(((lexical.get(x.seg.seg_id) || 0) + (x.isTarget ? 2.0 : 0) + 0.5 * x.strength) * 1e4) / 1e4,
    })).sort((a, b) => b.score - a.score || String(a.seg_id).localeCompare(String(b.seg_id)));

    let top = ranked.slice(0, MAX_CANDIDATES);
    const targetAll = ranked.filter((x) => x.isTarget);
    const need = Math.min(MIN_TARGET, targetAll.length) - top.filter((x) => x.isTarget).length;
    if (need > 0) {
      const add = targetAll.filter((x) => !top.includes(x)).slice(0, need);
      const keep = top.filter((x) => !x.isTarget).slice(0, top.filter((x) => !x.isTarget).length - add.length);
      top = [...top.filter((x) => x.isTarget), ...add, ...keep]
        .sort((a, b) => b.score - a.score || String(a.seg_id).localeCompare(String(b.seg_id)));
    }
    return {
      candidates: top.map(({ seg_id, score, indicator }) => ({ seg_id, score, indicator })),
      noneReason: null,
      repeatModule,
    };
  } catch (e) {
    return empty('hole');
  }
}

module.exports = { build, tokens, subjectId, gradeIn, MAX_CANDIDATES };
