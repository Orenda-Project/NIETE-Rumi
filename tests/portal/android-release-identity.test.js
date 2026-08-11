/**
 * bd-2395 — the Play release identity is not allowed to drift.
 *
 * Two ways an Android release goes unrecoverably wrong, both silent at build
 * time and only visible once Play rejects the upload (or worse, accepts it):
 *
 *   1. applicationId stops being exactly `pk.edu.niete`. Play identifies a
 *      listing by package name permanently, so a release carrying a suffix
 *      (`.debug`, `.stage`) cannot update the existing app — it would be a
 *      second, unrelated listing. Debug builds DO take a `.debug` suffix so
 *      they can sit beside the real app; the guard is that the suffix stays
 *      inside the debug block and never reaches release.
 *
 *   2. versionCode fails to increase. Play rejects any bundle whose
 *      versionCode is not strictly higher than the live release, so shipping
 *      a fix under a stale code wastes an upload round-trip.
 *
 * Reading build.gradle as text is deliberate: the failure is a one-line edit
 * in that file, and asserting on the file is what catches it before a build.
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

/** Strip line + block comments so prose about `.debug` can't satisfy a match. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('bd-2395 — Android release identity', () => {
  it('applicationId is exactly pk.edu.niete', () => {
    expect(source).toMatch(/applicationId\s+["']pk\.edu\.niete["']/);
  });

  it('the release build type carries NO applicationIdSuffix', () => {
    const release = stripComments(buildTypeBlock('release'));
    expect(release).not.toMatch(/applicationIdSuffix/);
  });

  it('the debug suffix stays scoped to the debug build type', () => {
    const debug = stripComments(buildTypeBlock('debug'));
    expect(debug).toMatch(/applicationIdSuffix\s+["']\.debug["']/);
  });

  // Floor moves with every upload: Play rejects a bundle whose versionCode is
  // not strictly higher than the live release, so this asserts against the
  // highest code that has LEFT this machine, not the highest ever built.
  // 1202 shipped → 1203 uploaded → 1204 built and handed over on 2026-08-06,
  // so the next build — carrying the training-quiz feedback — has to be 1205.
  // Bump this AND the prose above on every upload; a stale comment here is
  // what caused the wasted build at 1203.
  it('versionCode is at least 1205 (1204 handed over; Play needs a higher code)', () => {
    const m = source.match(/versionCode\s+(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(1205);
  });

  it('versionName tracks versionCode', () => {
    const code = source.match(/versionCode\s+(\d+)/)[1];
    const name = source.match(/versionName\s+["']([^"']+)["']/)[1];
    expect(name).toBe(code);
  });

  // bd-2396: Gradle's default output is `app-release.aab` for every build, so
  // two AABs from different versions are indistinguishable once they leave the
  // build directory — and the file that matters is the one being uploaded to
  // Play. Naming the artifact after the versionCode makes it self-identifying.
  //
  // bd-2520 then made it exactly ONE file: the doLast block moves Gradle's
  // `niete-rumi-v<code>-release.aab` onto the versioned name instead of
  // copying it. Nothing in CI or any script reads the `-release` name.
  describe('the release artifact is self-identifying (bd-2396)', () => {
    it('names the archive niete-rumi-v<versionCode>', () => {
      const gradle = stripComments(source);
      expect(gradle).toMatch(/archivesName\s*=\s*["']niete-rumi-v\$\{[^}]*versionCode\}["']/);
    });

    it('renames the bundle to the exact niete-rumi-v<versionCode>.aab name', () => {
      const gradle = stripComments(source);
      expect(gradle).toMatch(/niete-rumi-v\$\{[^}]*versionCode\}\.aab/);
    });

    // bd-2520: the rename used to be a COPY, which left Gradle's own
    // `niete-rumi-v<code>-release.aab` (archivesName + build-type suffix)
    // sitting beside the versioned name — two byte-identical files, one
    // artifact. Verified 2026-08-06 at versionCode 1204: both 6255617 bytes,
    // both md5 6bbb76145b2b17c2564dc3653ebbd14a. Two names for one artifact is
    // a foot-gun: `-release` reads as "the real one" when it only means the
    // build TYPE, and the wrong file gets uploaded to Play.
    //
    // The fix is to MOVE rather than copy, so exactly one .aab survives. This
    // asserts on the source because the failure is invisible until someone
    // stares at the output directory and has to guess which file is canonical.
    it('MOVES rather than copies, so no un-versioned .aab is left behind', () => {
      const gradle = stripComments(source);
      // The task must relocate the Gradle-named bundle, not duplicate it:
      // either Files.move, or a copy whose source is explicitly deleted.
      const moves = /Files\s*\.\s*move\s*\(/.test(gradle);
      const copiesThenDeletes =
        /Files\s*\.\s*copy\s*\(/.test(gradle) && /\.delete\s*\(\s*\)|Files\s*\.\s*delete/.test(gradle);
      expect(moves || copiesThenDeletes).toBe(true);
    });

    it('leaves a bare Files.copy nowhere in the bundle task', () => {
      const gradle = stripComments(source);
      // A copy with no accompanying delete is exactly the two-file bug.
      if (/Files\s*\.\s*copy\s*\(/.test(gradle)) {
        expect(gradle).toMatch(/\.delete\s*\(\s*\)|Files\s*\.\s*delete/);
      }
    });

    it('derives the name from versionCode rather than hardcoding a number', () => {
      const gradle = stripComments(source);
      for (const [, name] of gradle.matchAll(/["'](niete-rumi-v[^"']*)["']/g)) {
        // A literal digit would go stale on the next bump; it must interpolate.
        expect(name).not.toMatch(/v\d/);
        expect(name).toContain('${');
      }
    });

    // archivesBaseName is removed in Gradle 9 — the modern spelling is
    // archivesName, and reintroducing the old one would reintroduce a
    // deprecation warning on every build.
    it('does not use the Gradle-9-removed archivesBaseName', () => {
      expect(stripComments(source)).not.toMatch(/archivesBaseName/);
    });
  });
});
