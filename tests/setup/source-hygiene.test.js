/**
 * Source Hygiene (Phase 6) — two conformance guards for the public repo:
 *
 * 1. No internal ticket references (bd-NNN / BUG-NNN / "Bug #NN" / PROJ-/FEAT-/TASK-NNN)
 *    in shipped source. These leak internal tracking into a public repo and gitleaks
 *    doesn't catch them (they aren't secrets). Scans non-test bot/dashboard/infra source.
 *
 * 2. Entry-point files parse. The bot entry (whatsapp-bot.js), workers, and CLI scripts
 *    are run via `node`, never imported by a test — so a syntax error (e.g. a missing
 *    brace from a bad merge) sails through the jest suite and lint, and the process just
 *    fails to boot. `node --check` each of them here.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

const REF_RE = /\b(?:bd-\d+|BUG-\d+|PROJ-\d+|FEAT-\d+|TASK-\d+|[Bb][Uu][Gg]\s*#\d+)\b/;

function collect(dir, exts) {
  const out = [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', 'tests', '__tests__'].includes(e.name)) continue;
        walk(p);
      } else if (exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.test.js')) {
        out.push(p);
      }
    }
  };
  walk(abs);
  return out;
}

describe('Source Hygiene', () => {
  describe('no internal ticket references in shipped source', () => {
    it('bot/dashboard/infrastructure source is free of bd-/BUG-/PROJ-/FEAT-/TASK-/Bug # refs', () => {
      const files = [
        ...collect('bot', ['.js']),
        ...collect('dashboard', ['.js', '.ts', '.tsx']),
        ...collect('infrastructure', ['.js']),
      ];
      const offenders = [];
      for (const f of files) {
        const lines = fs.readFileSync(f, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (REF_RE.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
        });
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('entry-point files parse (node --check)', () => {
    // Files run via `node` and never imported by a test → not syntax-covered by jest.
    const entries = [
      'bot/whatsapp-bot.js',
      ...collect('bot/workers', ['.js']).map((f) => path.relative(ROOT, f)),
      ...collect('infrastructure/scripts', ['.js']).map((f) => path.relative(ROOT, f)),
    ];
    it.each(entries)('%s has valid syntax', (rel) => {
      expect(() => execFileSync('node', ['--check', path.join(ROOT, rel)], { stdio: 'pipe' })).not.toThrow();
    });
  });
});
