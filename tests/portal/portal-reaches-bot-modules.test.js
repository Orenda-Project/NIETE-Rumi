/**
 * bd-60085 — a portal route may not crash on a module the portal service cannot resolve.
 *
 * THE BUG, as the operator met it: saving your grades in Teacher Training answered 500.
 *
 *   POST /training/bands
 *   Error: Cannot find module 'dotenv'
 *   Require stack:
 *     /app/bot/shared/config/supabase.js
 *     /app/bot/shared/services/training/band-selection.service.js
 *     /app/dashboard/routes/portal.routes.js
 *
 * WHY IT IS NOT A MISSING DEPENDENCY. `dashboard/package.json` declares both `dotenv` and
 * `@supabase/supabase-js`, and they are installed. Node resolves from the REQUIRING FILE'S
 * directory, so `/app/bot/shared/config/supabase.js` looks in `/app/bot/node_modules`, then
 * `/app/node_modules` — and never in `/app/dashboard/node_modules`, where they actually are.
 * The portal service builds with `npm install` at the repo root, whose package.json declares
 * four packages and not these; `bot/` is never installed on that service at all.
 *
 * So any bot module the portal reaches WHOSE OWN TRANSITIVE REQUIRES include a bot-only package
 * is a 500 waiting for a teacher to find it. `band-selection` already carries a `deps()` lazy
 * require added for exactly this class of problem — but lazy only moved the failure from module
 * load to call time. The route still dies, just later and only for the teacher who pressed save.
 *
 * THREE ROUTES ARE AFFECTED, not the one that was reported:
 *   POST /training/bands      → band-selection.service    (reported)
 *   PUT  /me/language         → language-cache            (latent)
 *   capstone submit/grade     → capstone-delivery.service (latent; staging-only today)
 *
 * WHAT THIS TEST DOES. It resolves the require graph the way Node does — from each file's own
 * directory — and asserts that nothing the portal can reach ends up needing a package that the
 * portal service cannot see. It is a static walk on purpose: the alternative is booting the
 * dashboard with bot/node_modules deleted, which no CI job is shaped to do, and which would
 * only ever cover the routes someone remembered to exercise.
 *
 * WHY IT IS SCOPED TO A LIST RATHER THAN TO EVERYTHING. The first run of this walk reported
 * **129 findings across 14 bot modules** — pino, pdfkit, the AWS SDK, axios and more, most of
 * it long-standing coupling that predates this bug by months and is already routed around at
 * runtime (certificates, training rules and the LP catalogue all reach the bot over the
 * internal API for exactly this reason: see the docblock in
 * `dashboard/services/certificates.service.js`, which calls module resolution "not a style
 * choice" but the forcing constraint).
 *
 * Demanding all 129 be fixed here would block a teacher-facing 500 on a large refactor, and a
 * guard that is red for reasons nobody intends to fix teaches everyone to skim past it. So the
 * assertion is an ALLOWLIST THAT MAY ONLY SHRINK: the three modules below are the ones this
 * change fixes, and they must stay clean. Anything NEW is a failure. Removing an entry as its
 * module is migrated is the intended direction of travel.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const PORTAL_ROUTES = path.join(REPO, 'dashboard', 'routes', 'portal.routes.js');

/**
 * Source with comments stripped.
 *
 * These assertions are about what the code DOES. The fix deliberately leaves a comment naming
 * the require it replaced — that history is the point — and a raw-text match would read the
 * explanation as the offence.
 */
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

/**
 * Keep only what actually runs AT IMPORT — i.e. requires at module scope.
 *
 * This is the distinction the whole fix turns on. A require inside a function body does not
 * fire when the module is loaded; it fires if and when that function is called. So a module
 * can hold bot-only requires and still be safely importable by the portal for its pure rules,
 * which is exactly what `deps()` and the lazy `require('./certificate-pdf.service')` inside
 * the certificate branch achieve.
 *
 * Treating those as eager would report a module that is now safe as though it were still
 * broken — and, worse, would make the guard unfixable, so everyone learns to skim it.
 *
 * Brace-depth counting is crude but exactly right for the question being asked: depth 0 is
 * module scope. Strings and comments are stripped first so a brace inside either cannot
 * throw the count off.
 */
