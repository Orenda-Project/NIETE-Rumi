/**
 * bd-2554 — the staging build type must be testable AND unshippable.
 *
 * A staging app has two jobs that pull in opposite directions:
 *
 *   1. Be as close to the Play artifact as possible — same RELEASE build type
 *      (minify, proguard, resource shrinking), because the bugs that reach
 *      production are the ones that only appear in a release build. A debug
 *      APK does not exercise that path at all.
 *
 *   2. Be incapable of BECOMING the Play artifact. Two ways that could go
 *      wrong, both silent:
 *        - it takes the production applicationId, so installing it replaces
 *          the real NIETE app on a teacher's phone;
 *        - it gets signed with the inherited NIETE release key, so it could be
 *          uploaded to the listing.
 *
 * The guard for (2) is structural: `.staging` applicationIdSuffix so it can
 * never claim `pk.edu.niete`, and the DEBUG signing key so Play would reject
 * it even if someone tried. The release key stays out of every non-production
 * workflow.
 *
 * Reading build.gradle as text matches the sibling suites
 * (android-release-identity.test.js): the failure is a one-line edit here, and
 * asserting on the file is what catches it before a build.
 */
const fs = require('fs');
const path = require('path');

const GRADLE = path.join(__dirname, '../../portal/android/app/build.gradle');
const source = fs.readFileSync(GRADLE, 'utf8');

/** The build.gradle body of a named buildTypes block. */
function buildTypeBlock(name) {
  const start = source.indexOf(`${name} {`, source.indexOf('buildTypes'));
  if (start === -1) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

/** Strip comments so prose about `.staging` can't satisfy a match. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('bd-2554 — the staging build type exists', () => {
  it('declares a staging buildType', () => {
    expect(buildTypeBlock('staging')).not.toBe('');
  });

  it('is derived from release, so it exercises the shipped build path', () => {
    // initWith release inherits minify/proguard/shrinking — the point of a
    // staging build is that it differs from the Play artifact in ONE variable
    // (the backend), not in how it was compiled.
    const staging = stripComments(buildTypeBlock('staging'));
    expect(staging).toMatch(/initWith\s+buildTypes\.release/);
  });
});

describe('bd-2554 — a staging build can never become the Play artifact', () => {
  const staging = stripComments(buildTypeBlock('staging'));

  it('carries a .staging applicationIdSuffix', () => {
    // Without this it would install OVER the real NIETE app on a teacher's
    // phone, because Android identifies an app solely by applicationId.
    expect(staging).toMatch(/applicationIdSuffix\s+["']\.staging["']/);
  });

  it('is signed with the DEBUG key, never the inherited NIETE release key', () => {
    expect(staging).toMatch(/signingConfig\s+signingConfigs\.debug/);
    expect(staging).not.toMatch(/signingConfigs\.release/);
  });

  it('is labelled distinctly so testers can tell three installs apart', () => {
    expect(staging).toMatch(/manifestPlaceholders\s*=\s*\[appLabel:/);
  });
});

describe('bd-2554 — release and debug are unaffected', () => {
  it('release still carries NO applicationIdSuffix', () => {
    // Re-asserted here because adding a build type is exactly when someone
    // moves a suffix to the wrong block.
    expect(stripComments(buildTypeBlock('release'))).not.toMatch(/applicationIdSuffix/);
  });

  it('release still signs with the NIETE release key when configured', () => {
    expect(stripComments(buildTypeBlock('release'))).toMatch(/signingConfigs\.release/);
  });

  it('debug still carries the .debug suffix', () => {
    expect(stripComments(buildTypeBlock('debug'))).toMatch(
      /applicationIdSuffix\s+["']\.debug["']/
    );
  });

  it('the three build types take three distinct applicationIds', () => {
    const suffixes = ['debug', 'staging'].map((t) => {
      const m = stripComments(buildTypeBlock(t)).match(/applicationIdSuffix\s+["']([^"']+)["']/);
      return m && m[1];
    });
    expect(suffixes).toEqual(['.debug', '.staging']);
    // release has none, so: pk.edu.niete / .debug / .staging — all installable
    // side by side on one handset.
    expect(new Set(suffixes).size).toBe(2);
  });
});
