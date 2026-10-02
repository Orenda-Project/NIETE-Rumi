'use strict';

/**
 * Child test check Flow — one block's screen, from its marks, and back.
 *
 *   planBlock    what each field shows and whether it arrives filled: a mark that clears its bar
 *                (bars.js) is pre-filled; one below it arrives EMPTY and the Flow requires it. Items
 *                the model is sure of go into a chip list (pre-ticked = read wrong; untick = read
 *                right), at most 20, and only when there are at least two; every other item gets its
 *                own radio, empty. A hidden field always carries a value, so `required` can never
 *                block the coach on something they cannot see.
 *   renderScreen the screen's ${data.*}, in the coach's language (strings.js).
 *   readScreen   what the coach posted → coach_marks (the shape of ai_marks) + coach_edits
 *                ({path, ai, coach} per changed mark), or field errors to show on the same screen.
 *   diffMarks    the edits between two marks of one block.
 *
 * The AI's marks are only ever read here. When the coach reopens a check, the marks they saved are
 * shown instead (all filled in), against the same chip list.
 *
 * CHILD_TEST_PREFILL_MODE (bars.prefillMode, bd-s1oo0.21): in 'strict' (the default) the rule above holds.
 * In 'assist' every mark the AI produced arrives filled, below-bar, NEVER-bar and hint-only ones too, and
 * the story's flagged words arrive ticked; each one below its bar is tagged "unsure, please check" and
 * listed in one line at the top of its screen. A mark the AI did not produce (no row, or assemble.js's
 * 'none' at confidence 0) arrives empty in both modes. coach_marks.meta records the mode, what arrived
 * empty (shown_empty) and what arrived filled but unsure (shown_unsure).
 */

const SLOTS = require('./slots');
const { confident, prefillMode } = require('./bars');
const { checkStrings } = require('./strings');

const SCREEN_OF = { urdu: 'URDU', english: 'ENGLISH', maths: 'MATHS' };
const PREFIX = { urdu: 'u_', english: 'e_', maths: 'm_' };
const MAX_CHIPS = 20;
const CAP = { label: 30, desc: 300, chip: 30, line: 80 };
// A hidden ChipsSelector still needs a valid source: two placeholder options it never shows.
const HIDDEN_CHIPS = [{ id: 'x_a', title: '-' }, { id: 'x_b', title: '-' }];
const VERDICTS = new Set(['correct', 'wrong', 'none']);
const WRITTEN = new Set(['correct', 'wrong', 'blank', 'unreadable']);

const clip = (s, n) => [...String(s == null ? '' : s)].slice(0, n).join('');
const num = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : String(Math.round(Number(n))));
const has = (v) => v !== undefined && v !== null && v !== '';

/** Items in bank order, each with its mark; the marks' own order when the bank has no such form. */
function rowsOf(items, marks) {
  const list = Array.isArray(marks) ? marks : [];
  const byId = new Map(list.filter((m) => m && m.id).map((m) => [m.id, m]));
  if (Array.isArray(items) && items.length) return items.map((it) => ({ id: it.id, item: it, mark: byId.get(it.id) || null }));
  return list.filter((m) => m && m.id).map((m) => ({ id: m.id, item: { id: m.id }, mark: m }));
}

/** Each row's fill ('sure' | 'unsure' | null) for its field; a verdict outside `valid` is no mark. */
function withFill(rows, field, fill, valid = VERDICTS, blocked = false) {
  return rows.map((r) => ({
    ...r,
    fill: !blocked && r.mark && valid.has(r.mark.verdict) ? fill(field, r.mark, { hintOnly: Boolean(r.mark.hint_only) }) : null,
  }));
}

/** Split item rows into a chip list (sure, ≥ 2 of them) and per-item radios (everything else). */
function partition(rows) {
  const chips = rows.filter((r) => r.fill === 'sure');
  return chips.length >= 2 ? { chips, radios: rows.filter((r) => !chips.includes(r)) } : { chips: [], radios: rows };
}

// ------------------------------------------------------------------ plan

