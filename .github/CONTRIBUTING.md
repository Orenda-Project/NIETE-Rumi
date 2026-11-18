# Contributing to Rumi

Thank you for your interest in contributing to Rumi!

## Contributing with your agent

For team members who change this repo (mostly the portal) with their own coding agent, such as Claude Code.
Point your agent at this section first; the principles behind it are in the team skill pack's `niete-portal-v2`
skill (reuse, design system, WhatsApp vs page, switches, scoping, tracking, testing).

**Set up once**

1. Node 22. Clone this repo, then `npm ci` at the root and `npm ci --prefix portal`.
2. Save the sandbox contributor env file you were given as `.env.sandbox` in the clone's root (it is gitignored;
   keep it private, `chmod 600`). It holds the sandbox database and file store only. Use it and nothing else:
   **never** use, create or ask for `.env`, `.env.prod` or `.env.stage`. Those are staging and production, and a
   contributor's agent never reads them. A script that asks for an environment gets `--env sandbox`.
3. To see the portal on your laptop: `bash scripts/dev-portal.sh up` (macOS or Linux; on Windows use WSL2). It runs
   on a local database of made-up data; add `DATA=demo` if you have no sandbox copy. It never reads your env files.

**Every change**

1. Branch from sandbox: `git fetch origin && git switch -c <you>/<topic> origin/sandbox`. One change per branch.
2. Write the failing test first, then the change. New behaviour starts OFF behind an `app_settings` switch.
   Data follows the same rule as screens: extend an existing table (a region, organization, grade-band or kind
   column) instead of adding a parallel one per region, grade or feature, and give any new table a one-line reason
   in the PR. Lesson plans show why: `docs/lesson-plan-data-model-debt.md`.
3. Open a PR into `sandbox` and fill in the template. When CI is green, merge it into `sandbox` and try it on the
   sandbox portal and bot with your test account. A check that is already red on `sandbox` itself must fail the
   same way on your PR, never more: compare with the latest CI run on the `sandbox` branch.
4. Tick **Ready for review** in the PR and send its link to the product owner in a direct message (there is no
   channel for this). The core team carries it to `staging` and production with the product owner's go; never
   push to or open a PR into `staging` or `main`.

**Data and privacy**

- Sandbox only, and test accounts only ("<Name> Testwala" in the synthetic test schools).
- The sandbox holds dummy people only: names end in "Dummy" and four digits, phone numbers sit in Pakistan's
  unallocated 0399 block, and personal recordings and photos are gone. Only the team's own test accounts keep real
  numbers. Never import real people into it (the import scripts refuse the sandbox); if real data ever shows up,
  `scripts/sandbox-pii-purge.py` scrubs it again.
- Read only what the task needs, never copy records out, and never put a real name, phone number or key in code,
  tests, screenshots, commits or PRs. This repo is public, and CI checks for them.

## Contributing from outside the team

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/rumi-platform.git`
3. Create a branch: `git checkout -b feature/your-feature`
4. Make changes
5. Run tests: `npm test`
6. Push and create a Pull Request

## Development Setup

```bash
cp .env.template .env
# Fill in at least the minimal tier values
cd bot && npm install && cd ..
npm run validate:env
npm run simulate  # Test without WhatsApp
```

## Code Style

- Node.js CommonJS (require/module.exports)
- No TypeScript in bot/ (portal/ uses TypeScript)
- Use branding.js for customizable strings
- Use `bot/shared/config/feature-availability.js` for presence-based feature gating
- Use llm-client.js for all AI calls

## Testing

Write tests for new features. Follow the existing TDD pattern:

1. Write tests in `tests/unit/sprint-X/`
2. Run with `npm run test:sprintX`
3. Ensure all existing tests still pass: `npm test`

## Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] No hardcoded credentials
- [ ] No Taleemabad-specific content in code
- [ ] Feature gated with `isFeatureEnabled()` if tier-dependent
- [ ] Updated `.env.template` if new env vars needed
