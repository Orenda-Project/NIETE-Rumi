/**
 * The self-administered battery runner: one child through a list of timed EGRA/EGMA subtasks (switch sa_engine).
 *
 * Pure: no DOM, no storage, no timers. The page drives it (answer, tick, done …) and renders runner.view(); every
 * change is emitted as an event { seq, t_ms, at, type, task_id?, item_id?, value? } through opts.onEvent, in order,
 * before the call returns, so the page can write it to the phone's store before it draws the next screen.
 *
 * The battery is the content lane's file (bot/shared/data/child-test/sa/sa.<form>.<lang>.json); normalize() reads it
 * into the runtime shape. How the child answers each subtask is the lead's ruling (design: one mode per subtask):
 *   tap      Jugnu says the target, the child taps it among the tiles (letters, made-up words, words, number ID,
 *            comparison, missing number); scored on the phone
 *   keypad   the child types the number (sums L1/L2, word problems); scored on the phone
 *   keyboard the child types the word on an a–z strip (spelling/dictation); right/wrong on the phone (case and
 *            spaces aside), the typed text kept for partial credit later
 *   record   the child reads the passage aloud (recorded), then taps the last word read; scored later
 *   oral     Jugnu asks each question, the child answers aloud (recorded per question); scored later
 *
 * Per task:  instruction (Jugnu's words, replayable) → practice (feedback; a wrong answer is tried once more, then
 * shown) → ready → running (the clock when EGRA times it) → [last_word] → stop → next task.
 *
 * Stop rules are the task's data (stop: { first_line_n, first_line_min_correct, consecutive_errors, time_up }):
 *   time_up                  the task's 60 s ran out
 *   early_stop_first_line    fewer than first_line_min_correct right in the first first_line_n items
 *   consecutive_errors       that many wrong in a row (EGMA's untimed rule)
 *   complete                 every item answered, or "I'm done" on the passage
 *   coach_end                the coach ended the task (proctored unlock)
 *   skipped_level2           depends_on.skip_if_zero: the level-1 task scored 0 (Core EGMA)
 *   skipped_no_first_line    depends_on.items_read_upto: no question within the part read (or skip_if_stop matched)
 * A timed tap item with no tap: Jugnu says it again at replay_at_s (5 s), and at item_timeout_s (10 s) it counts as
 * wrong and the next one shows. An untimed item waits; after next_at_s (15 s) the page offers "next" (skip()).
 *
 *   mic_unavailable          a task that records (passage, spoken answers) with no working microphone: skipped,
 *                            never a silent recording (proctored: the coach's pre-flight sets it; game: the engine's
 *                            own mic check, once per device)
 *   early_stop_silence       the passage: no voice for 20 s (the mercy rule; the star was offered at 12 s)
 *   assets_unavailable       a picture the item needs would not load (offline, not on the phone): the item cannot be
 *                            answered, so the task ends there and blank tiles never become scores
 *   skipped_dev              passed over with the sandbox-only "Jump to…" (opts.dev_tools; RULING #43): no score, no
 *                            counts, scored_on 'none'
 *
 * Round 7b (the pilot's tester, 27 Oct), each behind its own switch, OFF = the runner as before. A section is a task id's
 * language prefix (ur. → en. → ma.).
 *   end_section              opts.end_section, RDF manual only: endSection() ends the task on show (end_section) and
 *                            skips the rest of its section (skipped_end_section); the test goes on at the next section.
 *                            One end_section event { by: 'coach', section }.
 *   skipped_incomplete       opts.incomplete, RDF auto only (the tester's final rule: completion, not correctness): a part
 *                            the child did not finish skips the rest of its subject. Not finished = read-aloud cells: time
 *                            up before moving past the last cell (time_up), or "I'm done" before it (stopped_early); the
 *                            story: time up (time_up), the last-word tap before the last word (last_word_early), the
 *                            silence stop (silence) — "I'm done" with no last-word step is finished; tap / keypad parts:
 *                            time up before the last item (time_up); spoken questions: one left unanswered when its time
 *                            ran out (time_up); any part EGRA's / EGMA's own early-stop rule ended (stop_rule). The true
 *                            score still comes from the recording. One incomplete_move_on event
 *                            { by: 'app', section, reason, reached, of }, only when something is skipped.
 *   silence_reminder (phase) opts.silence_repeat, RDF auto only: a read-aloud part (record) whose recording ran with the
 *                            ear listening and no voice heard ends in the reminder instead of a result (one silence_repeat
 *                            event { by: 'app', attempt: 1 }); silenceRepeatDone() runs the part again from its start. Once
 *                            per part (gates.silence_repeated, kept across a reload); a second silence ends as before.
 *
 * Round 8 (the reviewer's 28 Oct list), each behind its own switch, OFF = the runner as before:
 *   skipped_no_voice         battery.ui.r8_reading_position (or opts.reading_position), RDF auto with no last-word step:
 *                            the story's questions follow how much the child read aloud (EGRA's discontinue rule). The
 *                            recorder's ear calls voice() on every voiced tick; the passage's voiced seconds are counted as
 *                            the ear does (a run's first report is its three loud reads, 0.3 s; each further one 0.1 s).
 *                            Under 1.0 s voiced, by Done or time up: the questions end as skipped_no_voice, with one
 *                            no_reading_skip event { by: 'app', story, voiced_s, min_s }. 1.0 s or more: they are asked,
 *                            and a time-up no longer counts as not finished. Evidence only: with no recording, an ear
 *                            that was not listening (voiceWatch(), or the silence repeat's ear) or one that was
 *                            unavailable, the questions are asked. The passage's result keeps voiced_s and
 *                            position_source ('voice' | 'none').
 *   r8_timeup_continue       battery.ui.r8_timeup_continue (or opts.timeup_continue), with opts.incomplete: a part's own
 *                            clock running out (time_up) is that part finished; the rest of its subject goes on. The
 *                            early-stop rule, the silence stop, "I'm done" before the last cell, the last-word tap before
 *                            the last word and a spoken question left unanswered still skip the rest.
 *
 * Session gates, once each: the mic check (game) before the first task that records, one practice oral question before
 * the first oral task, a keypad warm-up before the first keypad task. The page losing sight of the screen during a
 * timed task re-runs that task from its start (resumed), as a reload does.
 *
 * A task stopped by a reload or a killed tab: a timed one is run again from its start, flagged resumed (EGRA); an
 * untimed one resumes at the item reached. Finished tasks are never asked again.
 *
 * One at a time (opts.one_at_a_time, switch sa_one_at_a_time): a read-aloud grid (letter names, letter sounds,
 * familiar words: response record + grid) shows one cell; nextCell() (a tap) shows the next, and a cell left alone
 * moves on after cell_auto_s (3 s, EGRA's "please go on"; tick() answers 'go_on'). One recording for the task as before;
 * the task's clock runs across the cells, each cell's time is kept (result.cells, cell_next events) and last_item_index
 * is the cell reached. Fluency (mental_math_fluency) moves on after 5 s with no answer. Every answer carries its ms.
 * A task whose data says present 'one_at_a_time' (the W3 forms) runs this way with or without the switch: its cells
 * are its grid, else its items' show; advance_after_s is the wait (null: next_at_s, the untimed sums' 15 s), and each
 * kept cell names its item_id.
 * Coach-led (opts.manual, RDF manual): nothing moves on by itself; session_start says admin_mode 'manual'.
 * Next only (opts.cell_next_only, switch sa_cell_next_only, round 5): an Urdu or English letter/word cell never moves on
 * by itself, in any mode (it wins over cell_pace); only Next does. The task's clock still runs; no silence stop for it.
 *
 * Round 8: battery.ui.r8_comp_wait_next — a reading or listening comprehension question has no per-question timeout:
 * the child answers, then presses Next (the page says a stuck child can press it). Other spoken parts keep theirs.
 *
 * UMD: window.SAE.core in the browser, module.exports under Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.SAE = root.SAE || {}; root.SAE.core = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = Object.freeze({
    COMPLETE: 'complete', TIME_UP: 'time_up', FIRST_LINE: 'early_stop_first_line',
    CONSECUTIVE: 'consecutive_errors', COACH_END: 'coach_end',
    SKIPPED_L2: 'skipped_level2', SKIPPED_NO_LINE: 'skipped_no_first_line',
    MIC: 'mic_unavailable', SILENCE: 'early_stop_silence', ASSETS: 'assets_unavailable', DEV: 'skipped_dev',
    // round 7b: the coach's End this section (RDF manual) and the auto move-on when a part is not finished (RDF auto)
    END_SECTION: 'end_section', SKIPPED_END_SECTION: 'skipped_end_section', SKIPPED_INCOMPLETE: 'skipped_incomplete',
    // round 8: the story's questions when the child read nothing aloud (RDF auto)
    SKIPPED_NO_VOICE: 'skipped_no_voice',
  });
  var MODES = ['tap', 'keypad', 'keyboard', 'record', 'oral'];
  // The lead's ruling (design §2): the response mode per EGRA/EGMA subtask. A task's own `response` wins.
  var MODE_BY_SUBTASK = {
    letter_name_identification: 'tap', letter_sound_identification: 'tap', nonword_reading: 'tap',
    familiar_word_reading: 'tap', number_identification: 'tap', quantity_discrimination: 'tap', missing_number: 'tap',
    addition_level_1: 'keypad', subtraction_level_1: 'keypad', addition_level_2: 'keypad', subtraction_level_2: 'keypad',
    word_problems: 'keypad', spelling: 'keyboard', dictation: 'keyboard', oral_reading_fluency: 'record', listening_comprehension: 'oral', reading_comprehension: 'oral',
    mental_math_fluency: 'oral', mental_addition: 'oral', mental_subtraction: 'oral', mental_multiplication: 'oral',
  };
  // SA time rules (design §2): timed items replay at 5 s and move on at 10 s; untimed items offer "next" at 15 s.
  var TIMED_REPLAY_S = 5;
  var TIMED_ITEM_S = 10;
  var UNTIMED_NEXT_S = 15;
  // One at a time (Toolkit 2016 Annex H: "if the child hesitates for 3 seconds … please go on"; Core EGMA: 5 s).
  var CELL_AUTO_S = 3;
  var FLUENCY_ITEM_S = 5;
  var CELL_PACE_FLOOR_S = 5; // sa_cell_pace: no item moves on by itself before 5 s on screen
  var CELL_PACE_CAP_S = 10; // sa_cell_pace: and every item moves on by itself at 10 s on screen, whatever the sound
  var COMP_ALL_MIN_WORDS = 10; // RWP May 2026 rdcomp_*: asked when 10+ words were attempted (2,233/2,233 rows)
  // Round 8 (r8_reading_position): under this many voiced seconds on the passage, the child read nothing. 1.0 s, not 2.0:
  // a reader of 3 words measured 1.6-1.8 s; silent and noisy rooms 0.0-0.4 s.
  var NO_VOICE_S = 1.0;
  var VOICE_TICK_MS = 100; // the recorder's ear reads the level ten times a second
  var VOICE_RUN_TICKS = 3; // and reports a voice after three loud reads in a row

  function str(x) { return typeof x === 'string' && x.length > 0; }
  function num() { for (var i = 0; i < arguments.length; i++) if (typeof arguments[i] === 'number' && arguments[i] > 0) return arguments[i]; return null; }
  function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }

  function stopOf(s) {
    s = s || {};
    var out = {};
    // The proposal's first spelling ({type, n}) is read too.
    if (s.type === 'first_row') { out.first_line_n = s.n; out.first_line_min_correct = 1; }
    if (s.type === 'consecutive_errors') out.consecutive_errors = s.n;
    if (s.first_line_n) { out.first_line_n = s.first_line_n; out.first_line_min_correct = s.first_line_min_correct || 1; }
    if (s.consecutive_errors) out.consecutive_errors = s.consecutive_errors;
    return out;
  }

  function itemOf(it) {
    var o = {};
    for (var k in it) if (has(it, k)) o[k] = it[k];
    if (!has(o, 'target')) o.target = it.answer;
    // The runtime batteries put what the child sees ("1 + 3 =") in shown.
    if (o.label == null && it.shown != null) o.label = it.shown;
    if (!has(o, 'options') && Array.isArray(it.choices)) o.options = it.choices;
    return o;
  }

  /** The content file's task (or an already-runtime one) → the runtime task. */
  function taskOf(t) {
    if (t.__sa) return t;
    var mode = t.response || (MODES.indexOf(t.mode) >= 0 && t.mode !== 'tap' ? t.mode : null) || MODE_BY_SUBTASK[t.subtask] || (t.mode === 'tap' ? 'tap' : null);
    if (!mode && t.mode === 'both') mode = 'tap';
    var timed = t.time_limit_s != null ? t.time_limit_s : (t.timed_s != null ? t.timed_s : null);
    var r = {
      __sa: true, id: t.id, mode: mode, lang: t.lang, title: t.title || null, family: t.family || null, subtask: t.subtask || null,
      legacy_block: t.legacy_block || null, time_limit_s: timed || null,
      stop: stopOf(t.stop), depends_on: t.depends_on || null,
      items: (t.items || []).map(itemOf), practice: (t.practice || []).map(itemOf),
      passage: t.passage || null, grid: t.grid || null, per_row: t.per_row || (t.grid && t.grid.cols) || 10,
      direction: t.direction || (t.passage && t.passage.direction) || (t.grid && t.grid.direction) || 'ltr',
      instruction: t.instruction || null, script: t.script || {}, source: t.source || null, deviation: t.deviation || null,
      coach_text: t.coach_text || null,
      tap_on: t.tap_on || null, option_images: t.option_images || null, present: t.present || null,
      // One at a time: the wait before a cell moves on by itself (0: never).
      cell_auto_s: has(t, 'advance_after_s') ? (num(t.advance_after_s, t.next_at_s) || 0) : (num(t.cell_auto_s) || CELL_AUTO_S),
      // The mercy rule's timings on a passage (RULING #10): the battery's, else 12 s / 20 s.
      mercy_after_s: num(t.mercy_after_s, t.record && t.record.mercy_after_s, 12),
      silence_stop_s: num(t.silence_stop_s, t.record && t.record.silence_stop_s, 20),
    };
    // A passage keeps the rotation variant it was given (sa-page.js rotate; null without rotation), for its result.
    if (t.kind === 'passage') r.variant_id = t.variant && t.variant.id ? t.variant.id : null;
    // A one-at-a-time sum read only on the replay tile (W3). Kept off the older tasks, whose say_on the page never read.
    if (t.present === 'one_at_a_time' && t.say_on) r.say_on = t.say_on;
    // The item screen's chip (W3-12 4c: a mental sum says "Say the answer"), else the page's own "Read aloud".
    if (t.chip) r.chip = t.chip;
    if (mode === 'oral') {
      r.item_timeout_s = t.question_timeout_s || t.item_timeout_s || TIMED_ITEM_S;
    } else if (mode === 'tap' || mode === 'keypad' || mode === 'keyboard') {
      if (has(t, 'item_timeout_s')) r.item_timeout_s = t.item_timeout_s;
      else r.item_timeout_s = timed ? TIMED_ITEM_S : (t.subtask === 'word_problems' ? 60 : null);
      r.replay_at_s = has(t, 'replay_at_s') ? t.replay_at_s : (timed ? TIMED_REPLAY_S : null);
      r.next_at_s = timed ? null : (has(t, 'next_at_s') ? t.next_at_s : UNTIMED_NEXT_S);
    }
    return r;
  }

  /** The content file's battery → the runtime battery (idempotent). */
  function normalize(battery) {
    if (!battery || !Array.isArray(battery.tasks)) return battery;
    var out = {};
    for (var k in battery) if (has(battery, k)) out[k] = battery[k];
    out.tasks = battery.tasks.map(taskOf);
    return out;
  }

  /** Throws on a battery the runner cannot run, with the first reason. */
  function validate(battery) {
    if (!battery || !Array.isArray(battery.tasks) || battery.tasks.length === 0) throw new Error('battery: no tasks');
    var seen = {};
    normalize(battery).tasks.forEach(function (t, i) {
      var at = 'battery.tasks[' + i + ']';
      if (!t || !str(t.id)) throw new Error(at + ': no id');
      if (seen[t.id]) throw new Error(at + ': duplicate id ' + t.id);
      seen[t.id] = true;
      if (MODES.indexOf(t.mode) < 0) throw new Error(at + ' (' + t.id + '): no response mode (tap, keypad, record, oral)');
      if (t.time_limit_s != null && !(t.time_limit_s > 0)) throw new Error(at + ': bad time limit');
      if (t.mode === 'tap') {
        if (!t.items.length) throw new Error(at + ': tap task with no items');
        t.items.forEach(function (it, j) {
          if (it && str(it.id) && typeof it.target_index === 'number') return; // a tap on the passage's word
          if (!it || !str(it.id) || !Array.isArray(it.options) || it.options.length < 2 || it.options.indexOf(it.target) < 0) {
            throw new Error(at + '.items[' + j + ']: needs id, options (2+) and a target among them');
          }
        });
      } else if (t.mode === 'keypad' || t.mode === 'keyboard') {
        if (!t.items.length) throw new Error(at + ': ' + t.mode + ' task with no items');
        t.items.forEach(function (it, j) {
          if (!it || !str(it.id) || it.target == null || it.target === '') throw new Error(at + '.items[' + j + ']: needs id and an answer');
        });
      } else if (t.mode === 'record') {
        if (!(Array.isArray(t.grid) && t.grid.length) && !(t.passage && (str(t.passage) || str(t.passage.text))) && !t.items.length) {
          throw new Error(at + ': record task needs a grid, a passage or its words');
        }
      } else if (!t.items.length) {
        throw new Error(at + ': oral task with no questions');
      }
      t.practice.forEach(function (p, j) {
        if (t.mode === 'tap' && typeof p.target_index !== 'number' && (!Array.isArray(p.options) || p.options.indexOf(p.target) < 0)) throw new Error(at + '.practice[' + j + ']: target not among options');
        if ((t.mode === 'keypad' || t.mode === 'keyboard') && p.target == null) throw new Error(at + '.practice[' + j + ']: no answer');
      });
    });
    return true;
  }

  function same(a, b) { return a === b || (a != null && b != null && String(a).trim() === String(b).trim()); }
  /** A tap on the passage is scored by the word's place (index into passage.words), never by the word: a word can
   * appear twice. Anything else by value. */
  function hit(it, value, mode) {
    if (typeof it.target_index === 'number') return value !== null && value !== '' && Number(value) === it.target_index;
    return mode === 'keyboard' ? sameWord(value, it.target) : same(value, it.target);
  }
  function sameWord(a, b) { return a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

  /**
   * createRunner({ battery, now, onEvent, session_id, resume, audio_check, warmup }) → runner.
   * now() is a monotonic ms clock (performance.now in the page); resume is a previous runner.snapshot().
   */
  function createRunner(opts) {
    validate(opts.battery);
    var battery = normalize(opts.battery);
    var now = opts.now || function () { return Date.now(); };
    var wall = opts.wall || function () { return new Date().toISOString(); };
    var emit = opts.onEvent || function () {};
    var resume = opts.resume || null;
    var t0 = now() - (resume ? resume.t_ms || 0 : 0);
    var seq = resume ? resume.seq || 0 : 0;
    var results = resume ? (resume.results || []).slice() : [];
    var taskIndex = resume ? resume.task_index || 0 : 0;
    var warm = resume ? resume.warmup || null : null;
    // Session gates already passed (they never come twice in a run, a reload included).
    var gates = resume && resume.gates ? JSON.parse(JSON.stringify(resume.gates)) : {};
    var mic = opts.mic || function () { return 'ok'; };
    var st = { phase: 'battery_intro' };
    var oneAtATime = !!opts.one_at_a_time;
    var manual = !!opts.manual;
    var compAll = !!opts.comp_all_questions;
    // sa_auto_no_last_word (round 7, RDF auto): the passage ends on "I'm done" / time up with no last-word step;
    // its result says last_word_skipped and its questions are all asked (no tapped line to gate them on).
    var skipLW = !!opts.skip_last_word && !opts.manual;
    var cellPace = !!opts.cell_pace;
    var cellNextOnly = !!opts.cell_next_only;
    var sectionRec = !!opts.section_recording;
    // Round 7b: End this section (RDF manual), the move-on when a part is not finished and the silence repeat (RDF auto).
    var endSectionOn = !!opts.end_section && manual;
    var incompleteOn = !!opts.incomplete && !manual;
    var silenceRepeatOn = !!opts.silence_repeat && !manual;
    var skipTo = null; // the last task a skip passed over: next() goes on after it
    // sa_back_button (round 7b): Back on the item screens (battery.ui.back_button, or opts.back_button)
    var backOn = !!opts.back_button || !!(battery.ui && battery.ui.back_button === true);
    // Round 8 (battery.ui.r8_comp_wait_next): a story or listening question never moves on by itself; only Next does.
    var compWait = !!(battery.ui && battery.ui.r8_comp_wait_next === true);
    // Round 8: the story's questions by the voice heard (RDF auto, no last-word step); a time-up ends only its own part.
    var positionOn = skipLW && (!!opts.reading_position || !!(battery.ui && battery.ui.r8_reading_position === true));
    var timeupGoesOn = incompleteOn && (!!opts.timeup_continue || !!(battery.ui && battery.ui.r8_timeup_continue === true));

    /** sa_cell_next_only: an Urdu or English letter/word cell moves on only on Next (maths cells keep their pace). */
    function holdsCell(t) { return cellNextOnly && cellTask(t) && /^(ur|en)\./.test(String(t.id)); }
    /** A read-aloud grid shown one cell at a time (never a passage). */
    function cellTask(t) {
      if (!t || t.mode !== 'record' || t.passage) return false;
      if (t.present === 'one_at_a_time') return cellsOf(t).length > 0;
      return oneAtATime && Array.isArray(t.grid) && t.grid.length > 0;
    }
    function cellsOf(t) {
      if (Array.isArray(t.grid) && t.grid.length) return t.grid;
      return t.items.map(function (it) { return it.show != null ? it.show : (it.label != null ? it.label : it.target); });
    }
    function itemTimeoutS(t) {
      if (oneAtATime && t.subtask === 'mental_math_fluency' && t.item_timeout_s === TIMED_ITEM_S) return manual ? null : FLUENCY_ITEM_S;
      if (manual && t.mode === 'oral') return null; // coach-led: the coach reads the question; the coach moves on
      if (compWait && t.mode === 'oral' && /comprehension$/.test(t.subtask || '')) return null;
      return t.item_timeout_s;
    }
    /** The cell on show ends: its time is kept; how = tap | auto | the stop reason. */
    function closeCell(how) {
      var c = st.cell;
      if (!c) return;
      var e = { i: c.i, at_ms: Math.round(c.at - st.started), ms: Math.round(now() - c.at), how: how };
      var it = task().items[c.i];
      if (it && it.id) e = { i: c.i, item_id: it.id, at_ms: e.at_ms, ms: e.ms, how: how };
      st.cells.push(e);
      st.last_item_index = c.i;
      st.cell = null;
      ev('cell_next', { task_id: st.task_id, value: e });
    }
    function nextCell(how) {
      var t = task();
      if (st.phase !== 'running' || !st.cell) return;
      var i = st.cell.i;
      closeCell(how);
      if (i + 1 >= cellsOf(t).length) { finish(STOP.COMPLETE); return; }
      st.cell = { i: i + 1, at: now() };
    }

    function ev(type, extra) {
      var e = { session_id: opts.session_id || null, seq: ++seq, t_ms: Math.round(now() - t0), at: wall(), type: type };
      if (extra) for (var k in extra) if (has(extra, k) && extra[k] !== undefined) e[k] = extra[k];
      // The engine logs record_start when the recorder really opens: the task then has a recording to wait for.
      if (type === 'record_start' && st && st.task_id && (!e.task_id || e.task_id === st.task_id)) {
        st.recorded = true;
        // sa_section_recording: the oral task's one recording starts here; the items' marks count from it.
        if (sectionRec && !e.item_id && st.rec_t0 == null) { st.rec_t0 = now(); st.rec_marks = []; }
      }
      emit(e);
      return e;
    }
    function task() { return battery.tasks[taskIndex] || null; }
    function resultOf(id) { for (var i = 0; i < results.length; i++) if (results[i].task_id === id) return results[i]; return null; }

    /** depends_on → a skip reason, or the questions still to ask. */
    function gate(t) {
      var d = t.depends_on;
      if (!d || !d.task) return { items: t.items };
      var dep = resultOf(d.task);
      if (!dep) return { items: t.items }; // the task it hangs on is not in this run (another block): ask everything
      // RDF auto with no last-word step: every question, unless the passage stopped on its first line.
      if (dep.last_word_skipped && (d.items_read_upto || d.upto_item)) {
        if (positionOn && dep.stop_reason !== STOP.FIRST_LINE && readNothing(dep)) return { skip: STOP.SKIPPED_NO_VOICE, story: dep };
        return dep.stop_reason === STOP.FIRST_LINE ? { skip: STOP.SKIPPED_NO_LINE } : { items: t.items };
      }
      if (d.skip_if_zero && dep.correct === 0) return { skip: STOP.SKIPPED_L2 };
      if (d.skip_if_stop && dep.stop_reason === d.skip_if_stop) return { skip: STOP.SKIPPED_NO_LINE };
      if (d.items_read_upto || d.upto_item) {
        var line = dep.last_word_line;
        if (line == null) return { skip: STOP.SKIPPED_NO_LINE };
        // W3 forms: a question asked only once the child read min_words words (the coach card's "only if the child
        // read past …"); older forms by the line reached.
        var read = dep.last_word_index != null ? dep.last_word_index + 1 : 0;
        // Round 4 (sa_comp_all_questions): the Rawalpindi rule. 10+ words read, not stopped on the first line → every question,
        // whatever the variant's questions carry (min_words gates or needs_line).
        if (compAll) {
          return read >= COMP_ALL_MIN_WORDS && dep.stop_reason !== STOP.FIRST_LINE ? { items: t.items } : { skip: STOP.SKIPPED_NO_LINE };
        }
        var keep = t.items.filter(function (q) {
          if (q.gate && typeof q.gate.min_words === 'number') return read >= q.gate.min_words;
          return q.needs_line == null || q.needs_line <= line;
        });
        return keep.length ? { items: keep } : { skip: STOP.SKIPPED_NO_LINE };
      }
      return { items: t.items };
    }

    function enterTask(resumed, from) {
      skipTo = null;
      var t = task();
      if (!t) { st = { phase: 'battery_end' }; ev('battery_end', { value: { tasks: results.length } }); return; }
      var g = gate(t);
      st = {
        phase: 'instruction', task_id: t.id, resumed: !!resumed, plays: 0, items: g.items || [],
        practice_i: 0, practice_tries: 0,
        item_i: 0, item_started: null, replayed: false, correct: 0, incorrect: 0, attempted: 0, streak: 0, first_line_correct: 0,
        started: null, last_item_index: null, answers: [],
      };
      if (from && from.answers) {
        // An untimed task resumes at the item reached, with what was answered before the reload.
        from.answers.forEach(function (a) { tally(t, a.ok, a.value); st.answers.push(a); });
        st.item_i = from.answers.length;
      }
      ev('task_intro', { task_id: t.id, value: resumed ? { resumed: true } : undefined });
      // A task that records, on a phone with no working microphone, is mic_unavailable before any other reason.
      var noMic = (t.mode === 'record' || t.mode === 'oral') && !gates.mic_ok && mic() === 'no';
      if (g.skip && !noMic) {
        if (g.skip === STOP.SKIPPED_NO_VOICE) ev('no_reading_skip', { task_id: t.id, value: { by: 'app', story: g.story.task_id, voiced_s: g.story.voiced_s, min_s: NO_VOICE_S } });
        st.started = now(); finish(g.skip); return;
      }
      preGates();
    }

    /** The session's once-only screens in front of the task, then its instruction. */
    function preGates() {
      var t = task();
      var records = t.mode === 'record' || t.mode === 'oral';
      if (records) {
        var m = gates.mic_ok ? 'ok' : mic(); // a pass this run counts even where the phone cannot store it
        if (m !== 'ok') {
          if (opts.mic_check && m === 'unknown' && !gates.mic_check) { st.phase = 'mic_check'; return; }
          st.started = now();
          finish(STOP.MIC);
          return;
        }
      }
      if (t.mode === 'oral' && opts.oral_practice && !gates.oral_practice) { st.phase = 'oral_practice'; return; }
      if (t.mode === 'keypad' && opts.keypad_warmup && !gates.keypad_warmup) { st.phase = 'keypad_warmup'; return; }
      st.phase = 'instruction';
    }

    function limitMs(t) { return t.time_limit_s ? t.time_limit_s * 1000 : null; }

    function finish(reason) {
      var t = task();
      if (silenceDue(t, reason)) { silenceReminder(t); return; }
      if (st.cell) closeCell(reason);
      var used = st.started == null ? 0 : Math.round(now() - st.started);
      // The clock as it really ran (a throttled tab, a late time-up): never capped, unlike time_used_ms.
      var elapsed = used;
      var lim = limitMs(t);
      if (lim != null && used > lim) used = lim;
      var phone = t.mode === 'tap' || t.mode === 'keypad' || t.mode === 'keyboard';
      var r = {
        task_id: t.id, legacy_block: t.legacy_block, mode: t.mode, attempted: st.attempted,
        correct: phone ? st.correct : null, incorrect: phone ? st.incorrect : null,
        last_item_index: t.mode === 'record' ? st.last_item_index : (st.attempted ? st.attempted - 1 : null),
        time_used_ms: used, time_left_ms: lim == null ? null : Math.max(0, lim - used),
        stop_reason: reason, scored_on: phone ? 'phone' : 'later', resumed: st.resumed, per_minute: null,
        options_n: t.mode === 'tap' && t.items[0] && t.items[0].options ? t.items[0].options.length : null,
        taps_per_s: warm ? warm.taps_per_s : null,
        elapsed_ms: elapsed,
        answers: st.answers.slice(),
      };
      // the rotation variant this child saw (sa-page.js rotate): its id, null for the passage without rotation, so the
      // scorer marks the text the child read instead of guessing it from the session id
      if (has(t, 'variant_id')) r.variant = t.variant_id;
      if (t.mode === 'record') {
        r.mercy_offered = !!st.mercy;
        r.mercy_ear = st.ear || 'running';
        r.silence_s = st.silence_s == null ? null : st.silence_s;
        r.last_word_index = st.last_item_index;
        var w = st.last_item_index != null ? t.items[st.last_item_index] : null;
        r.last_word_line = w && w.line != null ? w.line : (st.last_item_index != null ? 1 : null);
        if (st.last_word_how) { r.last_word_how = st.last_word_how.how; r.last_word_suggested = st.last_word_how.suggested; }
        if (st.last_word_skipped) r.last_word_skipped = true;
        if (positionOn && t.passage) {
          var heard = voiceEvidence();
          r.voiced_s = heard ? Math.round((st.voice_ticks || 0)) / 10 : null;
          r.position_source = heard ? 'voice' : 'none';
        }
      }
      if (st.cells) r.cells = st.cells.slice();
      if (t.mode === 'oral') r.asked = st.items.map(function (q) { return q.id; });
      if (t.mode === 'oral' && st.rec_marks) { r.rec_section = true; r.rec_marks = st.rec_marks.slice(); }
      // Whether the recorder ever opened for this task (a skip, no mic, or the coach's early end before it: false), so
      // the server waits for audio only where a recording exists.
      if (t.mode === 'record' || t.mode === 'oral') r.recorded = !!st.recorded;
      if (phone && lim != null) {
        // EGRA's per-minute rate: correct × 60 / seconds used (a child who finished early is not penalised).
        r.per_minute = used > 0 ? Math.round((st.correct * 60000 / used) * 10) / 10 : 0;
      }
      var gap = incompleteOn ? notFinished(t, r, st) : null;
      results = results.filter(function (x) { return x.task_id !== t.id; }).concat([r]);
      ev('stop', { task_id: t.id, value: reason });
      ev('task_end', { task_id: t.id, value: r });
      st = { phase: 'task_end', task_id: t.id, result: r };
      if (gap && restOfSection(t).length) {
        ev('incomplete_move_on', { task_id: t.id, value: { by: 'app', section: sectionOf(t), reason: gap.reason, reached: gap.reached, of: gap.of } });
        skipRest(t, STOP.SKIPPED_INCOMPLETE);
      }
    }

    // ---------- round 7b: sections, the move-on when a part is not finished, the silence repeat ----------
    /** A task's section: its id's language prefix (ur | en | ma), or null. */
    function sectionOf(t) { var m = /^([a-z]{2})\./.exec(String((t && t.id) || '')); return m ? m[1] : null; }
    /** The indexes of the tasks after this one in its section. */
    function restOfSection(t) {
      var sec = sectionOf(t);
      var out = [];
      if (!sec) return out;
      for (var k = taskIndex + 1; k < battery.tasks.length && sectionOf(battery.tasks[k]) === sec; k++) out.push(k);
      return out;
    }
    /** Every task after this one in its section ends as `reason` with nothing to score; next() goes on after them. */
    function skipRest(t, reason) {
      var rest = restOfSection(t);
      rest.forEach(function (k) {
        var x = battery.tasks[k];
        var r = {
          task_id: x.id, legacy_block: x.legacy_block, mode: x.mode, attempted: 0, correct: null, incorrect: null,
          last_item_index: null, time_used_ms: 0, time_left_ms: null, stop_reason: reason, scored_on: 'none',
          resumed: false, per_minute: null, options_n: null, taps_per_s: null, elapsed_ms: 0, answers: [],
        };
        results = results.filter(function (y) { return y.task_id !== x.id; }).concat([r]);
        ev('stop', { task_id: x.id, value: reason });
        ev('task_end', { task_id: x.id, value: r });
      });
      if (rest.length) skipTo = rest[rest.length - 1];
    }
    /**
     * sa_incomplete_move_on: why the part on show was not finished, from what the phone knows — { reason, reached, of },
     * or null when it was finished or ended by something else (the coach, no microphone, a picture, a skip).
     */
    function notFinished(t, r, s) {
      var why = r.stop_reason;
      var of = t.mode === 'record' ? (s.cells ? cellsOf(t).length : t.items.length) : (s.items || []).length;
      if (!of) return null;
      if (why === STOP.FIRST_LINE || why === STOP.CONSECUTIVE) return { reason: 'stop_rule', reached: r.attempted, of: of };
      if (t.mode === 'record' && why === STOP.SILENCE) return { reason: 'silence', reached: null, of: of };
      if (why !== STOP.COMPLETE && why !== STOP.TIME_UP) return null;
      // round 8 (r8_timeup_continue): the part's own clock ran out: that part is done, the subject goes on
      if (why === STOP.TIME_UP && timeupGoesOn) return null;
      // round 8 (r8_reading_position): the story's time-up never skips its questions; the voice heard decides them
      if (why === STOP.TIME_UP && positionOn && t.passage && r.last_word_skipped) return null;
      if (t.mode === 'tap' || t.mode === 'keypad' || t.mode === 'keyboard') {
        return why === STOP.TIME_UP && r.attempted < of ? { reason: 'time_up', reached: r.attempted, of: of } : null;
      }
      if (t.mode === 'oral') {
        var unanswered = s.oral_timeouts || 0;
        return why === STOP.TIME_UP || unanswered ? { reason: 'time_up', reached: Math.max(0, r.attempted - unanswered), of: of } : null;
      }
      if (t.mode !== 'record') return null;
      if (s.cells) {
        var moved = s.cells.filter(function (c) { return c.how === 'tap' || c.how === 'auto'; });
        if (moved.some(function (c) { return c.i === of - 1; })) return null;
        return { reason: why === STOP.TIME_UP ? 'time_up' : 'stopped_early', reached: moved.length, of: of };
      }
      if (r.last_word_skipped) return why === STOP.TIME_UP ? { reason: 'time_up', reached: null, of: of } : null;
      var at = r.last_word_index;
      if (at != null && at >= of - 1) return null;
      return { reason: why === STOP.TIME_UP ? 'time_up' : 'last_word_early', reached: at == null ? 0 : at + 1, of: of };
    }
    /** A spoken part that ran its recording with the ear listening and heard no voice, not yet repeated. */
    function silenceDue(t, reason) {
      // read-aloud parts only: there the recorder's watch tells a sleeping ear from a silent child (ear_unavailable)
      if (!silenceRepeatOn || !t || t.mode !== 'record') return false;
      if ([STOP.COMPLETE, STOP.TIME_UP, STOP.SILENCE].indexOf(reason) < 0) return false;
      if (!st.recorded || st.heard || st.ear === 'unavailable') return false;
      return !(gates.silence_repeated && gates.silence_repeated[t.id]);
    }
    function silenceReminder(t) {
      gates.silence_repeated = gates.silence_repeated || {};
      gates.silence_repeated[t.id] = true;
      ev('silence_repeat', { task_id: t.id, value: { by: 'app', attempt: 1 } });
      st = { phase: 'silence_reminder', task_id: t.id };
    }

    // ---------- round 8: how much the child read aloud on the passage (r8_reading_position) ----------
    /** Whether the voice count can be trusted: the recording opened, an ear listened, and it was never unavailable. */
    function voiceEvidence() {
      if (!st.recorded || st.ear === 'unavailable') return false;
      if (st.ear_fn) { try { if (st.ear_fn() !== 'running') return false; } catch (_) { return false; } }
      return !!st.voice_watch || silenceRepeatOn;
    }
    /** The passage's result says the child read nothing aloud (evidence only: no count, no skip). */
    function readNothing(r) { return typeof r.voiced_s === 'number' && r.voiced_s < NO_VOICE_S; }

    /** A task passed over with the sandbox's "Jump to…": a result with nothing to score. */
    function skipDev(t) {
      var r = {
        task_id: t.id, legacy_block: t.legacy_block, mode: t.mode, attempted: 0, correct: null, incorrect: null,
        last_item_index: null, time_used_ms: 0, time_left_ms: null, stop_reason: STOP.DEV, scored_on: 'none',
        resumed: false, per_minute: null, options_n: null, taps_per_s: null, elapsed_ms: 0, answers: [],
      };
      results = results.filter(function (x) { return x.task_id !== t.id; }).concat([r]);
      ev('stop', { task_id: t.id, value: STOP.DEV });
      ev('task_end', { task_id: t.id, value: r });
    }

    function stopRule(t) {
      var s = t.stop;
      if (s.first_line_n && st.attempted === s.first_line_n && st.first_line_correct < s.first_line_min_correct) return STOP.FIRST_LINE;
      if (s.consecutive_errors && st.streak >= s.consecutive_errors) return STOP.CONSECUTIVE;
      if (st.item_i >= st.items.length) return STOP.COMPLETE;
      return null;
    }

    function tally(t, ok) {
      st.attempted++;
      if (ok) { st.correct++; st.streak = 0; } else if (ok === false) { st.incorrect++; st.streak++; }
      if (ok && t.stop.first_line_n && st.attempted <= t.stop.first_line_n) st.first_line_correct++;
    }

    function score(it, value) {
      var t = task();
      var ok = t.mode === 'oral' ? null : (value === 'timeout' || value === 'skipped' ? false : hit(it, value, t.mode));
      tally(t, ok);
      var a = { item_id: it.id, value: value, ok: ok };
      if (oneAtATime && st.item_started != null) a.ms = Math.round(now() - st.item_started);
      if (st.rec_marks) {
        var at = function (x) { return Math.max(0, Math.round(x - st.rec_t0)); };
        st.rec_marks.push({ item_id: it.id, ask_ms: at(st.ask_at), answer_ms: at(st.answer_at != null ? st.answer_at : st.ask_at), end_ms: at(now()) });
      }
      st.answers.push(a);
      ev(ok === null ? 'answer' : (ok ? 'item_correct' : 'item_incorrect'), { task_id: t.id, item_id: it.id, value: value });
      st.item_i++;
      st.item_started = now();
      st.ask_at = st.item_started;
      st.answer_at = null;
      st.replayed = false;
      var stop = stopRule(t);
      if (stop) finish(stop);
      return ok;
    }

    var api = {
      STOP: STOP,
      /** The battery intro → the audio check, the warm-up (the page runs them) or the first task. */
      start: function () {
        if (st.phase !== 'battery_intro') return;
        var sv = { battery_id: battery.battery_id || null, tasks: battery.tasks.length };
        if (manual) sv.admin_mode = 'manual';
        ev(resume ? 'reload_resume' : 'session_start', { value: sv });
        if (resume && taskIndex < battery.tasks.length) {
          var t = battery.tasks[taskIndex];
          var part = resume.current && resume.current.task_id === t.id ? resume.current : null;
          // A timed task the tab died in runs again from its start; an untimed one goes on from the item reached.
          enterTask(!!part || !resultOf(t.id), !t.time_limit_s ? part : null);
        } else if (!resume && opts.audio_check) {
          st = { phase: 'audio_check', tries: 0 };
        } else if (!resume && opts.warmup) {
          st = { phase: 'warmup' };
        } else {
          enterTask(false);
        }
      },
      /** The audio check's answer: heard=true moves on; false stays (the page says "check the headphones"). */
      audioCheck: function (heard) {
        if (st.phase !== 'audio_check') return;
        st.tries++;
        ev('audio_check', { value: { heard: !!heard, tries: st.tries } });
        if (!heard) return;
        if (opts.warmup) st = { phase: 'warmup' }; else enterTask(false);
      },
      /** The tap warm-up (Tangerine's bubbles): taps and the ms it took → taps per second, kept on every result. */
      warmupDone: function (taps, ms) {
        if (st.phase !== 'warmup') return;
        warm = { taps: taps, ms: Math.round(ms), taps_per_s: ms > 0 ? Math.round(taps * 100000 / ms) / 100 : null };
        ev('warmup_result', { value: warm });
        enterTask(false);
      },
      /** The game's mic check: ok (heard back, level above the floor) and the level measured. */
      micChecked: function (ok, rms) {
        if (st.phase !== 'mic_check') return;
        gates.mic_check = true;
        gates.mic_ok = !!ok;
        ev('mic_check', { value: { ok: !!ok, rms: typeof rms === 'number' ? rms : null } });
        if (ok) preGates(); else { st.started = now(); finish(STOP.MIC); }
      },
      /** The practice spoken question ("I heard you"): heard = the meter moved. */
      oralPracticeDone: function (heard) {
        if (st.phase !== 'oral_practice') return;
        gates.oral_practice = true;
        ev('oral_practice', { value: { heard: !!heard } });
        preGates();
      },
      /** The keypad warm-up (20 s of free typing, a Done tile): keys pressed. */
      keypadWarmupDone: function (keys) {
        if (st.phase !== 'keypad_warmup') return;
        gates.keypad_warmup = true;
        ev('keypad_warmup', { value: { keys: keys | 0 } });
        preGates();
      },
      /** The page was hidden (another app, the screen off): logged; a timed task in progress runs again from its start. */
      visibilityLost: function () {
        var t = task();
        ev('visibility_lost', { task_id: st.task_id || undefined, value: { phase: st.phase } });
        if (st.phase === 'running' && t && t.time_limit_s) enterTask(true);
      },
      /** sa_cell_pace: the mic heard the child on the cell on show (the 3-s wait starts again). */
      voice: function () {
        if (st.phase !== 'running') return;
        st.heard = true; // round 7b: sa_silence_repeat reads it
        if (st.cell) st.cell.voice_at = now();
        // round 8 (r8_reading_position): the passage's voiced ticks; a report within 2.5 ticks of the last goes on its run
        if (positionOn && task().passage) {
          var tn = now();
          st.voice_ticks = (st.voice_ticks || 0) + (st.voice_at != null && tn - st.voice_at <= VOICE_TICK_MS * 2.5 ? 1 : VOICE_RUN_TICKS);
          st.voice_at = tn;
        }
      },
      /**
       * Round 8 (r8_reading_position): the recorder's ear is now listening for a voice on the part on show (onVoice), so
       * a passage with no voice() is a silent child, not a deaf phone. ear: optional, () → 'running' | 'unavailable' | null
       * (the recorder's ear state), read when the passage ends; anything but 'running' is no evidence.
       */
      voiceWatch: function (ear) {
        if (st.phase !== 'running') return;
        st.voice_watch = true;
        if (typeof ear === 'function') st.ear_fn = ear;
      },
      /** The mercy rule: Jugnu offered the star (12 s of no voice on the passage). */
      mercyOffered: function () {
        if (st.phase !== 'running' || task().mode !== 'record' || st.mercy || holdsCell(task())) return;
        st.mercy = true;
        ev('mercy_offered', { task_id: st.task_id });
      },
      /** The recorder could not listen (the phone's audio engine asleep): no mercy, no silence stop; the result says so. */
      earUnavailable: function () {
        if (st.phase !== 'running' || task().mode !== 'record') return;
        st.ear = 'unavailable';
        ev('ear_unavailable', { task_id: st.task_id });
      },
      /** No voice for the whole window (20 s): the passage ends as early_stop_silence, no last word asked. */
      silence: function (seconds) {
        if (st.phase !== 'running' || task().mode !== 'record' || holdsCell(task())) return;
        st.silence_s = typeof seconds === 'number' ? seconds : null;
        finish(STOP.SILENCE);
      },
      /** The instruction was played (again). */
      instructionPlayed: function () {
        if (st.phase !== 'instruction') return;
        ev(st.plays ? 'instruction_replay' : 'instruction_play', { task_id: st.task_id });
        st.plays++;
      },
      /** The child is past the instruction → practice, or straight to ready when the task has none. */
      instructionDone: function () {
        if (st.phase !== 'instruction') return;
        st.phase = task().practice.length ? 'practice' : 'ready';
      },
      /** A practice answer: { ok, retry, shown, feedback } — retry once on a wrong answer, then the right one is shown. */
      practiceAnswer: function (value) {
        if (st.phase !== 'practice') return null;
        var p = task().practice[st.practice_i];
        var ok = hit(p, value, task().mode);
        st.practice_tries++;
        var retry = !ok && st.practice_tries < 2;
        ev('practice_answer', { task_id: st.task_id, item_id: p.id, value: { value: value, ok: ok, try: st.practice_tries } });
        if (!retry) { st.practice_i++; st.practice_tries = 0; }
        if (st.practice_i >= task().practice.length) st.phase = 'ready';
        return { ok: ok, retry: retry, shown: !ok && !retry ? p.target : null, feedback: p.feedback || null };
      },
      /** "Go!": the clock starts (timed tasks) and the first item shows. */
      begin: function () {
        if (st.phase !== 'ready') return;
        st.phase = 'running';
        st.started = now();
        st.item_started = st.started;
        st.ask_at = st.started;
        st.answer_at = null;
        if (cellTask(task())) { st.cells = []; st.cell = { i: 0, at: st.started }; }
        ev('task_start', { task_id: st.task_id, value: { time_limit_s: task().time_limit_s || null, mode: task().mode, items: st.items.length } });
      },
      /** An answer to the current item: a tile, the typed number (keypad) or 'spoken' (oral). true/false/null. */
      answer: function (value) {
        var t = task();
        if (st.phase !== 'running' || t.mode === 'record') return undefined;
        var it = st.items[st.item_i];
        ev(t.mode === 'keypad' || t.mode === 'keyboard' ? t.mode + '_submit' : 'tap', { task_id: st.task_id, item_id: it.id, value: value });
        return score(it, value);
      },
      /** Jugnu finished asking (a spoken question, a word problem): the item's answer time starts now. */
      promptDone: function () {
        if (st.phase !== 'running' || task().mode === 'record') return;
        st.item_started = now();
        st.answer_at = st.item_started;
      },
      /** "Next" on an untimed item the child cannot answer (offered after next_at_s): no response = wrong. */
      skip: function () {
        var t = task();
        if (st.phase !== 'running' || t.mode === 'record') return undefined;
        return score(st.items[st.item_i], t.mode === 'oral' ? 'skipped' : 'skipped');
      },
      /** One at a time: the cell on show is passed (how: 'tap', or 'auto' when the page moves it on). */
      nextCell: function (how) { nextCell(how === 'auto' ? 'auto' : 'tap'); },
      /** sa_cell_next_only: the task on show is a letter/word cell that waits for Next (no silence stop for it). */
      holdsCell: function () { return holdsCell(task()); },
      /** The passage: "I'm done" (or time up) → the child taps the last word read. */
      done: function () {
        if (st.phase !== 'running' || task().mode !== 'record') return;
        ev('reading_done', { task_id: st.task_id });
        if (task().items.length && skipLW) { st.last_word_skipped = true; finish(STOP.COMPLETE); } else if (task().items.length) st.phase = 'last_word'; else finish(STOP.COMPLETE);
      },
      /** The last word read (index into the passage's words). */
      lastWord: function (index, how) {
        if (st.phase !== 'last_word') return;
        st.last_item_index = typeof index === 'number' && index >= 0 ? index : null;
        // sa_coach_last_word: the coach confirmed the word found in the recording, or tapped another one.
        if (how && how.how) st.last_word_how = { how: how.how, suggested: typeof how.suggested === 'number' ? how.suggested : null };
        ev('last_word_tap', { task_id: st.task_id, item_id: index != null && task().items[index] ? task().items[index].id : null, value: index });
        finish(st.time_up ? STOP.TIME_UP : STOP.COMPLETE);
      },
      /** Call on every animation tick: the time limit, the replay and the per-item timeout. Returns 'replay' when due. */
      tick: function () {
        if (st.phase !== 'running') return null;
        var t = task();
        var lim = limitMs(t);
        if (lim != null && now() - st.started >= lim) {
          // One at a time: the cell reached is the last item (no passage to tap a last word on).
          if (st.cell) { finish(STOP.TIME_UP); return null; }
          if (t.mode === 'record') {
            st.time_up = true; st.used_at_stop = now(); ev('reading_done', { task_id: t.id, value: 'time_up' });
            if (t.items.length && skipLW) st.last_word_skipped = true;
            if (t.items.length && !skipLW) st.phase = 'last_word'; else finish(STOP.TIME_UP);
            return null;
          }
          finish(STOP.TIME_UP);
          return null;
        }
        if (st.cell) {
          var auto = t.cell_auto_s;
          if (manual || !auto || holdsCell(t)) return null;
          if (cellPace) {
            // EGRA: move on when the child has not responded for 3 s, so the wait counts from the last voice heard.
            // A noisy room never goes quiet: the cap moves the item on at 10 s on screen.
            var shown = now() - st.cell.at;
            var quiet = now() - (st.cell.voice_at != null ? st.cell.voice_at : st.cell.at);
            if (shown < CELL_PACE_CAP_S * 1000 && (shown < Math.max(auto, CELL_PACE_FLOOR_S) * 1000 || quiet < auto * 1000)) return null;
          } else if (now() - st.cell.at < auto * 1000) return null;
          nextCell('auto');
          return st.phase === 'running' ? 'go_on' : null;
        }
        if (t.mode === 'record') return null;
        var waited = now() - st.item_started;
        var tmo = itemTimeoutS(t);
        if (tmo && waited >= tmo * 1000) {
          // sa_incomplete_move_on: a spoken question that ran out of time was left unanswered (its answer reads 'spoken')
          if (incompleteOn && t.mode === 'oral') st.oral_timeouts = (st.oral_timeouts || 0) + 1;
          score(st.items[st.item_i], t.mode === 'oral' ? 'spoken' : 'timeout');
          return null;
        }
        if (t.replay_at_s && !st.replayed && waited >= t.replay_at_s * 1000) {
          st.replayed = true;
          ev('replay', { task_id: t.id, item_id: st.items[st.item_i].id, value: 'auto' });
          return 'replay';
        }
        return null;
      },
      /** The coach's unlock ended the task (proctored). */
      coachEnd: function () {
        if (['running', 'instruction', 'practice', 'ready', 'last_word'].indexOf(st.phase) < 0) return;
        if (st.started == null) st.started = now();
        ev('coach_unlock', { task_id: st.task_id });
        finish(STOP.COACH_END);
      },
      /**
       * sa_back_button (round 7b): the item (or the one-at-a-time cell) before this one shows again, and the child's new
       * answer replaces the old one. by: 'child' | 'coach' (coach-led). Only while a task runs, never on its first item,
       * never on the passage (one screen) and never into another task; the task's clock keeps running. A cell: its earlier
       * pass is dropped (cells keep one pass each, so the cells reached stay right). An item: its answer, its counts and
       * (one recording for the section) its mark are undone. One `back` event { by, from, to }. → true when it went back.
       */
      back: function (by) {
        var t = task();
        if (!backOn || st.phase !== 'running' || !t) return false;
        var who = by === 'coach' ? 'coach' : 'child';
        if (st.cell) {
          var i = st.cell.i;
          if (i <= 0) return false;
          st.cells = st.cells.filter(function (c) { return c.i !== i - 1; });
          st.last_item_index = st.cells.length ? st.cells[st.cells.length - 1].i : null;
          st.cell = { i: i - 1, at: now() };
          ev('back', { task_id: t.id, value: { by: who, from: i, to: i - 1 } });
          return true;
        }
        if (t.mode === 'record' || st.item_i <= 0 || !st.answers.length) return false;
        var from = st.item_i;
        st.answers.pop();
        if (st.rec_marks && st.rec_marks.length) st.rec_marks.pop();
        st.attempted = 0; st.correct = 0; st.incorrect = 0; st.streak = 0; st.first_line_correct = 0;
        st.answers.forEach(function (a) { tally(t, a.ok); });
        st.item_i = st.answers.length;
        st.item_started = now();
        st.ask_at = st.item_started;
        st.answer_at = null;
        st.replayed = false;
        ev('back', { task_id: t.id, item_id: st.items[st.item_i] ? st.items[st.item_i].id : undefined, value: { by: who, from: from, to: st.item_i } });
        return true;
      },
      /** A picture of this task would not load (the page's <img> error): image_unavailable, the task ends as
       *  assets_unavailable. A late error from another task's picture is ignored. */
      imageUnavailable: function (taskId, itemId) {
        if (taskId !== st.task_id || ['running', 'instruction', 'practice', 'ready'].indexOf(st.phase) < 0) return;
        if (st.started == null) st.started = now();
        ev('image_unavailable', { task_id: st.task_id, item_id: itemId == null ? null : itemId });
        finish(STOP.ASSETS);
      },
      /** After the task-end screen: the next task (after any a round 7b skip passed over). */
      next: function () {
        if (st.phase !== 'task_end') return;
        taskIndex = (skipTo != null ? skipTo : taskIndex) + 1;
        enterTask(false);
      },
      /**
       * Round 7b (sa_end_section, RDF manual): the coach ends the section. The task on show ends as end_section (on its
       * end screen: nothing to end), and the rest of its section is skipped. → true when it acted.
       */
      endSection: function () {
        var ph = ['running', 'instruction', 'practice', 'ready', 'last_word', 'oral_practice', 'keypad_warmup', 'mic_check', 'task_end'];
        if (!endSectionOn || ph.indexOf(st.phase) < 0 || !task()) return false;
        var t = task();
        ev('end_section', { task_id: t.id, value: { by: 'coach', section: sectionOf(t) } });
        if (st.phase !== 'task_end') {
          if (st.started == null) st.started = now();
          finish(STOP.END_SECTION);
        }
        skipRest(t, STOP.SKIPPED_END_SECTION);
        return true;
      },
      /** Round 7b (sa_silence_repeat): after the reminder, the silent part again from its start. */
      silenceRepeatDone: function () {
        if (st.phase !== 'silence_reminder') return;
        enterTask(false);
      },
      /** A surface's own event (handover_in, offline, sync_ok …) in the same numbered log. */
      log: function (type, extra) { return ev(type, extra); },
      /** What the page draws. */
      view: function () {
        var t = task();
        var v = { phase: st.phase, task_index: taskIndex, tasks: battery.tasks.length, task: st.phase === 'battery_end' ? null : t };
        if (opts.dev_tools) v.dev_tasks = battery.tasks.map(function (x, i) { return { index: i, id: x.id, title: x.title || null }; });
        if (st.phase === 'practice') v.practice = t.practice[st.practice_i];
        if (st.phase === 'running' || st.phase === 'last_word') {
          var lim = limitMs(t);
          v.time_left_ms = lim == null ? null : Math.max(0, lim - (now() - st.started));
          v.item = t.mode === 'record' ? null : st.items[st.item_i];
          v.item_index = st.item_i;
          v.items_n = st.items.length;
          if (st.cell) {
            var cells = cellsOf(t);
            v.cell = String(cells[st.cell.i]); v.cell_index = st.cell.i; v.cells_n = cells.length;
            v.cell_item = t.items[st.cell.i] || null;
          }
          if (t.mode !== 'record' && st.item_started != null) {
            var waited = now() - st.item_started;
            v.item_wait_ms = waited;
            v.offer_next = !!(t.next_at_s && waited >= t.next_at_s * 1000);
          }
        }
        if (st.phase === 'task_end') v.result = st.result;
        if (st.phase === 'audio_check') v.tries = st.tries;
        return v;
      },
      results: function () { return results.slice(); },
      /** What a reload needs: write it with every event. */
      snapshot: function () {
        var cur = st.phase === 'running' && task() && !task().time_limit_s ? { task_id: st.task_id, answers: st.answers.slice() } : null;
        return {
          task_index: st.phase === 'task_end' ? (skipTo != null ? skipTo : taskIndex) + 1 : taskIndex, results: results.slice(), seq: seq,
          t_ms: Math.round(now() - t0), ended: st.phase === 'battery_end', warmup: warm, current: cur, gates: gates,
        };
      },
    };
    if (opts.dev_tools) {
      /**
       * Sandbox only (the page passes dev_tools when the server injected SA_DEV_TOOLS): start task i at its
       * instruction. The task under way and every task passed over that has no result end as skipped_dev; finished
       * tasks keep their scores; the chosen task's old result goes (it runs again). → false for a bad index.
       */
      api.jumpTo = function (i) {
        if (typeof i !== 'number' || i % 1 !== 0 || i < 0 || i >= battery.tasks.length) return false;
        var from = taskIndex;
        var under = st.phase !== 'task_end' && st.phase !== 'battery_end' && st.task_id ? task() : null;
        ev('dev_jump', { value: { from: from, to: i } });
        if (under && under.id !== battery.tasks[i].id) skipDev(under);
        for (var k = 0; k < i; k++) {
          var t = battery.tasks[k];
          if (k >= from && !resultOf(t.id)) skipDev(t);
        }
        results = results.filter(function (x) { return x.task_id !== battery.tasks[i].id; });
        taskIndex = i;
        enterTask(false);
        return true;
      };
    }
    return api;
  }

  return { STOP: STOP, MODE_BY_SUBTASK: MODE_BY_SUBTASK, normalize: normalize, validate: validate, createRunner: createRunner };
}));