function planBlock(block, { aiMarks = null, coachMarks = null, items = null, mode = prefillMode() } = {}) {
  const fromCoach = Boolean(coachMarks);
  const src = coachMarks || aiMarks || null;
  // The reading blocks are named for their language; maths bars do not differ by language.
  const lang = block === 'maths' ? null : block;
  const assist = mode === 'assist' && !fromCoach;
  const sure = (field, c, hintOnly = false) => fromCoach || confident(field, c, { lang, hintOnly });
  // 'sure' (clears its bar) | 'unsure' (assist: the AI marked it, below its bar) | null (arrives empty).
  // A count is marked when it exists; an item when its confidence is above 0 (assemble.js writes 'none'
  // at 0 for an item no scorer returned).
  const fill = (field, mark, { hintOnly = false, counted = false } = {}) => {
    if (!mark) return null;
    if (sure(field, mark.confidence, hintOnly)) return 'sure';
    return assist && (counted || Number(mark.confidence) > 0) ? 'unsure' : null;
  };
  const counted = (field, mark) => fill(field, mark, { counted: true });
  const it = (items && items[block]) || {};
  const plan = { block, fromCoach, src, mode, assist, sure, fill };

  if (block === 'maths') {
    const m = (src && src.maths) || {};
    const numbers = withFill(rowsOf(it.numbers, m.numbers), 'maths.numbers', fill);
    plan.numbers = { rows: numbers, ...partition(numbers) };
    const qs = m.quick_sums || null;
    const qsFill = counted('maths.quick_sums', qs);
    plan.quickSums = { mark: qs, filled: Boolean(qsFill), fill: qsFill };
    // A strip photo of the wrong form (L5: meta.photo.form_code_ok false) is not a mark of this child's sums.
    const wrongStrip = !fromCoach && Boolean(src && src.meta && src.meta.photo && src.meta.photo.form_code_ok === false);
    plan.written = withFill(rowsOf(it.written, m.written), 'maths.written', fill, WRITTEN, wrongStrip);
    const wpItem = it.word_problem || null;
    if (wpItem || m.word_problem) {
      const wpMark = m.word_problem || null;
      plan.wordProblem = {
        id: (wpItem && wpItem.id) || 'word_problem', item: wpItem || {}, mark: wpMark,
        fill: wpMark && VERDICTS.has(wpMark.verdict) ? fill('maths.word_problem', wpMark) : null,
      };
    } else plan.wordProblem = null;
    return plan;
  }

  const fb = Boolean(src && src.fallback);
  const fbFill = fb ? counted('fallback', src.fallback) : null;
  plan.fallback = fb ? { mark: src.fallback, filled: Boolean(fbFill), fill: fbFill } : null;
  const story = !fb && src && src.story ? src.story : null;
  const storyFill = counted('story.words_correct', story);
  plan.story = { mark: story, filled: Boolean(storyFill), fill: storyFill };

  // The chip list is always the model's flagged words (so a reopened check can re-tick one); which are
  // ticked comes from the coach's saved marks when there are some, otherwise from the bar.
  const aiFlags = (!fb && aiMarks && aiMarks.story && aiMarks.story.flagged) || [];
  const coachFlags = coachMarks && coachMarks.story ? (coachMarks.story.flagged || []) : null;
  const pool = (aiFlags.length ? aiFlags : (coachFlags || [])).filter((f) => f && Number.isInteger(f.idx));
  const tokens = (it.story && it.story.tokens) || [];
  const shown = [...pool].map((f, i) => ({ f, i }))
    .sort((a, b) => (Number(b.f.confidence) || 0) - (Number(a.f.confidence) || 0) || a.i - b.i)
    .slice(0, MAX_CHIPS).map((x) => x.f)
    .sort((a, b) => a.idx - b.idx);
  const flagSure = (f) => confident('story.flagged', f.confidence, { lang });
  const ticked = (f) => (coachFlags ? coachFlags.some((c) => c.idx === f.idx) : (flagSure(f) || assist));
  plan.flags = {
    shown: fb ? [] : shown.map((f) => ({ ...f, title: f.word || tokens[f.idx] || `#${f.idx}`, on: ticked(f), unsure: !coachFlags && assist && !flagSure(f) })),
    overflow: fb ? [] : pool.filter((f) => !shown.includes(f)),
  };

  plan.questions = withFill(rowsOf(it.questions, src && src.questions), 'questions', fill);
  plan.firstSounds = SLOTS[block].fs ? withFill(rowsOf(it.first_sounds, src && src.first_sounds), 'first_sounds', fill) : [];
  const nonwords = withFill(rowsOf(it.nonwords, src && src.nonwords), 'nonwords', fill);
  plan.nonwords = { rows: nonwords, ...partition(nonwords) };
  plan.fallbackOf = {
    letters: (fb && src.fallback.letters && src.fallback.letters.of) || ((it.fallback && it.fallback.letters) || []).length || 10,
    words: (fb && src.fallback.words && src.fallback.words.of) || ((it.fallback && it.fallback.words) || []).length || 10,
  };
  return plan;
}

