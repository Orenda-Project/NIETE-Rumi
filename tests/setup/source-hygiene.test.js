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

// Internal context that must never appear in public agent-native docs (org/partner names,
// tester names, deployment phone numbers). Env-var names like SUPABASE_SERVICE_ROLE_KEY are
// legitimate and intentionally NOT listed here.
const INTERNAL_RE = /\b(?:Taleemabad|TaleemHub|Rawalpindi|Silverleaf|Junaid|Aloyce|Shams|Attar)\b|\+92\d|\+255\d|\b0?329[\s-]?5012345\b|\b5012345\b/i;

// Agent-native markdown: progressive-disclosure routers + skill docs (all public).
function collectAgentDocs() {
  const docs = [];
  for (const top of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(ROOT, top);
    if (fs.existsSync(p)) docs.push(p);
  }
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue;
        walk(p);
      } else if (e.name === 'CLAUDE.md') {
        docs.push(p);
      }
    }
  };
  walk(ROOT);
  // every .md under .claude/ (skill docs)
  const claudeDir = path.join(ROOT, '.claude');
  if (fs.existsSync(claudeDir)) {
    const walkMd = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walkMd(p); }
        else if (e.name.endsWith('.md')) docs.push(p);
      }
    };
    walkMd(claudeDir);
  }
  return [...new Set(docs)];
}

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

  describe('agent-native docs carry no internal refs or context', () => {
    it('CLAUDE.md routers + AGENTS.md + .claude/**/*.md are free of ticket refs and internal context', () => {
      const offenders = [];
      for (const f of collectAgentDocs()) {
        const lines = fs.readFileSync(f, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (REF_RE.test(line) || INTERNAL_RE.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
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
