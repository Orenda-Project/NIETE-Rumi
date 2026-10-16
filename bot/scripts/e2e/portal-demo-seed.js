#!/usr/bin/env node
/* portal-demo-seed.js — a made-up school network for the LOCAL teacher + coach portal (bd-hnhlgn).
 *
 *   node bot/scripts/e2e/portal-demo-seed.js > demo.sql      (local-db.sh demo-seed <run_dir> pipes it to psql)
 *
 * The mock lane's seed is reference content only (training + LP catalogues, settings) — no people — so a
 * local portal logs in to empty screens. This prints SQL that adds, to ONE run database:
 *   3 schools · 1 coach linked to all three · 1 principal · 9 teachers (3 per school)
 *   per teacher: a class with 8 students + a week of attendance, 4 lesson plans, LP opens, 3 scored FICO
 *   self-observations, a training assignment with progress
 *   for the coach: upcoming + done visits, and leader observations in each pipeline stage
 *   the portal_* app_settings switched on for everyone, so the v2 teacher and coach screens show.
 *
 * Every row is generated here — names, schools, scores, text. Nothing is read from the sandbox or prod, so
 * the output is safe to commit, share and re-run. Ids are derived from a fixed key (md5 → uuid) and the
 * script deletes its own ids before inserting, so running it twice leaves the same rows. Phones sit in the
 * 9230000009NN block (the QA convention: 923000000001, …). Reference ids (academic session, training
 * program, modules) are looked up in SQL, so it follows whatever seed the run was cloned from.
 */
const crypto = require('crypto');

const PASSWORD = 'Demo2026';
// bcrypt(PASSWORD, 10) — fixed so the output is deterministic and needs no bcrypt module.
const PASSWORD_HASH = '$2a$10$BVuCPZHmvwsmYFSiQu2Z.ulqhWuKgM6ebLzhH6wBHDGrXCbyZo1Uy';
const PHONE_PREFIX = '9230000009';
const SOURCE = 'portal_demo_seed';