// ------------------------------------------------------------------ render

function statusLine(S, { fromCoach, aiMarks, aiStatus }) {
  if (fromCoach) return S.status_coach;
  if (aiStatus === 'missing') return S.status_missing;
  if (aiStatus === 'failed') return S.status_failed;
  if (aiStatus === 'partial') return S.status_partial;
  if (!aiMarks) return S.status_pending;
  return S.status_scored;
}

const helpFor = (S, f) => (f === 'sure' ? S.help_filled : (f === 'unsure' ? S.help_unsure : S.help_empty));
const tagged = (S, text, f) => (f === 'unsure' ? `${text} ${S.unsure_tag}` : text);
/** A radio's description: "unsure, please check" in front when it arrived filled but below its bar. */
const described = (S, r, parts) => [r.fill === 'unsure' ? S.unsure_check : null, ...parts].filter(Boolean).join(' · ');
/** The one "unsure, please check" line a screen shows (empty when nothing on it is unsure). */
function unsureLine(S, data, list) {
  data.unsure_v = list.length > 0;
  data.unsure_line = list.length ? clip(S.unsure_line(list.join(S.list_sep)), CAP.desc) : '';
}
/** Pre-filled radios: a chip-list item never (its chip carries it), otherwise any fill in assist, none in strict. */
const radioInit = (plan, r) => (r.chip || (plan.assist && r.fill) ? r.mark.verdict : '');

/** Item radio slots: the item's text, the AI's verdict when sure, '' when not, hidden + 'none' when unused. */
function itemSlots(data, key, count, rows, { label, desc, init }) {
  for (let i = 1; i <= count; i += 1) {
    const r = rows[i - 1];
    data[`${key}${i}_v`] = Boolean(r && !r.chip);
    data[`${key}${i}_t`] = r ? clip(label(r, i), CAP.label) : '';
    data[`${key}${i}_d`] = r ? clip(desc(r, i), CAP.desc) : '';
    data[`${key}${i}_i`] = r ? init(r) : 'none';
  }
}

function chipList(data, key, chips, title) {
  data[`${key}_v`] = chips.length >= 2;
  data[`${key}_opts`] = chips.length >= 2 ? chips.map((r) => ({ id: r.id, title: clip(title(r), CAP.chip) })) : HIDDEN_CHIPS;
  data[`${key}_on`] = chips.length >= 2 ? chips.filter((r) => r.mark.verdict !== 'correct').map((r) => r.id) : [];
}

/** Rows for one item section, each marked as chip or radio, in bank order. */
function slotted(section) {
  const chipIds = new Set(section.chips.map((r) => r.id));
  return section.rows.map((r) => ({ ...r, chip: chipIds.has(r.id) }));
}

