'use strict';
/**
 * bd-pni007 — three FDE (obs612) visits as their coaching_sessions.analysis_data, built through the real record
 * (observe/obs612/record.js buildAnalysis), so every reader's test uses the shape the endpoint stores.
 *
 *   enur()  English & Urdu tool, sheet en: 109 / 148 · 73.6% · Proficient. Strongest D. Interest & Motivation 8/8,
 *           lowest C. Reading Skills 4/8. Section 8 feedback written.
 *   msci()  Maths & Science tool: levels i3, i4 at 3 … i9 at 0; 5-student check Level 2 (3-4 of 5); a plan on i9.
 *   gen()   General form: Yes on 29 of 35; STUDENT ASSESSMENT PROCESS 0 of 2; one feedback line.
 */

const O = require('../../bot/shared/services/coaching/frameworks/obs612');
const { buildAnalysis } = require('../../bot/shared/services/observe/obs612/record');

const NOW = Date.parse('2026-11-11T09:30:00Z');
const COACH_ID = 'coach-fde-1';
const TEACHER_ID = 'teacher-fde-1';

function form(rubricVersion, visitContext, extra = {}) {
  return {
    id: 'form-fde-1', rubric_version: rubricVersion, visit_context: { via: 'observe', ...visitContext },
    observer_user_id: COACH_ID, teacher_user_id: TEACHER_ID, ...extra,
  };
}

function enurDraft(over = {}) {
  const d = {};
  for (const i of O.requiredItems('obs612-enur-v1', 'en')) d[i.key] = '3';
  Object.assign(d, {
    s3d_1: '4', s3d_2: '4', // D. Interest & Motivation 8/8
    s4c_1: '2', s4c_2: '2', // C. Reading Skills 4/8
    s5_3: '2', s6_2: '2',
    ctx_6: 'The Last Lesson', ctx_7: 'Reading',
    fb_strengths: 'Clear objectives and a warm tone with every student.',
    fb_areas: 'Checking reading comprehension during the lesson.',
    fb_recommendations: 'Ask two why-questions after each paragraph.',
    fb_timeline: 'Next two weeks',
  });
  return { ...d, ...over };
}

function enur({ sheet = 'en', over = {}, teacher = true } = {}) {
  const extra = teacher ? {} : { teacher_user_id: null };
  const subject = sheet === 'ur' ? 'urdu' : 'english';
  return buildAnalysis(form('obs612-enur-v1', { grade: 7, subject, sheet }, extra), enurDraft(over), { now: NOW });
}

const MSCI_LEVELS = { i1: 2, i2: 2, i3: 3, i4: 3, i5: 1, i6: 2, i7: 2, i8: 1, i9: 0, i10: 1, i11: 2 };

function msci(over = {}) {
  const d = Object.fromEntries(Object.entries(MSCI_LEVELS).map(([k, v]) => [k, String(v)]));
  Object.assign(d, {
    students: '2',
    obs_i9: 'The bell rang mid-example; no summary, no homework.',
    dp_area: 'i9', dp_goal: '1', dp_action: 'Close with a two-minute summary and homework on the board.',
  }, over);
  return buildAnalysis(form('obs612-msci-v1', { grade: 7, subject: 'maths' }), d, { now: NOW });
}

const GEN_NO = ['assessment_1', 'assessment_2', 'delivery_5', 'delivery_7', 'management_9', 'command_6'];

function gen(over = {}) {
  const d = {};
  for (const i of O.requiredItems('obs612-gen-v1', null)) d[i.key] = GEN_NO.includes(i.key) ? 'no' : 'yes';
  Object.assign(d, { fb_line: 'A good start: add pair work, and check answers at the end.' }, over);
  return buildAnalysis(form('obs612-gen-v1', { grade: 10, subject: 'social_studies' }), d, { now: NOW });
}

/** The coaching_sessions row an FDE visit writes. */
function sessionRow(analysis, over = {}) {
  return {
    id: 'sess-fde-1', created_at: '2026-11-11T09:31:00Z', observation_type: 'leader_observation',
    status: 'observer_review_complete', framework: analysis.framework, observer_user_id: COACH_ID,
    user_id: TEACHER_ID, debrief_status: 'pending', analysis_data: analysis, ...over,
  };
}

module.exports = { enur, msci, gen, sessionRow, NOW, COACH_ID, TEACHER_ID, MSCI_LEVELS, GEN_NO };
