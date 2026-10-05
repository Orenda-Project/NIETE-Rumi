/**
 * Bot self-name hygiene guard (bd-2365 / OPS-114).
 *
 * The bot's self-name is env-driven: `bot/shared/config/branding.js` exposes
 * `botName` (from `process.env.BOT_NAME`, default 'Rumi' for the open-source
 * template). Teacher-facing surfaces — WhatsApp message text, menu greetings,
 * portal invites, PDF/HTML report footers, and the LLM *identity* system
 * prompts that decide what the model calls itself — MUST route the name
 * through `botName` (or, for a single-tenant fork, use the deployment's own
 * name), NEVER hardcode the literal template name "Rumi".
 *
 * Why this guard exists: setting `BOT_NAME` alone does NOT rename the bot,
 * because only ~21 files consume `branding.botName`. 37 LLM-identity prompts
 * ("You are Rumi, …") and 30 hardcoded template strings ("Powered by Rumi",
 * "I'm Rumi", "your Rumi portal") bypass `botName` entirely. This scan is the
 * ratchet that keeps them renamed — a fork that sets BOT_NAME="NIETE Teaching
 * Assistant" must not still self-identify as "Rumi" in a generated Urdu reply.
 *
 * Scope: user-facing modules only — `bot/shared/{handlers,services,config,
 * templates,routes}` + `bot/whatsapp-bot.js`. Dev tooling (`bot/scripts/`),
 * tests, and dashboard are out of scope. Comment lines and URL/infra literals
 * (repo host `niete-rumi.local`, `X-Title`, `HTTP-Referer`, bucket paths) are
 * ignored — the guard only cares about the self-NAME token inside a string.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const SCANNED_ROOTS = [
  path.join(ROOT, 'bot', 'shared', 'handlers'),
  path.join(ROOT, 'bot', 'shared', 'services'),
  path.join(ROOT, 'bot', 'shared', 'config'),
  path.join(ROOT, 'bot', 'shared', 'templates'),
  path.join(ROOT, 'bot', 'shared', 'routes'),
];
const SCANNED_FILES = [path.join(ROOT, 'bot', 'whatsapp-bot.js')];

// `branding.js` is the DEFINITION of the name; its `|| 'Rumi'` open-source
// template default is intentional (env overrides it) and must not be flagged.
// `web-quiz-brand.js` is the web quiz's brand TABLE: each brand's name is data a
// deployment selects by configuration (app_settings / ORG_NAME), not a self-name.
const SKIP_FILES = new Set([
  path.join(ROOT, 'bot', 'shared', 'config', 'branding.js'),
  path.join(ROOT, 'bot', 'shared', 'config', 'web-quiz-brand.js'),
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__mocks__', '__snapshots__']);

// The template self-name token that must not be hardcoded in user-facing source
// — Latin "Rumi" and its Urdu/regional transliteration "رومی".
const SELF_NAME_RE = /\bRumi\b|رومی/;

// Lines we never flag. Three buckets, none of which is teacher-facing NAME text:
//  1. infra/URL literals — repo host, HTTP header, bucket path, log dataset;
//  2. logo IMAGE assets + <img alt> — the bitmap is a separate branding artifact
//     (swapping the logo file is out of scope for a text rename; tracked in the
//     deliverable as a known gap), and alt text is not teacher-visible copy;
//  3. boot/health/service identifiers — console banners + the /health JSON id,
//     internal-only strings a teacher never sees.
const IGNORE_LINE_RE = new RegExp([
  'niete-rumi', 'rumi-logs', 'X-Title', 'HTTP-Referer', 'https?://', '\\.r2\\.', 'hellorumi', // 1
  'RUMI_LOGO', 'Rumi Transparent', 'Rumi Logo', 'header-logo', 'rumi-logo', '_logoB64', '_logoCache', 'readBase64', 'alt=\\\\?["\'`]?Rumi', // 2
  'boot aborted', 'Rumi WhatsApp Bot', // 3
  //  4. the coach-role-label default "Rumi Digital Coach" / "رومی ڈیجیٹل کوچ" —
  //     the observer-name on coaching reports flows through its OWN env knob
  //     (DEFAULT_COACH_ROLE_LABEL / REGION_COACH_ROLE_LABEL_MAP in region-config.js),
  //     not BOT_NAME. NIETE overrides it via env; the code default stays the
  //     open-source template identity. Out of scope for this self-name guard.
  'Rumi Digital Coach', 'رومی ڈیجیٹل کوچ',
].join('|'), 'i');
function isCommentOnly(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}
// A self-name only counts if it sits inside a string literal on that line.
function insideStringLiteral(line) {
  return /['"`][^'"`]*(?:\bRumi\b|رومی)/.test(line);
}

// Allowlist: exact project-relative path:line we won't flag, with a reason.
// Empty by default — keep it that way; a real exception must be documented.
const ALLOWLIST = new Map([
  // (no entries)
]);

function findJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findJsFiles(full));
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('Bot self-name hygiene — no hardcoded "Rumi" in teacher-facing source', () => {
  it('every user-facing self-reference routes through botName / the deployment name', () => {
    const files = [...SCANNED_ROOTS.flatMap(findJsFiles), ...SCANNED_FILES];
    const violations = [];

    for (const filePath of files) {
      if (SKIP_FILES.has(filePath)) continue;
      const rel = path.relative(ROOT, filePath);
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (isCommentOnly(line)) return;
        if (IGNORE_LINE_RE.test(line)) return;
        if (!insideStringLiteral(line)) return;
        if (!SELF_NAME_RE.test(line)) return;
        const key = `${rel}:${i + 1}`;
        if (ALLOWLIST.has(key)) return;
        violations.push(`${key} — hardcoded self-name — ${line.trim()}`);
      });
    }

    expect(violations).toEqual([]);
  });

  it('branding.botName reflects BOT_NAME (env-driven, not hardcoded)', () => {
    const prev = process.env.BOT_NAME;
    process.env.BOT_NAME = 'NIETE Teaching Assistant';
    delete require.cache[require.resolve('../../bot/shared/config/branding.js')];
    const branding = require('../../bot/shared/config/branding.js');
    expect(branding.botName).toBe('NIETE Teaching Assistant');
    // restore
    if (prev === undefined) delete process.env.BOT_NAME;
    else process.env.BOT_NAME = prev;
    delete require.cache[require.resolve('../../bot/shared/config/branding.js')];
  });
});