function renderReading(block, plan, S, lang, data) {
  const fb = plan.fallback;
  const story = plan.story;
  data.story_v = !fb;
  data.fb_v = Boolean(fb);
  data.t_story = S.t_story;
  data.t_wc = S.t_wc;
  data.t_wa = S.t_wa;
  data.wc_i = fb ? '0' : (story.filled ? num(story.mark.words_correct) : '');
  data.wa_i = fb ? '0' : (story.filled ? num(story.mark.words_attempted) : '');
  data.wc_h = helpFor(S, story.fill);
  data.wa_h = data.wc_h;

  const flags = plan.flags.shown;
  data.t_flag = S.t_flag;
  data.flag_cap = S.flag_cap;
  data.flag_v = flags.length >= 2;
  data.flag_opts = flags.length >= 2 ? flags.map((f) => ({ id: `w${f.idx}`, title: clip(f.title, CAP.chip) })) : HIDDEN_CHIPS;
  data.flag_on = flags.length >= 2 ? flags.filter((f) => f.on).map((f) => `w${f.idx}`) : [];
  data.sw_v = flags.length === 1;
  data.sw_t = flags.length === 1 ? clip(S.sw_label(flags[0].title), CAP.label) : '';
  data.sw_i = flags.length === 1 ? (flags[0].on ? 'wrong' : (plan.fromCoach ? 'correct' : '')) : 'correct';
  data.readwrong = S.readwrong;

  data.t_fb = S.t_fb;
  data.t_fl = S.t_fl;
  data.t_fw = S.t_fw;
  data.fl_h = fb && fb.fill === 'unsure' ? `${S.help_of10} · ${S.unsure_check}` : S.help_of10;
  data.fw_h = data.fl_h;
  data.fl_i = fb ? (fb.filled ? num(fb.mark.letters && fb.mark.letters.correct) : '') : '0';
  data.fw_i = fb ? (fb.filled ? num(fb.mark.words && fb.mark.words.correct) : '') : '0';

  data.t_q = S.t_q;
  data.verdicts = S.verdicts;
  itemSlots(data, 'q', SLOTS[block].q, plan.questions, {
    label: (r, i) => tagged(S, `${S.q_label} ${i}`, r.fill),
    desc: (r) => described(S, r, [r.item.prompt, r.mark ? (has(r.mark.heard) ? S.heard(r.mark.heard) : S.heard_nothing) : null]),
    init: (r) => (r.fill ? r.mark.verdict : ''),
  });

  if (SLOTS[block].fs) {
    data.fs_sec_v = plan.firstSounds.length > 0;
    data.t_fs = S.t_fs;
    itemSlots(data, 'fs', SLOTS[block].fs, plan.firstSounds, {
      label: (r, i) => tagged(S, `${i} · ${r.item.word || r.id}`, r.fill),
      desc: (r) => described(S, r, [r.mark && has(r.mark.heard) ? S.hint(r.mark.heard) : S.no_hint]),
      init: (r) => (r.fill ? r.mark.verdict : ''),
    });
  }

  data.t_nw = S.t_nw;
  data.t_nwc = S.t_nwc;
  data.nwc_cap = S.nwc_cap;
  chipList(data, 'nwc', plan.nonwords.chips, (r) => r.item.text || r.id);
  itemSlots(data, 'nw', SLOTS[block].nw, slotted(plan.nonwords), {
    label: (r) => tagged(S, `«${r.item.text || r.id}»`, r.fill),
    desc: (r) => itemDesc(S, plan, r),
    init: (r) => radioInit(plan, r),
  });

  const unsure = [];
  if (fb && fb.fill === 'unsure') unsure.push(S.u_fb);
  if (story.fill === 'unsure') unsure.push(S.u_count);
  if (flags.some((f) => f.unsure)) unsure.push(S.u_flags);
  plan.questions.forEach((r, i) => { if (r.fill === 'unsure') unsure.push(S.u_q(i + 1)); });
  plan.firstSounds.forEach((r, i) => { if (r.fill === 'unsure') unsure.push(S.u_fs(i + 1)); });
  plan.nonwords.rows.forEach((r) => { if (r.fill === 'unsure') unsure.push(S.u_nw(r.item.text || r.id)); });
  unsureLine(S, data, unsure);
}

/** A made-up word's / number's radio: nothing on a chip; "unsure, please check" when filled below its bar; "unclear" when empty. */
function itemDesc(S, plan, r) {
  if (r.chip || !r.mark) return '';
  const heard = has(r.mark.heard) ? S.heard(r.mark.heard) : null;
  if (r.fill === 'unsure') return [S.unsure_check, heard].filter(Boolean).join(' · ');
  if (plan.assist && r.fill) return heard || '';
  return [S.unsure, heard].filter(Boolean).join(' · ');
}

