'use strict';
/**
 * web_quiz_stories.sql (the storybook tables) and web_quiz_student_videos_language.sql (a video's language) on a
 * real, throwaway Postgres (initdb in a temp folder, a unix socket, no TCP), and the same statements in
 * infrastructure/supabase/00_complete-schema.sql, byte for byte.
 * A book is a draft until the loader marks it ready; a page has one row per (book, n); a page has at most one
 * current voice per language, and a re-voice keeps the old row; events name a known kind. Both apply twice cleanly
 * and their rollbacks remove them.
 *
 * Needs the Postgres server binaries (postgres, initdb, pg_ctl, psql: PG_BIN or pg_config --bindir); without them the
 * Postgres part is skipped and says so (the byte-for-byte check always runs).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MIG = path.join(__dirname, '..', '..', '..', 'database', 'migrations');
const SCHEMA = path.join(__dirname, '..', '..', '..', '..', 'infrastructure', 'supabase', '00_complete-schema.sql');
const binDir = (() => {
  const cands = [process.env.PG_BIN];
  try { cands.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* none */ }
  cands.push('/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/bin');
  return cands.find((c) => c && ['postgres', 'initdb', 'pg_ctl', 'psql'].every((b) => fs.existsSync(path.join(c, b)))) || null;
})();
const bin = (b) => path.join(binDir, b);
const d = binDir ? describe : describe.skip;
if (!binDir) console.warn('stories-migration: no Postgres server binaries found (set PG_BIN) — the Postgres part is skipped');

// ── the mirror: each migration's statements appear in the schema file exactly ─────────────────────────────────────
const between = (sql, first, last) => {
  const t = sql.indexOf(first);
  const e = t >= 0 ? sql.indexOf(last, t) : -1;
  return t >= 0 && e > t ? sql.slice(t, e + last.length) : null;
};
const STORIES = ['CREATE TABLE IF NOT EXISTS story_books (', 'ALTER TABLE public.story_events ENABLE ROW LEVEL SECURITY;'];
const VIDEOS = ['ALTER TABLE student_videos ADD COLUMN IF NOT EXISTS language text;', "CHECK (language IN ('en', 'ur'));\n  END IF;\nEND $$;"];

test('the schema file mirrors the storybook tables, indexes and row level security byte for byte', () => {
  const mig = between(fs.readFileSync(path.join(MIG, 'web_quiz_stories.sql'), 'utf8'), ...STORIES);
  expect(mig).toBeTruthy();
  expect(between(fs.readFileSync(SCHEMA, 'utf8'), ...STORIES)).toBe(mig);
  ['source_id     text UNIQUE,', "status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'off')),",
    'text_band     jsonb,', 'CREATE UNIQUE INDEX IF NOT EXISTS story_page_voices_current ON public.story_page_voices (page_id, lang) WHERE is_current;',
    'CREATE INDEX IF NOT EXISTS story_events_child_at ON public.story_events (child_id, at DESC);',
    'ALTER TABLE story_page_voices ADD COLUMN IF NOT EXISTS quality text;',
  ].forEach((line) => expect(mig).toContain(line));
});

test('the schema file mirrors the video language column byte for byte', () => {
  const mig = between(fs.readFileSync(path.join(MIG, 'web_quiz_student_videos_language.sql'), 'utf8'), ...VIDEOS);
  expect(mig).toBeTruthy();
  expect(between(fs.readFileSync(SCHEMA, 'utf8'), ...VIDEOS)).toBe(mig);
});

test('the schema file mirrors the story_page_unvoiced event name byte for byte, after the storybook tables', () => {
  const UNVOICED = ['DO $$', 'END $$;'];
  const mig = between(fs.readFileSync(path.join(MIG, 'web_quiz_story_unvoiced.sql'), 'utf8'), ...UNVOICED);
  expect(mig).toContain("'story_page_unvoiced'");
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  const at = schema.indexOf(mig);
  expect(at).toBeGreaterThan(schema.indexOf('ALTER TABLE public.story_events ENABLE ROW LEVEL SECURITY;'));
});

