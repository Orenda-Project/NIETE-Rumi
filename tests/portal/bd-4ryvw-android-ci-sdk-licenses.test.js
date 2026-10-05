/**
 * bd-4ryvw — the Android workflows must not depend on android-actions/setup-android@v3.
 *
 * It now stops on an interactive license prompt ("6 of 7 SDK package licenses not
 * accepted") and fails the job before anything is built — the debug build died at that
 * step on 2026-10-02 and 2026-10-05. The hosted runner already has an SDK at
 * $ANDROID_HOME; each workflow accepts its licenses itself. `(yes || true)` because the
 * job shell runs with pipefail, and `yes` exits 141 on SIGPIPE once sdkmanager is done.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS = ['android-debug.yml', 'android-release.yml', 'android-staging.yml'];
const read = (f) => fs.readFileSync(path.join(__dirname, '../../.github/workflows', f), 'utf8');

describe.each(WORKFLOWS)('bd-4ryvw — %s accepts SDK licenses without setup-android', (file) => {
  test('does not use android-actions/setup-android', () => {
    expect(read(file)).not.toMatch(/^\s*-\s*uses:\s*android-actions\/setup-android/m);
  });

  test('accepts the preinstalled SDK licenses non-interactively, pipefail-safe', () => {
    expect(read(file)).toMatch(/\(yes \|\| true\) \| "\$ANDROID_HOME\/cmdline-tools\/latest\/bin\/sdkmanager" --licenses/);
  });

  test('runs Node 22+ — the Capacitor 8 CLI refuses older ("requires NodeJS >=22.0.0")', () => {
    const versions = [...read(file).matchAll(/node-version:\s*'?(\d+)/g)].map((m) => Number(m[1]));
    expect(versions.length).toBeGreaterThan(0);
    versions.forEach((v) => expect(v).toBeGreaterThanOrEqual(22));
  });

  test('accepts them before Gradle runs', () => {
    const src = read(file);
    expect(src.indexOf('sdkmanager" --licenses')).toBeLessThan(src.indexOf('gradlew'));
  });
});
