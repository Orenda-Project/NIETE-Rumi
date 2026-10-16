'use strict';
/**
 * scripts/web-quiz/backfill-video-language.js: student_videos.language from each video's lesson quiz, by the
 * row's language, else the questions' majority script. Only NULL rows; a video with no quiz stays NULL;
 * dry run writes nothing; refuses a database that is not the expected one. The database is an in-memory query
 * builder with supabase-js's chain shape (the network boundary).
 */
const { main, languageFor } = require('../../../../scripts/web-quiz/backfill-video-language');

function fakeDb(t) {
  const writes = [];
  const from = (table) => {
    const f = { table, eq: [], in: null, is: [], not: [], limit: null, range: null, patch: null };
    const rows = () => (t[table] || []).filter((r) => f.eq.every(([k, v]) => r[k] === v) && f.is.every(([k, v]) => r[k] === v)
      && f.not.every(([k]) => r[k] != null) && (!f.in || f.in[1].includes(r[f.in[0]])));
    const b = {
      select: () => b, order: () => b, eq: (k, v) => { f.eq.push([k, v]); return b; }, in: (k, v) => { f.in = [k, v]; return b; },
      is: (k, v) => { f.is.push([k, v]); return b; }, not: (k) => { f.not.push([k]); return b; }, limit: (n) => { f.limit = n; return b; },
      range: (a, z) => { f.range = [a, z]; return b; }, update: (p) => { f.patch = p; return b; },
      then: (res) => {
        if (f.patch) { const hit = rows(); hit.forEach((r) => Object.assign(r, f.patch)); writes.push({ table, n: hit.length, patch: f.patch }); return res({ error: null }); }
        let d = rows();
        if (f.range) d = d.slice(f.range[0], f.range[1] + 1);
        if (f.limit) d = d.slice(0, f.limit);
        return res({ data: d.map((r) => ({ ...r })), error: null });
      },
    };
    return b;
  };
  return { from, writes };
}
const io = () => { const o = { out: '', err: '' }; return { o, stdout: { write: (s) => { o.out += s; } }, stderr: { write: (s) => { o.err += s; } } }; };
const tables = () => ({
  student_videos: [{ id: 'v1', language: null }, { id: 'v2', language: null }, { id: 'v3', language: null }, { id: 'v4', language: 'en' }, { id: 'v5', language: null }],
  quizzes: [{ id: 'q1', video_id: 'v1', language: 'ur', quiz_source: 'video' }, { id: 'q2', video_id: 'v2', language: null, quiz_source: 'video' },
    { id: 'q3', video_id: 'v3', language: null, quiz_source: 'video' }, { id: 'q9', video_id: 'v5', language: 'ur', quiz_source: 'transcript' }],
  quiz_questions: [{ quiz_id: 'q2', question_text: 'بلی کہاں ہے؟', option_a: 'گھر' }, { quiz_id: 'q3', question_text: 'Where is the cat?', option_a: 'Home' }],
});

test('the rule: the row\'s language, else the questions\' script', () => {
  expect(languageFor({ language: 'ur' }, [])).toBe('ur');
  expect(languageFor({ language: null }, [{ question_text: 'بلی', option_a: '' }])).toBe('ur');
  expect(languageFor({ language: null }, [{ question_text: 'cat', option_a: 'dog' }])).toBe('en');
});

test('the questions\' script is the MAJORITY script: one Urdu letter inside an English question is still English', () => {
  // A Grade 1 Qaida lesson: English questions that name an Urdu letter.
  const qaida = [
    { question_text: 'What is the Urdu name for the different shape of Ha (ہ)?', option_a: 'Do-chashmi Ha' },
    { question_text: 'Which letter was called a thick letter?', option_a: 'Taa' },
    { question_text: 'Which letter comes after Lam?', option_a: 'Meem' },
  ];
  expect(languageFor({ language: null }, qaida)).toBe('en');
  // Urdu questions with an English word in them stay Urdu.
  expect(languageFor({ language: null }, [{ question_text: 'Cat کو اردو میں کیا کہتے ہیں؟', option_a: 'بلی' }])).toBe('ur');
  // The quiz row's own language still wins.
  expect(languageFor({ language: 'ur' }, qaida)).toBe('ur');
});

test('fills only NULL rows that have a lesson quiz; counts, never ids', async () => {
  const t = tables(); const db = fakeDb(t); const out = io();
  expect(await main({ argv: [], db, io: out })).toBe(0);
  expect(JSON.parse(out.o.out)).toEqual({ videos: 5, null_before: 4, with_quiz: 3, en: 1, ur: 2, no_quiz: 1, written: 3, dry_run: false });
  expect(t.student_videos.map((v) => v.language)).toEqual(['ur', 'ur', 'en', 'en', null]);
  expect(out.o.out).not.toMatch(/v1|q1/);
  const again = io();
  await main({ argv: [], db: fakeDb(t), io: again });
  expect(JSON.parse(again.o.out)).toMatchObject({ null_before: 1, written: 0 });
});

test('dry run writes nothing; no env or the wrong database refuses', async () => {
  const t = tables(); const db = fakeDb(t); const out = io();
  await main({ argv: ['--dry-run'], db, io: out });
  expect(JSON.parse(out.o.out)).toMatchObject({ written: 0, dry_run: true, ur: 2, en: 1 });
  expect(db.writes).toEqual([]);
  const e1 = io();
  expect(await main({ argv: ['--expect-ref', 'sandboxref'], env: {}, io: e1 })).toBe(2);
  const e2 = io();
  expect(await main({ argv: ['--expect-ref', 'sandboxref'], env: { SUPABASE_URL: 'https://prodref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, io: e2 })).toBe(2);
  expect(e2.o.err).toMatch(/not the expected database/);
});