function renderMaths(plan, S, lang, data) {
  data.t_num = S.t_num;
  data.t_numc = S.t_numc;
  data.numc_cap = S.numc_cap;
  data.verdicts = S.verdicts;
  chipList(data, 'numc', plan.numbers.chips, (r) => (r.item.value != null ? String(r.item.value) : r.id));
  itemSlots(data, 'n', SLOTS.maths.n, slotted(plan.numbers), {
    label: (r) => tagged(S, r.item.value != null ? String(r.item.value) : r.id, r.fill),
    desc: (r) => itemDesc(S, plan, r),
    init: (r) => radioInit(plan, r),
  });

  const qs = plan.quickSums;
  data.t_qs = S.t_qs;
  data.t_qc = S.t_qc;
  data.t_qa = S.t_qa;
  data.qc_i = qs.filled ? num(qs.mark.correct) : '';
  data.qa_i = qs.filled ? num(qs.mark.attempted) : '';
  data.qc_h = helpFor(S, qs.fill);
  data.qa_h = data.qc_h;

  data.t_wr = S.t_wr;
  data.wverdicts = S.wverdicts;
  itemSlots(data, 'w', SLOTS.maths.w, plan.written, {
    label: (r) => tagged(S, r.item.prompt || r.id, r.fill),
    desc: (r) => (r.mark ? described(S, r, [has(r.mark.read_answer) ? S.read_as(r.mark.read_answer) : S.read_nothing]) : ''),
    init: (r) => (r.fill ? r.mark.verdict : ''),
  });

  const wp = plan.wordProblem;
  data.t_wp = S.t_wp;
  data.wp_v = Boolean(wp);
  data.wp_t = wp ? tagged(S, S.wp_label, wp.fill) : '';
  // The item bank keys the prompt by language (prompt_ur / prompt_en); the coach's own first.
  const prompt = wp ? wp.item[`prompt_${lang}`] || wp.item.prompt_ur || wp.item.prompt_en || '' : '';
  const read = wp && wp.mark ? (has(wp.mark.read_answer) ? S.read_as(wp.mark.read_answer) : S.read_nothing) : null;
  data.wp_d = wp ? clip(described(S, wp, [prompt, read]), CAP.desc) : '';
  data.wp_i = wp ? (wp.fill ? wp.mark.verdict : '') : 'none';

  const unsure = [];
  plan.numbers.rows.forEach((r) => { if (r.fill === 'unsure') unsure.push(r.item.value != null ? String(r.item.value) : r.id); });
  if (qs.fill === 'unsure') unsure.push(S.u_qs);
  plan.written.forEach((r, i) => { if (r.fill === 'unsure') unsure.push(S.u_w(i + 1)); });
  if (wp && wp.fill === 'unsure') unsure.push(S.u_wp);
  unsureLine(S, data, unsure);
}

/** Put what the coach posted back into the fields (after a refused save), so nothing they typed is lost. */
function applyPosted(block, data, posted) {
  const p = PREFIX[block];
  for (const k of Object.keys(data)) {
    const m = k.match(/^(.+)_i$/);
    if (m && has(posted[`${p}${m[1]}`])) data[k] = String(posted[`${p}${m[1]}`]);
  }
  for (const [onKey, field] of [['flag_on', 'flag'], ['nwc_on', 'nwc'], ['numc_on', 'numc']]) {
    if (data[onKey] && Array.isArray(posted[`${p}${field}`])) data[onKey] = posted[`${p}${field}`].map(String);
  }
}

/**
 * @param {'urdu'|'english'|'maths'} block
 * @param {object} o
 * @param {object|null} o.aiMarks      the block's ai_marks (null: not marked yet / failed / no recording)
 * @param {object|null} [o.coachMarks] the block's saved coach_marks (reopened check)
 * @param {object|null} o.items        FORM from the item bank
 * @param {string} o.lang              the coach's language
 * @param {{label: string}} o.child    how the coach sees the child (roll number, or the name L4 passes)
 * @param {string|null} [o.aiStatus]   scored | partial | failed | pending | missing
 * @param {boolean} [o.unavailable]    a token that matches no session of this coach: nothing shown, closable
 * @param {object} [o.posted]          the coach's own answers to put back (with o.errors)
 * @param {object} [o.errors]          field name → message
 * @param {string} [o.status]          a catalog key for the status line instead of the AI's state
 * @returns {{screen: string, data: object}}
 */
function renderScreen(block, o = {}) {
  const S = checkStrings(o.lang);
  const unavailable = Boolean(o.unavailable);
  const plan = planBlock(block, unavailable ? { mode: o.mode } : o);
  const data = {
    child_line: unavailable ? '' : clip((o.child && o.child.label) || '', CAP.line),
    status_line: unavailable ? S.status_unavailable : (o.status ? S[o.status] : statusLine(S, { fromCoach: plan.fromCoach, aiMarks: o.aiMarks, aiStatus: o.aiStatus })),
    sec_v: !unavailable,
    t_next: S[`next_${block}`],
    error_messages: o.errors || {},
  };
  if (block === 'maths') renderMaths(plan, S, o.lang, data);
  else renderReading(block, plan, S, o.lang, data);
  if (unavailable) {
    Object.assign(data, block === 'maths' ? { qc_i: '0', qa_i: '0' } : { story_v: false, wc_i: '0', wa_i: '0' });
  }
  if (o.posted) applyPosted(block, data, o.posted);
  return { screen: SCREEN_OF[block], data };
}

