/**
 * bd-2555 — the served portal bundle must be BUILT, not hand-copied.
 *
 * THE BUG. dashboard/index.js serves the SPA with
 * `express.static(dashboard/portal-frontend/dist)`, and that dist is a
 * COMMITTED git artifact: `.gitignore` ignores `dist/` globally, then negates
 * this one folder back in. Getting a portal change live therefore required a
 * human to run `cd portal && npm run build && cp -r dist
 * ../dashboard/portal-frontend/` and commit the output. Railway never built
 * anything — the portal service had rootDirectory=/dashboard, so portal/
 * source was not even in the build context.
 *
 * When that copy is forgotten, the PR merges, CI goes green, and production
 * keeps serving the previous bundle. Verified on 2026-08-12: prod and staging
 * both served index-B5CZg4UE.js (committed 08-06) while a fresh build of the
 * same source produced index-Bj-YL33i.js — 122KB apart. The i18n Phase 5.x
 * work was half-live: the server route shipped, the frontend calling it did
 * not. And it was not the first time — commit 5075607 is literally
 * "rebuild SPA dist — #87 was merged but never shipped".
 *
 * Same root cause as bd-2551: a build step that depends on a human
 * remembering. The fix is to make the build a real build.
 *
 * These tests pin the contract:
 *   1. A build command exists and produces the served directory.
 *   2. It is wired into the repo's own scripts, so CI and Railway run the
 *      SAME command a developer would.
 *   3. The build output directory is no longer a committed artifact.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '../..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

/** Files git actually tracks under a path. */
function trackedUnder(relPath) {
  try {
    const out = execFileSync('git', ['ls-files', relPath], { cwd: REPO, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('bd-2555 — the portal build is a real build', () => {
  it('the repo exposes a build:portal script', () => {
    // Railway, CI and a developer must be able to run ONE command. If the
    // build lives only in a Railway text box, nobody can reproduce a deploy.
    expect(rootPkg.scripts).toHaveProperty('build:portal');
  });

  it('build:portal builds the portal and emits into the served directory', () => {
    const cmd = rootPkg.scripts['build:portal'];
    // It must target where the server actually reads from
    // (dashboard/index.js: express.static(portal-frontend/dist)).
    expect(cmd).toMatch(/portal-frontend\/dist/);
  });

  it('build:portal installs the dashboard runtime dependencies', () => {
    // Moving rootDirectory from /dashboard to the repo root changed which
    // package.json Railway installs: the ROOT one (3 deps), not dashboard's
    // (24, including dotenv). The first deploy built fine and then crash-
    // looped on `Cannot find module 'dotenv'` — the build succeeded, the
    // healthcheck never came up.
    //
    // The bot and worker services already solve this the same way
    // (`npm install --prefix bot`).
    const cmd = rootPkg.scripts['build:portal'];
    expect(cmd).toMatch(/--prefix dashboard/);
  });

  it('the dashboard declares the deps its server actually requires', () => {
    // Guards the other half: if dotenv ever stops being a dashboard dep, the
    // install above cannot save it.
    const dashPkg = JSON.parse(
      fs.readFileSync(path.join(REPO, 'dashboard/package.json'), 'utf8')
    );
    expect(dashPkg.dependencies).toHaveProperty('dotenv');
    expect(dashPkg.dependencies).toHaveProperty('express');
  });

  it('the Railway build command is committed, not just typed into a dashboard', () => {
    // Railway service config lives in Railway, not the repo, so it is recorded
    // here to stay reviewable and diffable. A build command that exists ONLY
    // in a Railway text box cannot be code-reviewed and silently drifts.
    //
    // It is a SEPARATE file from railpack.json on purpose: railpack.json is
    // shared by every service in this repo (bot, workers, portal), so a build
    // step added there would make the bot build the portal too.
    const contract = JSON.parse(fs.readFileSync(path.join(REPO, 'railpack.portal.json'), 'utf8'));
    expect(contract.buildCommand).toMatch(/build:portal/);
    // rootDirectory MUST be the repo ROOT: with /dashboard the portal source
    // is not in the build context at all, which is what made the hand-copy
    // necessary in the first place.
    //
    // Both spellings mean repo root. The bot/worker services store null, but
    // the Railway API does NOT clear the field when sent null — it silently
    // left the portal at /dashboard — so "/" is the value that actually takes.
    // Accept either; reject anything that scopes the build to a subdirectory.
    expect([null, '/', '']).toContain(contract.rootDirectory);
    expect(contract.startCommand).toMatch(/dashboard\/entrypoint\.js/);
  });
});

describe('bd-2555 — the built bundle is no longer a committed artifact', () => {
  it('no built JS/CSS assets are tracked in git', () => {
    // This is the actual bug: a committed bundle is a bundle that goes stale
    // silently. Once Railway builds it, tracking it serves no purpose and
    // reintroduces the drift the moment someone forgets to refresh it.
    const tracked = trackedUnder('dashboard/portal-frontend/dist');
    const builtAssets = tracked.filter((f) => /\.(js|css)$/.test(f));
    expect(builtAssets).toEqual([]);
  });

  it('the dist directory is gitignored rather than force-included', () => {
    const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    // The negation lines are what forced the artifact into the repo.
    expect(gitignore).not.toMatch(/^\s*!dashboard\/portal-frontend\/dist/m);
  });
});