const uid = (key) => {
  const h = crypto.createHash('md5').update(`niete-portal-demo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Deterministic PRNG so scores/attendance are the same on every machine.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (v && v.sql) return v.sql;                               // raw SQL expression
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const raw = (sql) => ({ sql });
const daysAgo = (n, hour = 9) => raw(`(date_trunc('day', now()) - interval '${n} days' + interval '${hour} hours')`);
const dateIn = (n) => raw(`(current_date + ${n})`);

const SCHOOLS = [
  { key: 'school-1', emis: 'DEMO-001', name: 'Demo Model School G-6/2', region: 'Urban-I' },
  { key: 'school-2', emis: 'DEMO-002', name: 'Demo Girls School I-8/4', region: 'Urban-I' },
  { key: 'school-3', emis: 'DEMO-003', name: 'Demo Boys School Sihala', region: 'Sihala' },
  // never played for on a run: the school league's ghost card (WQ066). Keep every scenario before it off SC4ABC.
  { key: 'school-4', emis: 'DEMO-004', name: 'Demo Hill School Bhara Kahu', region: 'Bhara Kahu' },
];
const TEACHERS = [
  ['Ayesha Siddiqui', 'school-1', 3, 'english'], ['Bilal Ahmed', 'school-1', 5, 'maths'], ['Sana Javed', 'school-1', 4, 'science'],
  ['Fatima Noor', 'school-2', 2, 'urdu'], ['Hina Rauf', 'school-2', 5, 'english'], ['Maryam Iqbal', 'school-2', 1, 'maths'],
  ['Usman Tariq', 'school-3', 4, 'social_studies'], ['Kamran Ali', 'school-3', 3, 'science'], ['Zainab Hussain', 'school-3', 2, 'english'],
  ['Nadia Hill', 'school-4', 3, 'science'],
];
const COACH = { name: 'Demo Coach Rabia Khan', phone: `${PHONE_PREFIX}01` };
const PRINCIPAL = { name: 'Demo Principal Tariq Mehmood', phone: `${PHONE_PREFIX}02`, school: 'school-1' };
const TOPICS = {
  english: ['My Family', 'Action Words', 'Describing Animals', 'Reading a Short Story'],
  maths: ['Place Value to 1000', 'Adding with Carrying', 'Fractions of a Shape', 'Telling Time'],
  science: ['Living and Non-living Things', 'Parts of a Plant', 'States of Matter', 'Our Senses'],
  urdu: ['حروفِ تہجی', 'میرا گھر', 'کہانی: پیاسا کوا', 'جملے بنانا'],
  social_studies: ['My Community', 'Maps and Directions', 'Provinces of Pakistan', 'Good Citizens'],
};
const STUDENTS = ['Ali', 'Hamza', 'Iqra', 'Aiman', 'Saad', 'Noor', 'Ahmed', 'Laiba'];
const FATHERS = ['Imran', 'Shahid', 'Naveed', 'Khalid', 'Rashid', 'Asif', 'Javed', 'Tahir'];

const DOMAINS = {
  lesson_plan_fidelity: [['B1', 'Instructional Clarity & Learning Objectives'], ['B2', 'Lesson Structure & Sequence'], ['B3', 'Activities & Tasks Alignment'], ['B4', 'Activation of Prior Knowledge'], ['B5', 'Meaningful & Real-World Connections'], ['B6', 'Differentiation / Catering to Learning Levels'], ['B7', 'Lesson Closure & Consolidation']],
  high_leverage_practices: [['C1', "Quality Questioning (Bloom's Aligned)"], ['C2', 'Responsive Re-explanation & Adaptive Teaching'], ['C3', 'Effective Feedback'], ['C4', 'Student Agency & Voice']],
  student_engagement: [['D1', 'Diversity of Conceptual Expression'], ['D2', 'Student Reasoning in Responses'], ['D3', 'Student-Initiated Questions'], ['D4', 'Spontaneous Transfer & Connection-Making'], ['D5', 'Visible Learning Progression Across the Lesson']],
  teacher_subject_knowledge: [['F1', 'Content Accuracy'], ['F2', 'Use of Academic Language'], ['F3', 'Anticipation of Student Misconceptions']],
};

// A FICO report in the shape the portal reads (scores.*, domains.*.{domain_score,domain_max,indicators}, …).
function ficoReport({ teacher, subject, grade, topic, lift, r }) {
  const domains = {}; let marks = 0; let max = 0; let applicable = 0;
  for (const [dk, inds] of Object.entries(DOMAINS)) {
    const indicators = inds.map(([id, name]) => {
      const score = Math.max(0, Math.min(2, Math.round(r() * 1.6 + lift)));
      return { id, name, score, applicable: true, timestamp: `0${Math.floor(r() * 9)}:${String(Math.floor(r() * 60)).padStart(2, '0')}`,
        evidence_summary: `Demo evidence for ${name.toLowerCase()} in the ${topic} lesson.`, evidence: `Demo transcript excerpt showing ${name.toLowerCase()}.` };
    });
    const ds = indicators.reduce((s, i) => s + i.score, 0);
    domains[dk] = { domain_score: ds, domain_max: inds.length * 2, indicators_applicable: inds.length, indicators };
    marks += ds; max += inds.length * 2; applicable += inds.length;
  }
  const pct = Math.round((marks / max) * 1000) / 10;
  return {
    framework: 'fico', topic, subject, has_lesson_plan: true,
    scores: { overall_marks: marks, overall_max_marks: max, overall_percentage: pct, max_marks: max, has_lesson_plan: true, indicators_applicable: applicable, indicators_not_applicable: 0 },
    domains,
    executive_summary: `${teacher} taught "${topic}" with a clear objective and a well-paced main activity. The next step is giving each student specific feedback on how to improve an answer.`,
    strengths: [
      { title: 'Clear lesson objective', evidence: `Stated the objective for "${topic}" in the first two minutes.`, impact: 'Students knew what they were working towards.' },
      { title: 'Good use of questioning', evidence: 'Asked several open questions and waited for answers.', impact: 'More students took part.' },
    ],
    growth_opportunities: [
      { area: 'Effective Feedback (C3)', observation: 'Feedback was mostly praise without a next step.', strategies: ['After an answer, name one thing to add next.', 'Use a one-line exit slip to check understanding.'] },
    ],
    recommendations: ['Give one specific improvement prompt per group during the activity.', 'Close the lesson by asking two students to summarise.'],
    focus_area: { title: 'Actionable feedback', domain: 'high_leverage_practices', indicator: 'C3', rationale: 'The most leverageable next step for this lesson.', try_this_tomorrow: 'When a student answers, say what was good and one thing to add.' },
    lp_fidelity: { status: 'ok' },
    subject_resolution: { code: subject, grade: String(grade), confidence: 'high', source: 'portal_demo_seed', subject_unconfirmed: false },
  };
}

function build() {
  const rows = {};   // table -> array of row objects (column -> value)
  const add = (t, row) => { (rows[t] = rows[t] || []).push(row); return row; };
  const session = raw(`(select code from academic_sessions where is_active and current_date between starts_on and ends_on order by starts_on limit 1)`);
  const program = raw(`(select id from training_programs where key = 'niete_standard')`);
  const schoolId = Object.fromEntries(SCHOOLS.map((s) => [s.key, uid(s.key)]));
  const coachId = uid('coach');

  for (const s of SCHOOLS) add('schools', { id: schoolId[s.key], name: s.name, region: s.region, emis: s.emis, source_system: SOURCE, is_active: true, is_probable_test: false });

  const person = (id, name, phone, role, school, extra = {}) => add('users', {
    id, phone_number: phone, name, role, school_id: school ? schoolId[school] : null, school_name: school ? SCHOOLS.find((s) => s.key === school).name : null,
    country: 'Pakistan', region: 'ict', organization: 'niete', source: SOURCE, preferred_language: 'en',
    registration_completed: true, registration_state: 'completed', registered_at: daysAgo(120), registration_completed_at: daysAgo(120),
    portal_activated: true, portal_password_hash: PASSWORD_HASH, is_test_user: false, created_at: daysAgo(120), ...extra,
  });
  person(coachId, COACH.name, COACH.phone, 'coach', null);
  person(uid('principal'), PRINCIPAL.name, PRINCIPAL.phone, 'principal', PRINCIPAL.school);
  for (const s of SCHOOLS) add('leader_schools', { id: uid(`ls:${s.key}`), leader_user_id: coachId, source: 'niete_ict', school_ext_id: `niete:${s.emis}`, school_name: s.name, emis: s.emis, school_id: schoolId[s.key], name_match_quality: 'exact' });

  TEACHERS.forEach(([name, school, grade, subject], i) => {
    const r = rng(1000 + i);
    const tid = uid(`teacher:${i}`);
    const phone = `${PHONE_PREFIX}${String(11 + i).padStart(2, '0')}`;
    const s = SCHOOLS.find((x) => x.key === school);
    person(tid, name, phone, 'teacher', school, { grades_taught: String(grade), subjects_taught: [subject], subject });

    // class + students + roster list + a week of attendance
    const classId = uid(`class:${i}`); const ctId = uid(`ct:${i}`); const listId = uid(`list:${i}`);
    add('classes', { id: classId, school_id: schoolId[school], grade_code: `grade_${grade}`, section: 'A', shift_code: 'morning', session_code: session, is_active: true, created_by_user_id: tid });
    add('class_teachers', { id: ctId, class_id: classId, teacher_user_id: tid, is_class_teacher: true, assigned_on: dateIn(-60), is_active: true });
    add('class_teacher_subjects', { class_teacher_id: ctId, class_id: classId, subject_code: subject });
    add('student_lists', { id: listId, user_id: tid, class_id: classId, class_name: `Grade ${grade}`, section: 'A', academic_year: session, student_count: STUDENTS.length, is_active: true });
    STUDENTS.forEach((st, k) => {
      const sid = uid(`student:${i}:${k}`);
      add('students', { id: sid, list_id: listId, roll_number: k + 1, student_name: `${st} ${FATHERS[(k + i) % FATHERS.length]}`, father_name: FATHERS[(k + i) % FATHERS.length], school_id: schoolId[school], enrolled_by_user_id: tid, is_active: true, status: 'active' });
      add('class_enrollments', { id: uid(`enrol:${i}:${k}`), class_id: classId, student_id: sid, roll_number: k + 1, enrolled_on: dateIn(-60), is_active: true });
    });
    for (let d = 1; d <= 5; d++) {
      const absent = Math.floor(r() * 3);
      add('attendance_sessions', { id: uid(`att:${i}:${d}`), user_id: tid, list_id: listId, session_date: dateIn(-d), total_students: STUDENTS.length, present_count: STUDENTS.length - absent, absent_count: absent, leave_count: 0, marking_method: 'manual', created_at: daysAgo(d, 8) });
    }

    // lesson plans + LP opens
    TOPICS[subject].forEach((topic, k) => add('lesson_plans', { id: uid(`lp:${i}:${k}`), user_id: tid, topic, grade: String(grade), subject, type: 'lesson_plan', status: 'completed', source: SOURCE, created_at: daysAgo(3 + k * 6) }));
    for (let k = 1; k <= 3; k++) add('niete_lp_opens', { id: uid(`open:${i}:${k}`), user_id: tid, plan_kind: 'k5', plan_ref: `grade_${grade}_english_ch${k}_seg1`, lang: 'en', source: 'viewer', opened_at: daysAgo(k * 4) });

    // three self-observations, improving over time
    for (let k = 0; k < 3; k++) {
      const topic = TOPICS[subject][k];
      add('coaching_sessions', { id: uid(`cs:${i}:${k}`), user_id: tid, status: 'completed', framework: 'fico', has_lesson_plan: true,
        analysis_data: ficoReport({ teacher: name.split(' ')[0], subject, grade, topic, lift: 0.1 + k * 0.25, r }),
        audio_duration_seconds: 1500 + Math.floor(r() * 900), transcript_language: 'ur',
        created_at: daysAgo(40 - k * 14), completed_at: daysAgo(40 - k * 14, 11), analysis_completed_at: daysAgo(40 - k * 14, 11) });
    }

    // training: everyone on the standard programme, progress varies
    add('teacher_training_assignments', { id: uid(`tta:${i}`), user_id: tid, program_id: program, assigned_by: SOURCE, is_active: true });
    add('teacher_training_progress', { id: uid(`ttp:${i}`), user_id: tid, module_id: raw(`(select m.id from training_modules m join training_courses c on c.id = m.course_id join training_levels l on l.id = c.level_id join training_vendors v on v.id = l.vendor_id where m.is_active and l.vendor_id in (select vendor_id from training_program_scopes where program_id = ${program.sql}) order by l.order_index, c.id, m.id offset ${i % 4} limit 1)`), completed_at: daysAgo(10 + i) });

    // the coach's visits: one upcoming per teacher (two of them today), one done
    add('observation_schedules', { id: uid(`sched:${i}`), leader_user_id: coachId, school_id: schoolId[school], school_ext_id: `niete:${s.emis}`, school_name: s.name, teacher_ext_id: phone, teacher_user_id: tid, teacher_name: name, scheduled_for: dateIn(i % 5), scheduled_slot: ['08:30', '09:30', '10:30'][i % 3], status: 'upcoming' });
    if (i < 3) {
      // leader observations, one per pipeline stage: draft → talk → sent
      const stage = [['awaiting_observer_review', 'pending', null], ['observer_review_complete', 'pending', null], ['observer_review_complete', 'done', 'sent']][i];
      const report = ficoReport({ teacher: name.split(' ')[0], subject, grade, topic: TOPICS[subject][3], lift: 0.5, r });
      if (stage[2]) report.teacher_delivery = { status: stage[2], channel: 'whatsapp', notes: null, caption: `Your lesson report — prepared from ${COACH.name}'s visit.` };
      const csId = uid(`obs:${i}`);
      add('coaching_sessions', { id: csId, user_id: tid, observer_user_id: coachId, observation_type: 'leader_observation', status: stage[0], debrief_status: stage[1], framework: 'fico', has_lesson_plan: true, analysis_data: report, created_at: daysAgo(2 + i), completed_at: daysAgo(2 + i, 12) });
      add('observation_schedules', { id: uid(`sched-done:${i}`), leader_user_id: coachId, school_id: schoolId[school], school_ext_id: `niete:${s.emis}`, school_name: s.name, teacher_ext_id: phone, teacher_user_id: tid, teacher_name: name, scheduled_for: dateIn(-(2 + i)), scheduled_slot: '09:30', status: 'done', session_id: csId });
    }
  });
  // The child's web quiz (/q/<code>): tests/features/web/web-quiz-child-page.feature. Two SENT quizzes of the Grade 4
  // science teacher, five plain four-option questions each (no pictures, so every one is playable), and three share codes:
  // AB12CD and SM34EF open in English, QZCLOSED switched off in Urdu (the "closed" page). Nothing here reads a vendor.
  const sci = TEACHERS.findIndex(([, , , subject]) => subject === 'science');
  const sciId = uid(`teacher:${sci}`);
  const [sciName, , sciGrade] = TEACHERS[sci];
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const QUIZZES = [
    ['plant', 'Parts of a Plant', [
      ['Which part of a plant takes in water from the soil?', ['Root', 'Leaf', 'Flower', 'Stem'], 'A', 'Roots grow into the soil and take in water and minerals.'],
      ['Which part of a plant makes food using sunlight?', ['Root', 'Leaf', 'Seed', 'Fruit'], 'B', 'Leaves use sunlight, water and air to make food.'],
      ['Which part carries water from the roots to the leaves?', ['Flower', 'Fruit', 'Stem', 'Seed'], 'C', 'The stem carries water up to every leaf.'],
      ['Which part of a plant makes seeds?', ['Root', 'Stem', 'Leaf', 'Flower'], 'D', 'Flowers make the seeds that grow into new plants.'],
      ['A new plant grows from which part?', ['Seed', 'Leaf', 'Stem', 'Flower'], 'A', 'A seed holds the baby plant and its first food.'],
    ]],
    ['grade3', 'Living Things Around Us', [
      ['Which of these is a living thing?', ['A stone', 'A goat', 'A chair', 'A cup'], 'B', 'A goat eats, grows and moves: it is living.'],
      ['What do all living things need?', ['Food and water', 'Toys', 'Shoes', 'Books'], 'A', 'Every living thing needs food and water.'],
      ['Which one grows?', ['A table', 'A rock', 'A seedling', 'A spoon'], 'C', 'A seedling grows into a plant.'],
      ['Which of these breathes?', ['A brick', 'A pencil', 'A bottle', 'A fish'], 'D', 'A fish breathes through its gills.'],
      ['A living thing can…', ['have babies', 'be made of plastic', 'never move', 'stay the same size for ever'], 'A', 'Living things reproduce.'],
      // only pictures as options (the not-yet picture line, WQ053); the item quiz is full (QUESTIONS_MAX = 15)
      ['Which picture shows a circle?', ['Picture 1', 'Picture 2', 'Picture 3', 'Picture 4'], 'B', 'The circle is the round one.',
        { language: 'en', option_images: [{ b64: PNG }, { b64: PNG }, { b64: PNG }, { b64: PNG }] }],
    ]],
    ['grade2', 'Day and Night', [
      ['When do we see the sun?', ['In the day', 'At night', 'Never', 'Only in winter'], 'A', 'The sun shines in the daytime.'],
      ['When do we see the stars?', ['In the day', 'At night', 'At lunch', 'Never'], 'B', 'Stars show in the dark night sky.'],
      ['What gives us light in the day?', ['The moon', 'A candle', 'The sun', 'A star'], 'C', 'The sun lights the day.'],
      ['At night the sky is…', ['green', 'yellow', 'white', 'dark'], 'D', 'At night the sky is dark.'],
      ['We sleep mostly at…', ['night', 'noon', 'morning', 'lunch'], 'A', 'Most people sleep at night.'],
    ]],
    ['grade1', 'Counting to Ten', [
      ['How many fingers are on one hand?', ['Five', 'Two', 'Ten', 'Seven'], 'A', 'One hand has five fingers.'],
      ['What comes after three?', ['Two', 'Four', 'One', 'Six'], 'B', 'Three, then four.'],
      ['How many eyes do you have?', ['One', 'Four', 'Two', 'Three'], 'C', 'You have two eyes.'],
      ['What comes before ten?', ['Six', 'Seven', 'Eight', 'Nine'], 'D', 'Nine comes before ten.'],
      ['How many legs does a dog have?', ['Four', 'Two', 'Six', 'Eight'], 'A', 'A dog has four legs.'],
    ]],
    ['urdu', 'پودے کے حصے', [
      ['پودے کا کون سا حصہ زمین سے پانی لیتا ہے؟', ['جڑ', 'پتا', 'پھول', 'تنا'], 'A', 'جڑ زمین سے پانی اور نمکیات لیتی ہے۔'],
      ['پودے کا کون سا حصہ خوراک بناتا ہے؟', ['جڑ', 'پتا', 'بیج', 'پھل'], 'B', 'پتا دھوپ سے خوراک بناتا ہے۔'],
      ['کون سا حصہ پانی کو پتوں تک لے جاتا ہے؟', ['پھول', 'پھل', 'تنا', 'بیج'], 'C', 'تنا پانی اوپر لے جاتا ہے۔'],
      ['پودے کا کون سا حصہ بیج بناتا ہے؟', ['جڑ', 'تنا', 'پتا', 'پھول'], 'D', 'پھول بیج بناتا ہے۔'],
      ['نیا پودا کس سے اگتا ہے؟', ['بیج', 'پتا', 'تنا', 'پھول'], 'A', 'بیج سے نیا پودا اگتا ہے۔'],
      ['کون سا حرف شدّ کے ساتھ ہے؟', ['بّ', 'بِ', 'بْ', null], 'A', 'شدّ حرف کے اوپر لگتی ہے۔',
        { language: 'ur', web: { v: 2, type: 'picture', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'شد' }, stem: 'کون سا حرف شدّ کے ساتھ ہے؟', key: 'A', why: 'شدّ حرف کے اوپر لگتی ہے۔',
          options: [{ slot: 'A', text: 'بّ', pic: { kind: 'glyph', text: 'بّ' } }, { slot: 'B', text: 'بِ', pic: { kind: 'glyph', text: 'بِ' } }, { slot: 'C', text: 'بْ', pic: { kind: 'glyph', text: 'بْ' } }] } }],
    ]],
    // Item shapes (web-quiz-child-page WQ013–WQ022, WQ088–WQ093, WQ191): one question per kind the page can render, with
    // the media the engine reads (bot/shared/services/quiz/web-quiz.service.js questionPayload, web-quiz-items.js,
    // web-quiz-figure.js). PNG = a 1×1 picture served as bytes; a URL that cannot be fetched is on purpose.
    ['itemsA', 'Shapes and Sounds', [
      ['Which of these is a fruit?', ['Apple', 'Chair', 'Bus', 'Pencil'], 'A', 'An apple grows on a tree and we eat it.',
        { language: 'en', display_order: [2, 0, 3, 1] }, { wrong: { 1: 'A chair is furniture, not food.', 2: 'A bus carries people.', 3: 'A pencil is for writing.' } }],
      ['What fraction of the bar is shaded?', ['3/4', '1/4', '1/2', '4/3'], 'A', 'Three of the four equal parts are shaded.',
        { language: 'en', question_card: 'cards/fraction-card.png', figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] } }],
      ['Which sentence describes the water cycle best?', ['Water evaporates from the sea, forms clouds, falls as rain and flows back to the sea.', 'Water stays in the sea for ever and never moves anywhere at all.', 'Clouds are made of cotton wool that floats up from the fields.', 'Rain comes from the moon when it is full.'], 'A', 'Water moves round and round.',
        { language: 'en', question_card: 'cards/long-options.png' }],
      ['Which one is an animal?', ['Apple', 'Cat', 'Bus'], 'B', 'A cat is an animal.',
        { language: 'en', web: { v: 2, type: 'picture', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'animal' }, stem: 'Which one is an animal?', key: 'B', why: 'A cat is an animal.',
          options: [{ slot: 'A', text: 'Apple', name: 'Apple', pic: { kind: 'pictogram', name: 'apple' } }, { slot: 'B', text: 'Cat', name: 'Cat', pic: { kind: 'pictogram', name: 'cat' } }, { slot: 'C', text: 'Bus', name: 'Bus', pic: { kind: 'pictogram', name: 'bus' } }] } }],
      ['Which animal do you hear?', ['Cow', 'Dog', 'Cat', 'Bird'], 'A', 'A cow says moo.',
        { language: 'en', stimulus_audio: 'http://127.0.0.1:9/no-such-clip.mp3' }],
      ['Which one do we sit on?', ['1. Table', '2. House', '3. Chair', 'Picture 4'], 'C', 'We sit on a chair.',
        { language: 'en', option_images: [{ b64: PNG }, { b64: PNG }, { b64: PNG }, { b64: PNG }] }],
      ['Match each animal to its sound.', ['A-1, B-2, C-3', 'A-2, B-1, C-3', 'A-3, B-2, C-1', null], 'A', 'A goes with 1: the cat says meow.',
        { language: 'en', figure: { type: 'match', left: [{ picto: 'cat' }, { picto: 'dog' }, { picto: 'cow' }], right: [{ text: 'meow' }, { text: 'woof' }, { text: 'moo' }] } }],
      ['Look at the pictures. Which one is a leaf?', ['Leaf', 'Stone', 'Cup', 'Shoe'], 'A', 'A leaf grows on a plant.'],
      ['Look at the picture. Which part takes in water?', ['Root', 'Leaf', 'Flower', 'Stem'], 'A', 'Roots take in water.',
        { language: 'en', question_image: { b64: PNG } }],
      ['What is $\\frac{3}{4}$ of 8?', ['$6$', '$60\\ \\Omega$', '$9 \\div 3 \\neq 3 \\div 9$', '$\\text{Rs } 40$'], 'A', 'Three quarters of eight is six: $A \\rightleftharpoons B$, $67, 62, 57, \\dots$',
        { language: 'en' }],
      ['Which column sum shows 712 take away 460?', ['$\\begin{array}{rr} & 712 \\\\ - & 460 \\\\ \\hline & \\end{array}$', '252', '1172', '460'], 'A', 'Write the bigger number on top.',
        { language: 'en' }],
      ['What is two plus two?', ['Four', 'Three', 'Five', 'Six'], 'A', 'Two and two make four.',
        { language: 'en', question_image: 'pictures/missing.png' }],
      ['Tap the apple in the middle.', ['Left', 'Middle', 'Right'], 'B', 'The middle one.',
        { language: 'en', figure: { type: 'count_objects', count: 3, picto: 'apple' }, web: { v: 2, type: 'label', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'middle' }, stem: 'Tap the apple in the middle.', key: 'B', why: 'The middle one.',
          options: [{ slot: 'A', text: 'Left' }, { slot: 'B', text: 'Middle' }, { slot: 'C', text: 'Right' }],
          figure: { spec: { type: 'count_objects', count: 3, picto: 'apple' }, hotspots: [{ slot: 'A', x: 100, y: 100, r: 40 }, { slot: 'B', x: 9999, y: 100, r: 40 }, { slot: 'C', x: 500, y: 100, r: 40 }] } } }],
      ['Which one can you ride?', ['Zorblax', 'Bus', 'Chair'], 'B', 'You ride a bus.',
        { language: 'en', web: { v: 2, type: 'picture', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'ride' }, stem: 'Which one can you ride?', key: 'B', why: 'You ride a bus.',
          options: [{ slot: 'A', text: 'Zorblax', name: 'Zorblax', pic: { kind: 'pictogram', name: 'zorblax' } }, { slot: 'B', text: 'Bus', name: 'Bus', pic: { kind: 'pictogram', name: 'bus' } }, { slot: 'C', text: 'Chair', name: 'Chair', pic: { kind: 'pictogram', name: 'chair' } }] } }],
      ['Which list names the properties quantity,quality,shape,color,size,weight,height,depth,width,length,temperature?', ['Supercalifragilisticexpialidociousnessness', 'Measurements', 'Colours', 'Shapes'], 'B', 'They are all things we can measure or describe.',
        { language: 'en' }],
    ]],
    ['itemsB', 'Item Shapes', [
      ['Which of these are living things?', ['Goat', 'Stone', 'Tree', 'Cup'], 'A,C', 'A goat and a tree are living.', { language: 'en' }],
      ['Ice is a solid.', ['True', 'False', null, null], 'A', 'Ice keeps its shape.',
        { language: 'en', web: { v: 2, type: 'tf', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'ice' }, stem: 'Ice is a solid.', key: 'A', why: 'Ice keeps its shape.', options: [{ slot: 'A', text: 'True' }, { slot: 'B', text: 'False' }] } }],
      ['Put the stages in order.', ['Flower', 'Fruit', 'Seed', null], 'C,A,B', 'Seed, then flower, then fruit.',
        { language: 'en', web: { v: 2, type: 'order', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'order' }, stem: 'Put the stages in order.', key: 'C,A,B', why: 'Seed, then flower, then fruit.', options: [{ slot: 'A', text: 'Flower' }, { slot: 'B', text: 'Fruit' }, { slot: 'C', text: 'Seed' }] } }],
      ['Match each animal to its home.', ['Hive', 'Nest', 'Water', null], 'B,C,A', 'A bird lives in a nest, a fish in water, a bee in a hive.',
        { language: 'en', web: { v: 2, type: 'match', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'home' }, stem: 'Match each animal to its home.', key: 'B,C,A', why: 'A bird lives in a nest, a fish in water, a bee in a hive.', left: [{ text: 'Bird' }, { text: 'Fish' }, { text: 'Bee' }], options: [{ slot: 'A', text: 'Hive' }, { slot: 'B', text: 'Nest' }, { slot: 'C', text: 'Water' }] } }],
      ['Listen. Which one is it?', ['Apple', 'Chair', 'Pencil', null], 'A', 'An apple.',
        { language: 'en', web: { v: 2, type: 'listen', wa: { from: 'projected' }, source: { kind: 'transcript', quote: 'listen' }, stem: 'Listen. Which one is it?', key: 'A', why: 'An apple.',
          options: [{ slot: 'A', text: 'Apple', name: 'Apple', pic: { kind: 'pictogram', name: 'apple' } }, { slot: 'B', text: 'Chair', name: 'Chair', pic: { kind: 'pictogram', name: 'chair' } }, { slot: 'C', text: 'Pencil', name: 'Pencil', pic: { kind: 'pictogram', name: 'pencil' } }] } }],
      ['Which letter is missing?', ['a', 'e', 'i', 'o'], 'A', 'c-a-t spells cat.',
        { language: 'en', figure: { type: 'word_blank', word: 'cat', blanks: [1], picto: 'cat' } }],
      ['Is a whale a fish?', ['No', 'Yes', null, null], 'A', 'A whale is a mammal.', { language: 'en' }],
    ]],
    ['matter', 'States of Matter', [
      ['Ice is water in which state?', ['Solid', 'Liquid', 'Gas', 'Steam'], 'A', 'Ice keeps its shape, so it is a solid.'],
      ['Which state of matter takes the shape of its container?', ['Solid', 'Liquid', 'Rock', 'Wood'], 'B', 'A liquid flows and takes the shape of what holds it.'],
      ['Steam rising from a kettle is water in which state?', ['Solid', 'Ice', 'Gas', 'Stone'], 'C', 'Steam spreads out to fill the space: it is a gas.'],
      ['What happens to ice when it is warmed?', ['It gets harder', 'It turns to gas at once', 'Nothing', 'It melts into water'], 'D', 'Warmth melts a solid into a liquid.'],
      ['Which of these is a solid?', ['A wooden chair', 'Milk', 'Air', 'Juice'], 'A', 'A chair keeps its own shape, so it is a solid.'],
    ]],
  ];
  // Identity on the page (web-quiz-child-page WQ005, WQ027–WQ049): the science teacher's class 4-A gets the children
  // those scenarios name (a roll 12 "Danish", a second "Ali", two "Zain"s who differ only by father, Tooba/Yusra/Omar/Hina),
  // plus three more classes — 4-B (so an unbound hand-out is ambiguous between two grade-4 classes), 3-B and 5-B (so a
  // grade-3 quiz searches one list and a grade-2 quiz asks which class). Each class has a `classes` row, a class_teachers
  // row, a mirrored student_lists row and enrolled students, exactly as the teacher's own class above.
  const sciClassId = uid(`class:${sci}`), sciListId = uid(`list:${sci}`), sciSchool = schoolId[TEACHERS[sci][1]];
  const EXTRA_4A = [[12, 'Danish Testwala', 'Khalid'], [9, 'Hina Testwala', 'Imran'], [10, 'Ali Raza Testwala', 'Shahid'],
    [13, 'Zain Testwala', 'Khalid'], [14, 'Zain Testwala', 'Tahir'], [15, 'Tooba Testwala', 'Asif'], [16, 'Yusra Testwala', 'Asif'], [17, 'Omar Testwala', 'Javed']];
  EXTRA_4A.forEach(([roll, name, father]) => {
    const sid = uid(`student:${sci}:x${roll}`);
    add('students', { id: sid, list_id: sciListId, roll_number: roll, student_name: name, father_name: father, school_id: sciSchool, enrolled_by_user_id: sciId, is_active: true, status: 'active' });
    add('class_enrollments', { id: uid(`enrol:${sci}:x${roll}`), class_id: sciClassId, student_id: sid, roll_number: roll, enrolled_on: dateIn(-60), is_active: true });
  });
  const EXTRA_CLASSES = [['4', 'B', ['Bilal', 'Sara', 'Hassan']], ['3', 'B', ['Farah', 'Umar', 'Mahnoor']], ['5', 'B', ['Zoya', 'Taha', 'Rida']]];
  const sciList = { '4-A': sciListId };
  EXTRA_CLASSES.forEach(([g, sec, kids]) => {
    const key = `${g}-${sec}`, classId = uid(`class:${sci}:${key}`), ctId = uid(`ct:${sci}:${key}`), listId = uid(`list:${sci}:${key}`);
    sciList[key] = listId;
    add('classes', { id: classId, school_id: sciSchool, grade_code: `grade_${g}`, section: sec, shift_code: 'morning', session_code: session, is_active: true, created_by_user_id: sciId });
    add('class_teachers', { id: ctId, class_id: classId, teacher_user_id: sciId, is_class_teacher: false, assigned_on: dateIn(-60), is_active: true });
    add('class_teacher_subjects', { class_teacher_id: ctId, class_id: classId, subject_code: 'science' });
    // student_lists are unique per teacher on lower(class_name) + year (not section), so the mirror list names the section too
    add('student_lists', { id: listId, user_id: sciId, class_id: classId, class_name: `Grade ${g} ${sec}`, section: sec, academic_year: session, student_count: kids.length, is_active: true });
    kids.forEach((st, k) => {
      const sid = uid(`student:${sci}:${key}:${k}`);
      // roll numbers 21+, ten apart per class, so no number exists in two classes (a roll "only 5-B has", WQ030)
      const roll = 21 + 10 * EXTRA_CLASSES.findIndex(([g2, s2]) => g2 === g && s2 === sec) + k;
      add('students', { id: sid, list_id: listId, roll_number: roll, student_name: `${st} Testwala`, father_name: FATHERS[k], school_id: sciSchool, enrolled_by_user_id: sciId, is_active: true, status: 'active' });
      add('class_enrollments', { id: uid(`enrol:${sci}:${key}:${k}`), class_id: classId, student_id: sid, roll_number: roll, enrolled_on: dateIn(-60), is_active: true });
    });
  });
  const QUIZ_GRADE = { grade3: '3', grade2: '2', grade1: '1' };
  const QUIZ_LANG = { urdu: 'ur' };
  const quizId = {};
  QUIZZES.forEach(([key, topic, qs]) => {
    quizId[key] = uid(`quiz:${key}`);
    // the plant quiz is the hand-out of class 4-A (quizzes.list_id → the roll pad searches that one list; the share code's
    // class_id → identity v2 knows the class); the others are left unbound on purpose
    const bound = key === 'plant' || key === 'urdu' ? { list_id: sciListId } : {};
    add('quizzes', { id: quizId[key], teacher_id: sciId, quiz_source: 'lesson_plan', topic, grade: QUIZ_GRADE[key] || String(sciGrade), subject: 'science', status: 'sent', language: QUIZ_LANG[key] || 'en', total_students_sent: 0, created_at: daysAgo(1), ...bound });
    qs.forEach(([text, opts, correct, why, media, fb], k) => add('quiz_questions', {
      id: uid(`quiz:${key}:q${k}`), quiz_id: quizId[key], question_text: text, option_a: opts[0], option_b: opts[1], option_c: opts[2] == null ? null : opts[2], option_d: opts[3] == null ? null : opts[3],
      correct_option: correct, explanation: why, difficulty_level: 3, sort_order: k + 1, media: media || null, option_feedback: fb || null,
    }));
  });
  const code = (c, key, extra) => add('quiz_share_codes', { id: uid(`code:${c}`), code: c, quiz_id: quizId[key], teacher_user_id: sciId, teacher_name: sciName, topic: QUIZZES.find(([k]) => k === key)[1], language: 'en', active: true, uses_count: 0, expires_at: null, created_at: daysAgo(1), ...extra });
  code('AB12CD', 'plant', { class_id: sciClassId });                 // the hand-out of 4-A (identity v2: class known)
  code('SM34EF', 'matter', {});                                       // unbound: v2 asks which class (4-A or 4-B)
  code('GR3ABC', 'grade3', {});                                       // grade 3: the roll pad searches 3-B only
  code('GR2ABC', 'grade2', {});                                       // grade 2: no list in that grade, the child picks the class
  code('GR1ABC', 'grade1', {});                                       // grade 1: no peer line, no Challenge
  code('UR12AB', 'urdu', { language: 'ur' });                          // an Urdu quiz
  code('IT12AB', 'itemsA', {});                                       // item shapes: pictures, figures, sounds, maths
  code('IT34CD', 'itemsB', {});                                       // item shapes: multi, true/false, order, match, listen
  code('TT12AB', 'plant', { teacher_name: `Teacher ${sciName}` });     // a stored name that already carries a title
  code('EX12AB', 'plant', { expires_at: daysAgo(1) });                  // expired (still active = true)
  code('QZCLOSED', 'plant', { language: 'ur', active: false });        // switched off, in Urdu
  // The school league (WQ064–WQ068) needs finishes from more than one school: the same grade-3 questions as quizzes of
  // a school-2 teacher and a school-3 teacher, each with its own open code.
  [['SC2ABC', 3], ['SC3ABC', 6], ['SC4ABC', 9]].forEach(([c, ti]) => {
    const [tName, , tGrade] = TEACHERS[ti], tid = uid(`teacher:${ti}`), qid = uid(`quiz:school:${c}`);
    add('quizzes', { id: qid, teacher_id: tid, quiz_source: 'lesson_plan', topic: 'Living Things Around Us', grade: String(tGrade), subject: 'science', status: 'sent', language: 'en', total_students_sent: 0, created_at: daysAgo(1) });
    QUIZZES.find(([k]) => k === 'grade3')[2].forEach(([text, opts, correct, why], k) => add('quiz_questions', {
      id: uid(`quiz:school:${c}:q${k}`), quiz_id: qid, question_text: text, option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3],
      correct_option: correct, explanation: why, difficulty_level: 3, sort_order: k + 1, media: null, option_feedback: null,
    }));
    add('quiz_share_codes', { id: uid(`code:${c}`), code: c, quiz_id: qid, teacher_user_id: tid, teacher_name: tName, topic: 'Living Things Around Us', language: 'en', active: true, uses_count: 0, expires_at: null, created_at: daysAgo(1) });
  });
  return rows;
}