// ------------------------------------------------------------------ read back

function readScreen(block, posted = {}, { aiMarks = null, coachMarks = null, items = null, lang, mode = prefillMode() } = {}) {
  const S = checkStrings(lang);
  const plan = planBlock(block, { aiMarks, coachMarks, items, mode });
  const p = PREFIX[block];
  const errors = {};
  const shownEmpty = [];
  const shownUnsure = [];
  // Where a mark arrived: empty (the coach filled it blind) or filled but unsure (the coach was asked to check).
  const arrived = (path, f) => { if (!f) shownEmpty.push(path); else if (f === 'unsure') shownUnsure.push(path); };
  const count = (field, max) => {
    const s = String(posted[`${p}${field}`] == null ? '' : posted[`${p}${field}`]).trim();
    if (!/^\d+$/.test(s)) { errors[`${p}${field}`] = S.err_number; return null; }
    const n = Number(s);
    if (max != null && n > max) { errors[`${p}${field}`] = S.err_out_of(max); return null; }
    return n;
  };
  const pick = (field, allowed) => {
    const v = posted[`${p}${field}`];
    if (!allowed.has(v)) { errors[`${p}${field}`] = S.err_pick; return null; }
    return v;
  };
  const ticked = (field) => new Set((Array.isArray(posted[`${p}${field}`]) ? posted[`${p}${field}`] : []).map(String));
  const itemVerdicts = (section, field, chipField, path) => {
    const on = ticked(chipField);
    return slotted(section).map((r, i) => {
      if (r.chip) {
        const verdict = on.has(r.id) ? (r.mark.verdict !== 'correct' ? r.mark.verdict : 'wrong') : 'correct';
        return { id: r.id, verdict, heard: (r.mark && r.mark.heard) || '' };
      }
      // strict: every radio arrived empty (L6); assist: a radio with a mark arrived filled
      arrived(`${path}[${r.id}]`, plan.assist ? r.fill : null);
      return { id: r.id, verdict: pick(`${field}${i + 1}`, VERDICTS), heard: (r.mark && r.mark.heard) || '' };
    });
  };
  const radios = (rows, field, path, allowed = VERDICTS) => rows.map((r, i) => {
    arrived(`${path}[${r.id}]`, r.fill);
    return { id: r.id, verdict: pick(`${field}${i + 1}`, allowed), heard: (r.mark && r.mark.heard) || '' };
  });

  const coach = {
    version: 'coach-marks-v1',
    block,
    story: null,
    fallback: null,
    questions: [],
    first_sounds: [],
    nonwords: [],
    maths: null,
    protocol_flags: (aiMarks && aiMarks.protocol_flags) || [],
    meta: { source: aiMarks ? 'ai' : 'none', shown_empty: shownEmpty, prefill_mode: plan.mode, shown_unsure: shownUnsure },
  };

  if (block === 'maths') {
    const numbers = itemVerdicts(plan.numbers, 'n', 'numc', 'maths.numbers');
    arrived('maths.quick_sums', plan.quickSums.fill);
    const correct = count('qc');
    const attempted = count('qa');
    if (correct != null && attempted != null && correct > attempted) errors[`${p}qc`] = S.err_more_than_tried;
    const written = plan.written.map((r, i) => {
      arrived(`maths.written[${r.id}]`, r.fill);
      return { id: r.id, read_answer: (r.mark && r.mark.read_answer) || '', verdict: pick(`w${i + 1}`, WRITTEN) };
    });
    let wordProblem = null;
    if (plan.wordProblem) {
      const wm = plan.wordProblem.mark;
      arrived('maths.word_problem', plan.wordProblem.fill);
      wordProblem = { verdict: pick('wp', VERDICTS), read_answer: (wm && wm.read_answer) || '' };
    }
    const qsMark = plan.quickSums.mark || {};
    coach.maths = {
      numbers,
      quick_sums: { correct, attempted, seconds: qsMark.seconds != null ? qsMark.seconds : 60 },
      written,
      word_problem: wordProblem,
    };
  } else {
    if (plan.fallback) {
      arrived('fallback', plan.fallback.fill);
      coach.fallback = {
        letters: { correct: count('fl', plan.fallbackOf.letters), of: plan.fallbackOf.letters },
        words: { correct: count('fw', plan.fallbackOf.words), of: plan.fallbackOf.words },
      };
    } else {
      arrived('story.words_correct', plan.story.fill);
      arrived('story.words_attempted', plan.story.fill);
      const wc = count('wc');
      const wa = count('wa');
      if (wc != null && wa != null && wc > wa) errors[`${p}wc`] = S.err_more_than_tried;
      const shown = plan.flags.shown;
      shown.filter((f) => f.unsure).forEach((f) => shownUnsure.push(`story.flagged[${f.idx}]`));
      let kept = [];
      if (shown.length >= 2) {
        const on = ticked('flag');
        kept = shown.filter((f) => on.has(`w${f.idx}`));
      } else if (shown.length === 1) {
        if (!shown[0].on && !plan.fromCoach) shownEmpty.push(`story.flagged[${shown[0].idx}]`);
        const v = pick('sw', new Set(['wrong', 'correct']));
        kept = v === 'wrong' ? shown : [];
      }
      const m = plan.story.mark || {};
      coach.story = {
        words_correct: wc,
        words_attempted: wa,
        seconds: m.seconds != null ? m.seconds : 60,
        finished_early: Boolean(m.finished_early),
        flagged: [...kept, ...plan.flags.overflow]
          .map((f) => ({ idx: f.idx, word: f.word || f.title || '', verdict: f.verdict === 'skipped' ? 'skipped' : 'wrong' }))
          .sort((a, b) => a.idx - b.idx),
      };
    }
    coach.questions = radios(plan.questions, 'q', 'questions');
    coach.first_sounds = radios(plan.firstSounds, 'fs', 'first_sounds');
    coach.nonwords = itemVerdicts(plan.nonwords, 'nw', 'nwc', 'nonwords');
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, coachMarks: coach, edits: diffMarks(block, aiMarks, coach) };
}