function moduleScopeOnly(src) {
  // Comments go first — a brace or quote inside one must not affect either step below.
  const nocomment = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Depth is measured on a copy with string BODIES blanked, so a brace inside a string cannot
  // throw the count off. The ORIGINAL line is what gets kept, though: blanking the copy and
  // then reading requires off it would turn `require('../../config/supabase')` into
  // `require('')` and silently lose every path — which is exactly the hole a mutation test
  // caught here, where re-adding a module-scope Supabase require still passed.
  const masked = nocomment
    .replace(/'(?:[^'\\]|\\.)*'/g, "'x'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"x"')
    .replace(/`(?:[^`\\]|\\.)*`/g, '`x`');

  const realLines = nocomment.split('\n');
  const maskedLines = masked.split('\n');

  const out = [];
  let depth = 0;
  for (let i = 0; i < realLines.length; i += 1) {
    // A require on this line counts only if we are at module scope BEFORE the line runs.
    if (depth === 0) out.push(realLines[i]);
    for (const ch of maskedLines[i] || '') {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
  }
  return out.join('\n');
}

/**
 * Packages the PORTAL SERVICE cannot resolve from inside `bot/`.
 *
 * Deliberately not "every bot dependency": the portal's own node_modules is irrelevant to a
 * file under bot/, so what matters is whether the ROOT package.json — the only install the
 * portal service performs — provides it.
 */
function rootProvided() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);
}

/** Bare specifiers a file requires (skipping relative paths and node: builtins). */
function bareRequires(src) {
  const out = [];
  const re = /require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (spec.startsWith('node:')) continue;
    // The package name, not the deep path: '@scope/pkg/sub' -> '@scope/pkg'.
    out.push(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
  return out;
}

function relativeRequires(src) {
  const out = [];
  const re = /require\(\s*['"](\.[^'"]*)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const BUILTINS = new Set(require('module').builtinModules);

/** Resolve a relative require to a file on disk, the way Node would. */
function resolveFile(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/**
 * Walk everything the portal can reach under bot/, and report each bot-only package with the
 * chain that pulls it in — the chain is the whole value of the report, because the fix is
 * always somewhere along it rather than at the leaf.
 */
function offenders() {
  const provided = rootProvided();
  const src = code(PORTAL_ROUTES);
  const entries = [...new Set(
    (src.match(/require\('(\.\.\/\.\.\/bot\/shared\/[^']+)'\)/g) || [])
      .map((r) => r.match(/'([^']+)'/)[1]),
  )];

  const found = [];
  const seen = new Set();

  const walk = (file, chain) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    const body = moduleScopeOnly(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(REPO, file);

    for (const pkg of bareRequires(body)) {
      if (BUILTINS.has(pkg) || provided.has(pkg)) continue;
      found.push({ pkg, file: rel, chain: [...chain, rel] });
    }
    for (const r of relativeRequires(body)) walk(resolveFile(file, r), [...chain, rel]);
  };

  for (const e of entries) {
    seen.clear();
    walk(resolveFile(PORTAL_ROUTES, e), ['dashboard/routes/portal.routes.js']);
  }
  return found;
}

describe('every bot module the portal reaches is resolvable by the portal service', () => {
  test('the portal service installs only the ROOT package.json', () => {
    // The premise the rest of this file rests on, asserted rather than assumed. If the portal
    // ever gains its own install of bot/, this test should be revisited — not deleted.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const provided = rootProvided();
    expect(Object.keys(pkg.dependencies || {}).length).toBeGreaterThan(0);
    // These two are what the crash was about. They live in dashboard/node_modules, which a file
    // under bot/ can never reach.
    expect(provided.has('dotenv')).toBe(false);
    expect(provided.has('@supabase/supabase-js')).toBe(false);
  });

  /**
   * The three routes that reach the bot in-process for a DATABASE WRITE, which is what makes
   * them fail. Each is a live, teacher-facing path:
   *
   *   POST /training/bands   band-selection.service     the reported 500
   *   PUT  /me/language      language-cache             latent, identical shape
   *   capstone submit/grade  capstone-delivery.service  latent; staging-only today, so it
   *                                                     would have broken on promotion
   */
  /**
   * TWO SHAPES OF FIX, because the two situations differ.
   *
   * DELEGATED — the portal stops requiring the module at all and asks the bot over the internal
   * API. Right when the portal needed the module to do a DATABASE WRITE, which is what drags
   * the Supabase client in. This is the certificates / training-rules / LP-catalogue pattern.
   */
  const DELEGATED = [
    'bot/shared/services/training/band-selection.service.js',
    'bot/shared/utils/language-cache.js',
  ];

  /**
   * LAZY — the module keeps being imported, but its bot-only requires moved inside `deps()`
   * so they do not fire at import. Right when the portal only wants PURE RULES from it:
   * capstone contributes MIN_ANSWER_CHARS, POINTS_PER_QUESTION, meetsAnswerFloor and
   * decideCapstonePass, none of which touch I/O. An HTTP hop for a constant would be worse
   * than the disease, and grading (which does touch the LLM and the DB) is staging-only and
   * out of scope for a bug fix.
   */
  const LAZY = ['bot/shared/services/training/capstone-delivery.service.js'];

  test('the delegated modules are no longer required in-process', () => {
    const src = code(PORTAL_ROUTES);
    const stillRequired = DELEGATED.filter((mod) => {
      const spec = `../../${mod}`.replace(/\.js$/, '');
      return src.includes(`require('${spec}')`);
    });
    expect(stillRequired).toEqual([]);
  });

  test('the lazy module imports cleanly with no bot dependencies present', () => {
    // The real proof, not a source-text match: this test process has no bot/node_modules, which
    // is exactly the deployed portal's condition. Before the fix this require threw
    // "Cannot find module 'dotenv'".
    const mod = path.join(REPO, LAZY[0]);
    // Cleared first: an earlier test in this file may already have loaded it, and a cached
    // module cannot throw. Without this the assertion passes even when the require is broken —
    // a mutation test caught exactly that.
    delete require.cache[require.resolve(mod)];
    let Capstone;
    expect(() => { Capstone = require(mod); }).not.toThrow();

    // And the pure rules the portal actually wants still work.
    expect(typeof Capstone.MIN_ANSWER_CHARS).toBe('number');
    expect(typeof Capstone.POINTS_PER_QUESTION).toBe('number');
    expect(Capstone.meetsAnswerFloor('too short')).toBe(false);
    expect(Capstone.decideCapstonePass({
      answerScores: [5, 5, 5, 5], totalQuestions: 4, totalScore: 20,
    }).is_passed).toBe(true);
  });

  test('neither shape leaves an unresolvable package on a portal path', () => {
    const watched = [...DELEGATED, ...LAZY];
    const bad = offenders().filter((b) => b.chain.some((c) => watched.includes(c)));
    // Reported with the full chain: the leaf is never where the fix goes.
    const report = bad.map((b) => `${b.pkg}\n      via ${b.chain.join('\n       -> ')}`);
    expect(report).toEqual([]);
  });
});
