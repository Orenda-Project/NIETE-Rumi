'use strict';
/**
 * A clip or battery file re-made under the same name reaches a phone that already holds it only when sw.js's SESSION
 * changes (the worker answers those URLs cache-first from caches.open(SESSION)). dashboard/sa/clips.lock.json records
 * the bytes and the SESSION they were taken under; this fails when a locked file changed and SESSION did not.
 * Fix: bump SESSION in dashboard/sa/sw.js, then run `node dashboard/scripts/sa-clips-lock.js`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { digest, session, changed, LOCK } = require('../scripts/sa-clips-lock');

describe('sa clips lock (sw.js SESSION follows the served bytes)', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));

  it('a file re-made under its name ships with a new SESSION', () => {
    const diff = lock.session === session() ? changed(lock, digest()) : [];
    expect({ session: session(), changedUnderIt: diff.slice(0, 20), count: diff.length })
      .toEqual({ session: session(), changedUnderIt: [], count: 0 });
  });

  it('the lock was rewritten for the current SESSION', () => {
    expect(lock.session).toBe(session());
  });

  it('covers the served clips, timings, pictures and batteries, and nothing else', () => {
    const files = Object.keys(lock.files);
    expect(files.some((p) => /^dashboard\/sa\/v4\/ur\/[0-9a-f]{12}\.mp3$/.test(p))).toBe(true);
    expect(files.some((p) => /^dashboard\/sa\/v4\/en\/[0-9a-f]{12}\.json$/.test(p))).toBe(true);
    expect(files.some((p) => /^dashboard\/sa\/img\/.+\.webp$/.test(p))).toBe(true);
    expect(files.some((p) => /^bot\/shared\/data\/child-test\/sa\/sa\.coach\.[^/]+\.ur\.json$/.test(p))).toBe(true);
    expect(files.filter((p) => /\.(js|html|css|md)$/.test(p))).toEqual([]);
  });

  it('flags a changed or removed locked file and lets a new file through', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-lock-'));
    const clip = path.join(tmp, 'dashboard', 'sa', 'v4', 'ur');
    fs.mkdirSync(clip, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dashboard', 'sa', 'sw.js'), "var SESSION = 'sa-session-v1';\n");
    fs.writeFileSync(path.join(clip, 'aaaaaaaaaaaa.mp3'), 'old take');
    fs.writeFileSync(path.join(clip, 'bbbbbbbbbbbb.mp3'), 'kept');
    const before = { session: session(tmp), files: digest(tmp) };
    fs.writeFileSync(path.join(clip, 'aaaaaaaaaaaa.mp3'), 'new take');
    fs.writeFileSync(path.join(clip, 'cccccccccccc.mp3'), 'a new key');
    expect(changed(before, digest(tmp))).toEqual(['dashboard/sa/v4/ur/aaaaaaaaaaaa.mp3']);
    fs.unlinkSync(path.join(clip, 'bbbbbbbbbbbb.mp3'));
    expect(changed(before, digest(tmp))).toEqual(['dashboard/sa/v4/ur/aaaaaaaaaaaa.mp3', 'dashboard/sa/v4/ur/bbbbbbbbbbbb.mp3']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
