# .claude/ — Agent & skill config (L1)

**Parent:** [../CLAUDE.md](../CLAUDE.md) · Claude Code configuration for this repo.

## What's here

| Path | Purpose |
|------|---------|
| `skills/<name>/SKILL.md` | On-demand domain knowledge an agent loads when a task matches |
| `settings.json` | MCP servers (e.g. Supabase) — secrets via `${ENV_VAR}` interpolation, never inline |

## Skills

Skills are loaded **on demand** — keep this router lean and let the skill hold the depth. Each skill is a
folder with a `SKILL.md` (+ optional reference files).

| Skill | Use for |
|-------|---------|
| `setup` | Guided clone setup — env, DB bootstrap, flow registration, preflight (`/setup`) |

> **More skills are being ported from the production bot in batches** (operational core: coaching,
> reading-assessment, registration, whatsapp-flows, debugging, cross-agent-safety, qa-testing,
> video-generation, feature-tracer, pre-merge-checklist, database-analysis, logging, ab-testing,
> digital-coach). Each is hand-reviewed and stripped of any internal/credential content before it lands —
> CI (gitleaks + the source-hygiene guard) enforces that no secrets or internal references ship.

## Rules for adding/editing skills here

1. **No secrets, no internal references.** Skill markdown is public. Use env-var names and placeholders, never
   real keys, phone numbers, org names, or internal ticket IDs. The `tests/setup/source-hygiene.test.js` guard
   scans `.claude/**/*.md` and fails the build on a violation.
2. **Generic, not deployment-specific.** Describe how the open platform works, not how one operator runs it.
3. **Point, don't duplicate.** A skill should reference code by path, not paste large code blocks that go stale.