let dir;
let sock;
const PORT = String(57000 + (process.pid % 900));
const psql = (sql, { file = null } = {}) => execFileSync(bin('psql'), [
  '-h', sock, '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
  ...(file ? ['-f', file] : ['-c', sql]),
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = (sql) => { try { psql(sql); return null; } catch (e) { return String(e.stderr || e.message); } };
const apply = (f) => psql(null, { file: path.join(MIG, f) });

const BOOK = 'b0000000-0000-4000-8000-0000000000b1';
const book = (cols = {}) => {
  const c = { id: `'${BOOK}'`, source_id: "'src-testwala'", slug: "'g1-en-asad-testwala'", title: "'Asad Testwala'", grade: 1, lang: "'en'", ...cols };
  return `insert into story_books (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')})`;
};

d('on Postgres', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqst-'));
    sock = fs.mkdtempSync(path.join(os.tmpdir(), 'wqss-'));
    execFileSync(bin('initdb'), ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' });
    execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'log'), '-w', '-o',
      `-p ${PORT} -k ${sock} -c listen_addresses='' -c fsync=off`, 'start'], { stdio: 'ignore' });
    psql('create table public.student_videos (id uuid primary key default gen_random_uuid(), grade varchar(50))');
  }, 60000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(bin('pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }); } catch (_) { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  });

  test('applies twice cleanly: five tables with row level security, the shelf and current-voice indexes', () => {
    apply('web_quiz_stories.sql');
    apply('web_quiz_stories.sql');
    expect(psql("select count(*) from pg_class where relname in ('story_books','story_pages','story_page_voices','story_questions','story_events') and relrowsecurity")).toBe('5');
    expect(psql("select count(*) from pg_indexes where indexname in ('story_books_shelf','story_page_voices_current','story_events_child_at','story_events_book_at')")).toBe('4');
  });

  test('a book is a draft until marked ready; grade 1-5, en/ur, a known status, one row per source and slug', () => {
    expect(fails(book())).toBeNull();
    expect(psql(`select status from story_books where id = '${BOOK}'`)).toBe('draft');
    expect(fails(book({ id: 'gen_random_uuid()', slug: "'g1-en-other'" }))).toMatch(/duplicate key/);
    expect(fails(book({ id: 'gen_random_uuid()', source_id: "'s2'", slug: "'s2'", grade: 6 }))).toMatch(/check constraint/);
    expect(fails(book({ id: 'gen_random_uuid()', source_id: "'s3'", slug: "'s3'", lang: "'fr'" }))).toMatch(/check constraint/);
    expect(fails(`update story_books set status = 'live' where id = '${BOOK}'`)).toMatch(/check constraint/);
  });

  test('pages: one per (book, n), n from 1, words default to an empty list, a page goes with its book', () => {
    expect(fails(`insert into story_pages (book_id, n, image_file, image_w, image_h, text, words) values ('${BOOK}', 1, 'p01-0a1b2c3d.webp', 720, 1083, 'Asad Testwala reads.', '[{"i":0,"t":"Asad","box":[1,2,3,4]}]')`)).toBeNull();
    expect(fails(`insert into story_pages (book_id, n, image_file, image_w, image_h) values ('${BOOK}', 1, 'x.webp', 1, 1)`)).toMatch(/duplicate key/);
    expect(fails(`insert into story_pages (book_id, n, image_file, image_w, image_h) values ('${BOOK}', 0, 'x.webp', 1, 1)`)).toMatch(/check constraint/);
    expect(fails(`insert into story_pages (book_id, n, image_file, image_w, image_h) values ('${BOOK}', 2, 'p02-0a1b2c3d.webp', 720, 1083)`)).toBeNull();
    expect(psql(`select words::text || '|' || boxes_ok || '|' || is_picture || '|' || watermark from story_pages where book_id = '${BOOK}' and n = 2`)).toBe('[]|false|false|false');
  });

  test('voices: one current per page and language; a re-voice keeps the old row', () => {
    const page = `(select id from story_pages where book_id = '${BOOK}' and n = 1)`;
    const voice = (cur, src = "'stt_align'") => `insert into story_page_voices (page_id, lang, provider, voice, audio_key, ms, timings, timing_source, is_current) values (${page}, 'en', 'soniox', 'Grace', 'story/dev/${BOOK}/a01-0a1b2c3d.ogg', 2100, '[{"i":0,"s_ms":120,"e_ms":480}]', ${src}, ${cur})`;
    expect(fails(voice(true))).toBeNull();
    expect(fails(voice(true))).toMatch(/duplicate key/);
    expect(fails(voice(false, "'guess'"))).toMatch(/check constraint/);
    expect(fails(`${voice(false, "'forced_align'")}`)).toBeNull();
    expect(fails(`begin; update story_page_voices set is_current = false where page_id = ${page}; ${voice(true)}; commit;`)).toBeNull();
    expect(psql(`select count(*) || '/' || count(*) filter (where is_current) from story_page_voices where page_id = ${page}`)).toBe('3/1');
  });

  test('a voice may be marked low quality (its words follow by line); nothing else', () => {
    const page = `(select id from story_pages where book_id = '${BOOK}' and n = 2)`;
    const voice = (q) => `insert into story_page_voices (page_id, lang, provider, voice, audio_key, ms, timings, timing_source, is_current, quality) values (${page}, 'en', 'soniox', 'Grace', 'story/dev/${BOOK}/a02-0a1b2c3d.ogg', 2100, '[]', 'stt_align', false, ${q})`;
    expect(fails(voice("'low'"))).toBeNull();
    expect(fails(voice('null'))).toBeNull();
    expect(fails(voice("'high'"))).toMatch(/check constraint/);
  });

  test('questions: 1-5 per book, a known kind and review status; events: a known kind only', () => {
    const qn = (n, kind = "'literal'", rs = "'reviewed'") => `insert into story_questions (book_id, n, kind, q, options, answer_i, review_status) values ('${BOOK}', ${n}, ${kind}, 'Who reads?', '[{"t":"Asad"},{"t":"Sara"},{"t":"Ali"}]', 0, ${rs})`;
    expect(fails(qn(1))).toBeNull();
    expect(fails(qn(1))).toMatch(/duplicate key/);
    expect(fails(qn(6))).toMatch(/check constraint/);
    expect(fails(qn(2, "'trick'"))).toMatch(/check constraint/);
    expect(fails(qn(3, "'literal'", "'ok'"))).toMatch(/check constraint/);
    expect(fails(`insert into story_events (book_id, event, data) values ('${BOOK}', 'story_opened', '{"shelf_position":2}')`)).toBeNull();
    expect(fails(`insert into story_events (book_id, event) values ('${BOOK}', 'story_liked')`)).toMatch(/check constraint/);
  });

  test('story_page_unvoiced: a seventh event name, applied twice; the rollback turns its rows back into miss listens', () => {
    const ev = (name, data = '{}') => `insert into story_events (book_id, page_n, event, data) values ('${BOOK}', 3, '${name}', '${data}')`;
    expect(fails(ev('story_page_unvoiced'))).toMatch(/check constraint/);
    apply('web_quiz_story_unvoiced.sql');
    apply('web_quiz_story_unvoiced.sql');
    expect(fails(ev('story_page_unvoiced'))).toBeNull();
    ['story_opened', 'story_page_listened', 'story_page_read', 'story_questions_done', 'story_done', 'story_shared']
      .forEach((name) => expect(fails(ev(name))).toBeNull());
    expect(fails(ev('story_liked'))).toMatch(/check constraint/);
    expect(psql("select count(*) from pg_constraint where conname = 'story_events_event_check'")).toBe('1');
    apply('web_quiz_story_unvoiced_rollback.sql');
    expect(psql("select count(*) from story_events where event = 'story_page_unvoiced'")).toBe('0');
    expect(psql(`select count(*) from story_events where event = 'story_page_listened' and page_n = 3 and data->>'miss' = 'true'`)).toBe('1');
    expect(fails(ev('story_page_unvoiced'))).toMatch(/check constraint/);
    expect(fails(ev('story_done'))).toBeNull();
    apply('web_quiz_story_unvoiced.sql');
    expect(fails(ev('story_page_unvoiced'))).toBeNull();
  });

  test('story_page_unvoiced: the six-name check is replaced whatever name the database gave it (one event check after)', () => {
    const ev = (name) => `insert into story_events (book_id, page_n, event) values ('${BOOK}', 4, '${name}')`;
    const eventChecks = "select count(*) from pg_constraint where conrelid = 'public.story_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%story_opened%'";
    apply('web_quiz_story_unvoiced_rollback.sql');
    psql('alter table story_events rename constraint story_events_event_check to story_events_event_check1');
    expect(fails(ev('story_page_unvoiced'))).toMatch(/check constraint/);
    apply('web_quiz_story_unvoiced.sql');
    expect(fails(ev('story_page_unvoiced'))).toBeNull();
    expect(fails(ev('story_liked'))).toMatch(/check constraint/);
    expect(psql(eventChecks)).toBe('1');
    apply('web_quiz_story_unvoiced.sql');
    expect(psql(eventChecks)).toBe('1');
  });

  test('the video language: nullable, en or ur only, applies twice', () => {
    apply('web_quiz_student_videos_language.sql');
    apply('web_quiz_student_videos_language.sql');
    expect(fails("insert into student_videos (grade) values ('1')")).toBeNull();
    expect(fails("insert into student_videos (grade, language) values ('1', 'ur')")).toBeNull();
    expect(fails("insert into student_videos (grade, language) values ('1', 'urdu')")).toMatch(/check constraint/);
    expect(psql("select count(*) filter (where language is null) || '/' || count(*) from student_videos")).toBe('1/2');
  });

  test('the rollbacks remove them all', () => {
    apply('web_quiz_stories_rollback.sql');
    apply('web_quiz_student_videos_language_rollback.sql');
    expect(psql("select count(*) from pg_class where relname like 'story\\_%'")).toBe('0');
    expect(psql("select count(*) from information_schema.columns where table_name = 'student_videos' and column_name = 'language'")).toBe('0');
    apply('web_quiz_stories.sql');
    expect(psql("select count(*) from pg_class where relname = 'story_books'")).toBe('1');
  });
});