// ------------------------------------------------------------------ diff

function diffMarks(block, ai, coach) {
  const edits = [];
  const add = (path, a, c) => {
    const av = a === undefined ? null : a;
    const cv = c === undefined ? null : c;
    if (av !== cv) edits.push({ path, ai: av, coach: cv });
  };
  const items = (section, aiList, coachList) => {
    const byId = new Map((aiList || []).map((x) => [x.id, x]));
    for (const c of coachList || []) add(`${section}[${c.id}].verdict`, byId.has(c.id) ? byId.get(c.id).verdict : null, c.verdict);
  };
  const a = ai || {};
  const c = coach || {};
  if (block === 'maths') {
    const am = a.maths || {};
    const cm = c.maths || {};
    items('maths.numbers', am.numbers, cm.numbers);
    if (cm.quick_sums) {
      add('maths.quick_sums.correct', am.quick_sums ? am.quick_sums.correct : null, cm.quick_sums.correct);
      add('maths.quick_sums.attempted', am.quick_sums ? am.quick_sums.attempted : null, cm.quick_sums.attempted);
    }
    items('maths.written', am.written, cm.written);
    if (cm.word_problem) add('maths.word_problem.verdict', am.word_problem ? am.word_problem.verdict : null, cm.word_problem.verdict);
    return edits;
  }
  if (c.story) {
    const as = a.story || {};
    add('story.words_correct', as.words_correct, c.story.words_correct);
    add('story.words_attempted', as.words_attempted, c.story.words_attempted);
    const coachIdx = new Map((c.story.flagged || []).map((f) => [f.idx, f]));
    const aiIdx = new Map((as.flagged || []).map((f) => [f.idx, f]));
    for (const f of as.flagged || []) if (!coachIdx.has(f.idx)) add(`story.flagged[${f.idx}]`, f.verdict, 'correct');
    for (const f of c.story.flagged || []) if (!aiIdx.has(f.idx)) add(`story.flagged[${f.idx}]`, 'correct', f.verdict);
  }
  if (c.fallback) {
    const af = a.fallback || {};
    add('fallback.letters.correct', af.letters ? af.letters.correct : null, c.fallback.letters.correct);
    add('fallback.words.correct', af.words ? af.words.correct : null, c.fallback.words.correct);
  }
  items('questions', a.questions, c.questions);
  items('first_sounds', a.first_sounds, c.first_sounds);
  items('nonwords', a.nonwords, c.nonwords);
  return edits;
}

module.exports = { planBlock, renderScreen, readScreen, diffMarks, MAX_CHIPS, PREFIX, SCREEN_OF, HIDDEN_CHIPS };