const FLAGS = ['portal_new_ui', 'portal_teacher_v2', 'portal_coach_v2', 'portal_coach_observation', 'portal_self_observation',
  // the child quiz's Challenge as specified today: the record rule, the trail, Missing number and per-item rows
  // (web-quiz-challenge.js rulesOf); a scenario that needs one off switches it off itself
  'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_items'];

function toSql(rows) {
  const out = ['-- portal demo seed (bd-hnhlgn) — generated by bot/scripts/e2e/portal-demo-seed.js; synthetic data only', 'begin;', 'set local session_replication_role = replica;'];
  // children first, so a re-run never trips a foreign key even with triggers on
  const order = ['quiz_share_codes', 'quiz_questions', 'quizzes', 'class_teacher_subjects', 'class_enrollments', 'attendance_sessions', 'students', 'student_lists', 'class_teachers', 'classes', 'observation_schedules', 'coaching_sessions', 'niete_lp_opens', 'lesson_plans', 'teacher_training_progress', 'teacher_training_assignments', 'leader_schools', 'users', 'schools'];
  // a web-quiz run's sessions (their answers go by cascade) hang off the demo quizzes: out first, so a re-run is clean
  out.push(`delete from public.quiz_sessions where quiz_id in (${(rows.quizzes || []).map((x) => lit(x.id)).join(',')});`);
  for (const t of order) {
    const r = rows[t] || [];
    if (t === 'class_teacher_subjects') out.push(`delete from public.${t} where class_teacher_id in (${r.map((x) => lit(x.class_teacher_id)).join(',')});`);
    else if (r.length) out.push(`delete from public.${t} where id in (${r.map((x) => lit(x.id)).join(',')});`);
  }
  // anything else still hanging off a demo user (e.g. rows the local portal created while you clicked around)
  out.push(`delete from public.teacher_training_progress where user_id in (select id from public.users where phone_number like '${PHONE_PREFIX}%');`);
  for (const t of [...order].reverse()) {
    const r = rows[t] || [];
    if (!r.length) continue;
    const cols = [...new Set(r.flatMap(Object.keys))];
    out.push(`insert into public.${t} (${cols.join(', ')}) values\n  ${r.map((x) => `(${cols.map((c) => lit(x[c])).join(', ')})`).join(',\n  ')};`);
  }
  for (const k of FLAGS) out.push(`insert into public.app_settings (key, value, description) values ('${k}', 'true'::jsonb, 'on for the local portal demo (portal-demo-seed.js)') on conflict (key) do update set value = 'true'::jsonb;`);
  // The child quiz page asks the bot to record read-aloud clips through a paid voice vendor the first time a quiz is
  // opened. The local lane has no vendor (cassettes only), so recording is OFF here; a scenario that tests the switch
  // turns it on itself. (web-quiz-audio-store.js reads web_quiz_audio_enabled.)
  out.push(`insert into public.app_settings (key, value, description) values ('web_quiz_audio_enabled', 'false'::jsonb, 'off for the local demo: no voice vendor on this lane (portal-demo-seed.js)') on conflict (key) do update set value = 'false'::jsonb;`);
  // The seed snapshot's web_quiz_teachers names seven sandbox teachers, so no demo teacher's children would get web links
  // (/quiz hub, old-link redirect, handset link): for the local demo every teacher is allowed (web-quiz-link.js teacherAllowed).
  out.push(`insert into public.app_settings (key, value, description) values ('web_quiz_teachers', '"all"'::jsonb, 'every teacher for the local demo (portal-demo-seed.js)') on conflict (key) do update set value = '"all"'::jsonb;`);
  out.push('commit;');
  return out.join('\n') + '\n';
}

module.exports = { build, toSql, PASSWORD, PASSWORD_HASH, PHONE_PREFIX, TEACHERS, COACH, PRINCIPAL };

if (require.main === module) process.stdout.write(toSql(build()));
