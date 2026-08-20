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

// Internal ticket namespaces. Includes the dashboard's own `plt-*` / `etv-*` bead
// prefixes (they leaked through `Bead:` comment headers + SQL migration headers because
// the original guard only knew bd-/BUG-/PROJ-/FEAT-/TASK- and never scanned .sql).
const REF_RE = /\b(?:bd-\d+|BUG-\d+|PROJ-\d+|FEAT-\d+|TASK-\d+|plt-[a-z0-9]+|etv-[a-z0-9]+|[Bb][Uu][Gg]\s*#\d+)\b/;

// Internal context that must never appear in public agent-native docs (org/partner names,
// tester names, deployment phone numbers). Env-var names like SUPABASE_SERVICE_ROLE_KEY are
// legitimate and intentionally NOT listed here.
const INTERNAL_RE = /\b(?:Taleemabad|TaleemHub|Rawalpindi|Silverleaf|Junaid|Aloyce|Shams|Attar)\b|\+92\d|\+255\d|\b0?329[\s-]?5012345\b|\b5012345\b/i;

// `.claude/skills/data-standards/**` is the Data Team's schema-standards skill,
// vendored in VERBATIM from their repo and never edited here — CI proves that
// separately (scripts/data-standards-verify.sh, which fails hard on any local
// modification). Their own docs name the org, which INTERNAL_RE forbids, and we
// cannot patch their files without breaking the "vendored, unmodified" contract
// that makes the skill theirs to own.
//
// So vendored files get a REDUCED internal check: the org name is allowed (it is
// already public in this repo's own root CLAUDE.md and is not the leak this guard
// exists to stop), while everything that genuinely matters stays enforced —
// ticket refs (REF_RE, applied unchanged), partner and tester names, and real
// deployment phone numbers. If an upstream refresh ever introduces one of those,
// this guard still catches it before the copy lands.
const VENDORED_PREFIX = path.join('.claude', 'skills', 'data-standards') + path.sep;
const VENDORED_INTERNAL_RE = /\b(?:TaleemHub|Rawalpindi|Silverleaf|Junaid|Aloyce|Shams|Attar)\b|\+92\d|\+255\d|\b0?329[\s-]?5012345\b|\b5012345\b/i;
const internalReFor = (relPath) =>
  relPath.startsWith(VENDORED_PREFIX) ? VENDORED_INTERNAL_RE : INTERNAL_RE;

// A real secret assigned to a credential variable — a UUID or a long contiguous
// high-entropy value (a live RAILWAY_ACCOUNT_TOKEN UUID once leaked into a doc and
// gitleaks didn't flag it, because docs were path-allowlisted and a bare UUID isn't
// a default rule). This runs in the unit suite as a second layer under gitleaks.
const SECRET_ASSIGN_RE = /(?:token|secret|password|api[_-]?key|access[_-]?token|account[_-]?token|service[_-]?role[_-]?key)["']?\s*[:=]\s*["']?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9]{32,})/i;
// The actual deployment phone numbers (prod PK / TZ) — precise, so synthetic example
// numbers like +92300… in schema docs don't false-positive.
const DEPLOY_PHONE_RE = /\b0?329[\s-]?5012345\b|\b5012345\b|255[\s-]?677[\s-]?095/;
// Placeholders that look secret-ish but are intentional doc examples.
const PLACEHOLDER_RE = /your-[a-z-]*|YOUR_[A-Z_]+|<[a-z][a-z0-9 _-]*>|CHANGEME|need-to-get|example/i;

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

// Every markdown file in the repo (excluding deps, vendored fonts, build output).
function collectAllMarkdown() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue;
        if (p.includes(`${path.sep}bot${path.sep}fonts${path.sep}`) || e.name === 'fonts') continue;
        walk(p);
      } else if (e.name.endsWith('.md')) {
        out.push(p);
      }
    }
  };
  walk(ROOT);
  return out;
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
    it('bot/dashboard/infrastructure source is free of bd-/BUG-/PROJ-/FEAT-/TASK-/plt-/etv-/Bug # refs', () => {
      const files = [
        ...collect('bot', ['.js', '.sql']),
        ...collect('dashboard', ['.js', '.ts', '.tsx', '.sql']),
        ...collect('infrastructure', ['.js', '.sql']),
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

    it('docs/flows/*.json carry no internal ticket refs or authoring metadata (_bead/_changelog)', () => {
      const flowsDir = path.join(ROOT, 'docs', 'flows');
      const offenders = [];
      if (fs.existsSync(flowsDir)) {
        for (const name of fs.readdirSync(flowsDir).filter((n) => n.endsWith('.json'))) {
          const raw = fs.readFileSync(path.join(flowsDir, name), 'utf-8');
          if (REF_RE.test(raw)) offenders.push(`${name}: ticket ref`);
          if (/"_bead"|"_changelog"/.test(raw)) offenders.push(`${name}: _bead/_changelog metadata`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('agent-native docs carry no internal refs or context', () => {
    it('CLAUDE.md routers + AGENTS.md + .claude/**/*.md are free of ticket refs and internal context', () => {
      const offenders = [];
      for (const f of collectAgentDocs()) {
        const rel = path.relative(ROOT, f);
        const internalRe = internalReFor(rel);
        const lines = fs.readFileSync(f, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (REF_RE.test(line) || internalRe.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
      expect(offenders).toEqual([]);
    });

    // The vendored-skill exemption above is a deliberate hole in a guard that
    // protects a public repo. These assertions pin how narrow it is, so a later
    // "just add one more name" widening fails here instead of silently shipping.
    describe('the vendored-skill exemption stays narrow', () => {
      it('only applies to the vendored skill path', () => {
        expect(internalReFor('.claude/skills/data-standards/SKILL.md')).toBe(VENDORED_INTERNAL_RE);
        expect(internalReFor('.claude/skills/coaching/SKILL.md')).toBe(INTERNAL_RE);
        expect(internalReFor('CLAUDE.md')).toBe(INTERNAL_RE);
        expect(internalReFor('.claude/CLAUDE.md')).toBe(INTERNAL_RE);
      });

      it('still catches deployment phone numbers inside the vendored path', () => {
        expect(VENDORED_INTERNAL_RE.test('call +92300000000')).toBe(true);
        expect(VENDORED_INTERNAL_RE.test('the number is +255677095937')).toBe(true);
        expect(VENDORED_INTERNAL_RE.test('bot at 0329 5012345')).toBe(true);
      });

      it('still catches partner and tester names inside the vendored path', () => {
        for (const name of ['TaleemHub', 'Rawalpindi', 'Silverleaf', 'Junaid', 'Aloyce', 'Shams', 'Attar']) {
          expect(VENDORED_INTERNAL_RE.test(`something ${name} something`)).toBe(true);
        }
      });

      it('exempts the org name and nothing else', () => {
        // The one and only difference from INTERNAL_RE.
        const orgOnly = 'audit against the org data standards';
        expect(INTERNAL_RE.test('against Taleemabad standards')).toBe(true);
        expect(VENDORED_INTERNAL_RE.test('against Taleemabad standards')).toBe(false);
        expect(VENDORED_INTERNAL_RE.test(orgOnly)).toBe(false);
      });

      it('leaves ticket-reference detection fully enforced everywhere', () => {
        // REF_RE is applied unchanged to vendored files; assert it still bites.
        expect(REF_RE.test('see bd-1234 for context')).toBe(true);
        expect(REF_RE.test('FEAT-99 tracked this')).toBe(true);
      });
    });
  });

  describe('no hardcoded secrets or deployment PII in ANY markdown', () => {
    // Broader than the agent-docs guard above: scans EVERY .md (README, docs/,
    // bot/**, dashboard/**, portal/**) for real credential values and the actual
    // deployment phone numbers — the class that leaked via dashboard/docs and that
    // gitleaks' docs-path allowlist had been skipping.
    it('every .md is free of credential-assignment secrets and real deployment numbers', () => {
      const offenders = [];
      for (const f of collectAllMarkdown()) {
        const lines = fs.readFileSync(f, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          if (PLACEHOLDER_RE.test(line)) {
            // strip the placeholder token, then re-test the remainder
            const stripped = line.replace(new RegExp(PLACEHOLDER_RE.source, 'ig'), '');
            if (SECRET_ASSIGN_RE.test(stripped) || DEPLOY_PHONE_RE.test(stripped)) {
              offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
            }
            return;
          }
          if (SECRET_ASSIGN_RE.test(line) || DEPLOY_PHONE_RE.test(line)) {
            offenders.push(`${path.relative(ROOT, f)}:${i + 1}`);
          }
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
