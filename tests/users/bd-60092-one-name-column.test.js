/**
 * bd-60092 — `users.name` is the ONLY name column (red-first).
 *
 * Operator, 2026-09-14: "remove all the usages of First Name and Last Name and
 * replace them with name field. If really needed, you can use First Name and
 * Last Name's split to use first name."
 *
 * Measured on NIETE prod the same day, across 14,574 users:
 *   · `name` populated 9,037 · `first_name` 7,376 · `last_name` 4,306
 *   · 5,494 carry NONE of the three — every one of them has a phone number
 *   · 43 have an empty `name` that first+last CAN fill (the in-DB backfill)
 *   · 1,596 more can be named from fde_production.users_user by phone
 *
 * The split columns buy nothing a split cannot compute: a first name is
 * `name.split(' ')[0]`, which observe-capture.service.js already did by hand.
 * What they DO buy is three writers disagreeing about what `name` means —
 * feature-registration wrote a FIRST name into it, flow-response wrote a FULL
 * name, observe-teacher-admin wrote the full name into `first_name`. That
 * disagreement is the bug this closes.
 *
 * These assertions fail against the pre-sweep tree ON PURPOSE.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA = path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql');

/** Every shipped .js/.ts the drop would break — excludes tests and mocks. */
function sourceFiles() {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__mocks__', 'tests']);
  const exts = new Set(['.js', '.jsx', '.ts', '.tsx']);
  for (const top of ['bot', 'dashboard', 'portal']) {
    const start = path.join(ROOT, top);
    if (!fs.existsSync(start)) continue;
    const stack = [start];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!skip.has(e.name)) stack.push(path.join(dir, e.name));
        } else if (exts.has(path.extname(e.name)) && !/\.test\.[jt]sx?$/.test(e.name)) {
          out.push(path.join(dir, e.name));
        }
      }
    }
  }
  return out;
}

const FILES = sourceFiles();
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f);

describe('bd-60092 · no shipped code references the dropped columns', () => {
  // Comments are exempt ON PURPOSE. Several carry the measured rationale for
  // why the split was wrong (bd-43530's 9,362-user survey, the remark-screens
  // null-name defect note) — that history is why nobody re-adds the columns,
  // and deleting it to satisfy a grep would cost more than it buys. What must
  // be gone is every line that EXECUTES against the dropped columns.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  it('no executable line references first_name or last_name', () => {
    const offenders = [];
    for (const f of FILES) {
      stripComments(read(f)).split('\n').forEach((line, i) => {
        if (/\bfirst_name\b|\blast_name\b/.test(line)) {
          offenders.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no Supabase select list names the dropped columns', () => {
    const offenders = [];
    for (const f of FILES) {
      const src = read(f);
      const re = /\.select\(\s*(['"`])([\s\S]*?)\1/g;
      let m;
      while ((m = re.exec(src))) {
        if (/\bfirst_name\b|\blast_name\b/.test(m[2])) {
          offenders.push(`${rel(f)}  .select(${m[2].slice(0, 70)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no insert/update writes a first_name or last_name key', () => {
    const offenders = [];
    for (const f of FILES) {
      read(f).split('\n').forEach((line, i) => {
        if (/(first_name|last_name)\s*:/.test(line)) {
          offenders.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('bd-60092 · the schema no longer declares the columns', () => {
  const sql = fs.existsSync(SCHEMA) ? fs.readFileSync(SCHEMA, 'utf8') : '';

  it('00_complete-schema.sql still declares users.name', () => {
    expect(sql).toMatch(/\bname\b/);
  });

  it('00_complete-schema.sql does not declare users.first_name / users.last_name', () => {
    const lines = sql.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^\s*(first_name|last_name)\s/.test(l)
        || /ADD COLUMN[^;]*\b(first_name|last_name)\b/i.test(l));
    expect(lines.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});

describe('bd-60092 · a first name is derived, never stored', () => {
  const { firstNameOf } = require('../../bot/shared/utils/person-name');

  it('takes the first word of a full name', () => {
    expect(firstNameOf({ name: 'Muhammad Kashif Rafique' })).toBe('Muhammad');
    expect(firstNameOf({ name: 'Anwar Saifullah' })).toBe('Anwar');
  });

  it('handles a single-word name', () => {
    expect(firstNameOf({ name: 'Shabana' })).toBe('Shabana');
  });

  it('collapses the whitespace FDE ships — "ANJUM  ZAHID" is 6 rows on prod', () => {
    expect(firstNameOf({ name: 'ANJUM  ZAHID' })).toBe('ANJUM');
  });

  it('returns null for a nameless person rather than the string "null"', () => {
    // 5,494 users on prod. They must degrade to a phone at the render layer,
    // never print "null" or "undefined" to a coach.
    expect(firstNameOf({ name: null })).toBeNull();
    expect(firstNameOf({})).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe('bd-60092 · fullNameOf resolves from `name` alone', () => {
  const { fullNameOf } = require('../../bot/shared/utils/person-name');

  it('returns the stored name', () => {
    expect(fullNameOf({ name: 'Irene Khan' })).toBe('Irene Khan');
  });

  it('normalises whitespace', () => {
    expect(fullNameOf({ name: '  Mariam   Gull Awan ' })).toBe('Mariam Gull Awan');
  });

  it('returns null when there is no name, so callers fall back to the phone', () => {
    expect(fullNameOf({ name: '' })).toBeNull();
    expect(fullNameOf({})).toBeNull();
  });
});

describe('bd-60092 · titleCaseName — the FDE import decision', () => {
  // 79% of the 1,596 recoverable FDE names arrive ALL CAPS ("BAKAR SHAH").
  // Operator chose title-case ON WRITE, 2026-09-14.
  const { titleCaseName } = require('../../bot/shared/utils/person-name');

  it('title-cases an all-caps name', () => {
    expect(titleCaseName('BAKAR SHAH')).toBe('Bakar Shah');
    expect(titleCaseName('MUHAMMAD NADEEM')).toBe('Muhammad Nadeem');
  });

  it('leaves an already-mixed-case name alone', () => {
    expect(titleCaseName('Anwar Saifullah')).toBe('Anwar Saifullah');
    expect(titleCaseName('Mukhtiar Hussain')).toBe('Mukhtiar Hussain');
  });

  it('collapses the double spaces in FDE data', () => {
    expect(titleCaseName('ANJUM  ZAHID')).toBe('Anjum Zahid');
  });

  it('keeps a one-letter initial as a capital', () => {
    expect(titleCaseName('M HUMAYON RASHEED')).toBe('M Humayon Rasheed');
  });

  it('returns null for empty input', () => {
    expect(titleCaseName('')).toBeNull();
    expect(titleCaseName(null)).toBeNull();
  });
});
