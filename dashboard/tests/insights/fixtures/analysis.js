'use strict';
/**
 * Fictional analysis_data builders for the COACHIP job tests, shaped like prod v3 (lp_fidelity from the gemini grader,
 * FICO v3 domains, 1-4) and sandbox v4 (26 indicators, 0-2). No real text: every string is a placeholder.
 */

function move(id, phase, verdict, opts = {}) {
  const at = opts.at;
  return {
    move_id: id,
    phase,
    text: opts.text || `Plan step ${id}`,
    bucket: opts.bucket || 'must_happen',
    selection: 'core',
    verdict,
    credit: opts.credit != null ? opts.credit : (verdict === 'executed' ? 1 : verdict === 'partial' ? 0.5 : 0),
    counted: opts.counted !== undefined ? opts.counted : true,
    evidence: at ? `[${at}] placeholder quote` : '',
    evidence_translation: 'placeholder translation',
    rationale: 'placeholder rationale',
    ...(opts.tot ? { time_on_task: { move_id: id, assigned: false, on_task_band: null, ...opts.tot } } : {}),
  };
}

function lp(moves, opts = {}) {
  return {
    status: opts.status || 'ok',
    model: opts.model === undefined ? 'google/gemini-3.8-flash' : opts.model,
    band: 'partial',
    fidelity_pct: 50,
    moderators: { note: opts.note || '' },
    recording_unusable: opts.unusable === undefined ? false : opts.unusable,
    recording: {
      stamps: 100,
      audio_s: opts.audio_s != null ? opts.audio_s : 1200,
      ends_at: opts.ends_at || '20:00',
      last_stamp_s: opts.last_stamp_s != null ? opts.last_stamp_s : 1190,
      no_timestamps: !!opts.no_timestamps,
      collapsed_block: false,
      transcript_short_of_audio: !!opts.short,
    },
    meta: { grade: opts.grade || '3', subject: opts.subject || 'maths', template: 'STANDARD', lesson_id: 'fictional_lesson' },
    narrative: 'placeholder narrative',
    moves,
  };
}

const V3_IDS = {
  lesson_plan_fidelity: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'],
  high_leverage_practices: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'],
  student_engagement: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
  teacher_subject_knowledge: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'],
};
const V4_IDS = {
  lesson_plan_fidelity: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'],
  high_leverage_practices: ['C1', 'C2', 'C3', 'C4'],
  student_engagement: ['D1', 'D2', 'D3', 'D4', 'D5'],
  teacher_subject_knowledge: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'],
};

function domains(ids, scale, scores = {}, tskMax) {
  const out = {};
  for (const [key, list] of Object.entries(ids)) {
    out[key] = {
      domain_max: key === 'teacher_subject_knowledge' && tskMax ? tskMax : list.length * scale,
      domain_score: 1,
      indicators_applicable: list.length,
      indicators: list.map((id) => ({
        id, name: `Indicator ${id}`, score: scores[id] != null ? scores[id] : Math.min(scale, 3),
        applicable: true, timestamp: '05:10', evidence: 'placeholder', evidence_summary: 'placeholder',
      })),
    };
  }
  return out;
}

function v3(scores, extra = {}) {
  return { framework: 'fico', domains: domains(V3_IDS, 4, scores, 24), ...extra };
}
function v4(scores, extra = {}) {
  return { framework: 'fico', domains: domains(V4_IDS, 2, scores, 20), ...extra };
}
function v2(scores) {
  const d = domains(V3_IDS, 4, scores, 32);
  for (const k of Object.keys(d)) { delete d[k].indicators_applicable; for (const i of d[k].indicators) delete i.applicable; }
  return { framework: 'fico', domains: d };
}
function fico17(scores) {
  return { ...v3(scores), observe2: { rubric: 'fico17' } };
}
function generic() {
  return { framework: 'generic', domains: { a: { domain_max: 10, indicators: [] }, b: { domain_max: 10, indicators: [] } } };
}

/** Every key the pipeline must never read, populated so a Proxy can catch any read. */
function withForbidden(ad) {
  return {
    ...ad,
    executive_summary: 'x', report_narrative: 'x', voice_debrief_script: 'x',
    teacher_delivery: { teacher_name: 'x', teacher_phone: 'x' },
    notable_moments: [{ named_student: 'x', what_happened: 'x' }],
    focus_area: { title: 'x' }, strengths: ['x'], growth_opportunities: ['x'], recommendations: ['x'],
    observer_debrief: { x: 1 }, uptake: { x: 1 }, scores: { overall_marks: 1 },
  };
}

const FORBIDDEN_TOP = ['executive_summary', 'report_narrative', 'voice_debrief_script', 'teacher_delivery', 'notable_moments',
  'focus_area', 'strengths', 'growth_opportunities', 'recommendations', 'observer_debrief', 'uptake', 'scores'];

/** Wraps an object so any read of a forbidden key (at any depth) throws. */
function trap(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return new Proxy(obj, {
    get(target, prop, recv) {
      if (typeof prop === 'string' && FORBIDDEN_TOP.includes(prop)) throw new Error(`forbidden key read: ${prop}`);
      if (prop === 'evidence_summary') throw new Error('forbidden key read: evidence_summary');
      return trap(Reflect.get(target, prop, recv));
    },
  });
}

module.exports = { move, lp, v3, v4, v2, fico17, generic, withForbidden, trap, FORBIDDEN_TOP, V3_IDS, V4_IDS };
