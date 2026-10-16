/**
 * Startup Smoke Test — catches missing imports before a deploy.
 *
 * Requires the bot entry, the SQS workers and the dashboard/portal server routes and checks
 * each one loads without ReferenceError, TypeError, SyntaxError or a missing module. Nothing
 * is started: whatsapp-bot.js and sqs-worker.js gate their servers behind
 * `require.main === module`, and dashboard/index.js is left out because it calls
 * app.listen() on load — its routes are required instead.
 *
 * No network, no DB: the credentials the modules read at load are forced to placeholders
 * (and the connection URLs blanked) before anything is required, so a real .env is never
 * picked up by dotenv.
 *
 * Usage: node scripts/smoke-test.js      (npm run smoke)
 *   SMOKE_MODULES=a.js,b.js overrides the list (paths from the repo root) — used by the test.
 *
 * Modelled on 02_Main Rumi Bot/scripts/smoke-test.js (bd-757). bd-v0toag.71.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

const MODULES = [
  // Bot entry (server start gated behind require.main)
  'bot/whatsapp-bot.js',

  // SQS workers (sqs-worker.js gates its poll loop behind require.main)
  'bot/workers/sqs-worker.js',
  'bot/workers/quiz-job-handler.js',
  'bot/workers/attendance-bigquery-export.worker.js',
  'bot/workers/exam-grading.worker.js',
  'bot/workers/homework-bundle.worker.js',
  'bot/workers/lesson-plan-extraction.worker.js',
  'bot/workers/lesson-plan-generation.worker.js',
  'bot/workers/lp612-author.worker.js',
  'bot/workers/pic-lp-kieai.worker.js',
  'bot/workers/remark-narrative-retry.worker.js',
  'bot/workers/stale-session.worker.js',
  'bot/workers/video-generation.worker.js',

  // Dashboard + portal server (dashboard/index.js listens on load, so its routes instead)
  'dashboard/config/database.js',
  'dashboard/routes/api-health.routes.js',
  'dashboard/routes/app-funnel.routes.js',
  'dashboard/routes/app-login.routes.js',
  'dashboard/routes/attendance.routes.js',
  'dashboard/routes/billing.routes.js',
  'dashboard/routes/byof.routes.js',
  'dashboard/routes/coach-card.routes.js',
  'dashboard/routes/coaching-report.routes.js',
  'dashboard/routes/funnel-tracking.routes.js',
  'dashboard/routes/hcp.routes.js',
  'dashboard/routes/portal.routes.js',
  'dashboard/routes/portal-share.routes.js',
  'dashboard/routes/portal-teacher-attendance.routes.js',
  'dashboard/routes/portal-teacher-coaching.routes.js',
  'dashboard/routes/portal-teacher-lessons.routes.js',
  'dashboard/routes/portal-teacher-notices.routes.js',
  'dashboard/routes/portal-teacher-thing-to-try.routes.js',
  'dashboard/routes/settings.js',
  'dashboard/routes/teacher-report.routes.js',
  'dashboard/routes/web-quiz.routes.js',
  'dashboard/routes/web-quiz-canonical.js',
  'dashboard/routes/web-quiz-preview.js',
  'dashboard/routes/wordcloud.js',
];

// Set before any require so config/supabase (process.exit(78) without them) and the LLM
// SDK constructors load, and dotenv cannot fill in a real value from .env.
const PLACEHOLDER_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_SERVICE_ROLE_KEY: 'smoke-test',
  SUPABASE_ANON_KEY: 'smoke-test',
  OPENAI_API_KEY: 'smoke-test',
  ANTHROPIC_API_KEY: 'smoke-test',
  GEMINI_API_KEY: 'smoke-test',
  GOOGLE_API_KEY: 'smoke-test',
  REDIS_URL: '',
  DATABASE_URL: '',
  AXIOM_TOKEN: '',
  AXIOM_DATASET: '',
};

// Local requires that are optional by design: wrapped in try/catch with a fallback, so an
// unresolved path is not a deploy break. Key is `<source file>:<request>`.
const OPTIONAL_REQUIRES = new Set([
  // Gamma "Detailed" arm — the prompt builder is not in this bundle; falls back to Kie.ai.
  'bot/shared/services/pic-to-lp/lp-handoff.service.js:../lesson-plan-prompts.service',
]);

// Commented-out requires (block comments, whole-line // comments) are not loaded.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function getTrackedFiles(failures) {
  try {
    const out = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.split('\n').filter(Boolean));
  } catch (error) {
    failures.push({ name: 'git-tracked-files', error: `Unable to read tracked files: ${error.message}` });
    return new Set();
  }
}

function resolveLocalRequire(fromFile, request) {
  try {
    return require.resolve(request, { paths: [path.dirname(fromFile)] });
  } catch (error) {
    return null;
  }
}

// Every local require reachable from the listed modules must resolve to a git-tracked file —
// an untracked file loads here but is missing from the deploy.
function preflightRelativeRequireTracking(modules, failures) {
  const trackedFiles = getTrackedFiles(failures);
  if (trackedFiles.size === 0) return;
  const visited = new Set();
  const requireRegex = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const queue = modules.map(m => path.resolve(repoRoot, m)).filter(p => fs.existsSync(p));

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath) || !fs.existsSync(filePath)) continue;
    visited.add(filePath);

    const fileText = stripComments(fs.readFileSync(filePath, 'utf8'));
    const sourceRel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    requireRegex.lastIndex = 0;
    let match = requireRegex.exec(fileText);
    while (match) {
      const request = match[1];
      const resolved = resolveLocalRequire(filePath, request);
      if (!resolved) {
        if (OPTIONAL_REQUIRES.has(`${sourceRel}:${request}`)) {
          match = requireRegex.exec(fileText);
          continue;
        }
        failures.push({ name: `require-resolution:${sourceRel}`, error: `Cannot resolve local require('${request}')` });
      } else {
        const resolvedRel = path.relative(repoRoot, resolved).replace(/\\/g, '/');
        if (!trackedFiles.has(resolvedRel)) {
          failures.push({
            name: `require-tracked:${sourceRel}`,
            error: `Local require('${request}') resolves to untracked file '${resolvedRel}'`,
          });
        } else if (resolved.endsWith('.js') && !resolved.includes('/node_modules/')) {
          queue.push(resolved);
        }
      }
      match = requireRegex.exec(fileText);
    }
  }
}

function runSmoke(modules, { preflight = true } = {}) {
  const failures = [];
  if (preflight) preflightRelativeRequireTracking(modules, failures);
  let passed = 0;
  for (const rel of modules) {
    try {
      require(path.resolve(repoRoot, rel));
      passed++;
    } catch (error) {
      failures.push({ name: rel, error: error.message.split('\n')[0] });
    }
  }
  return { passed, failed: failures.length, failures };
}

function main() {
  Object.assign(process.env, PLACEHOLDER_ENV);
  const override = (process.env.SMOKE_MODULES || '').split(',').map(s => s.trim()).filter(Boolean);
  const modules = override.length ? override : MODULES;

  console.log('🔍 Running startup smoke test...\n');
  const { passed, failed, failures } = runSmoke(modules);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Smoke test: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    console.log('\n🚨 BLOCKING: Fix import errors before deploying!\n');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
    process.exit(1);
  }
  console.log('\n✅ All modules load successfully.\n');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { MODULES, PLACEHOLDER_ENV, runSmoke, stripComments };
