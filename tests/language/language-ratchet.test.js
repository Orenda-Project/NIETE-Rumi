'use strict';
/**
 * The language-debt ratchet, run where NIETE's code changes (bd-3lhh9.2).
 *
 * `.claude/scripts/language-audit.js` is vendored from the workspace harness (hyasin270/rumi-agent-home),
 * where it only ever ran as a push gate in that workspace's Claude sessions. NIETE work pushed from NIETE
 * sessions, and every merge made on GitHub, never met it: between the 2026-08-21 snapshot and 2026-10-20
 * the bot/shared files carrying unrecorded debt grew to 80-plus. Inside `npm test` it now gates every PR.
 *
 * It pins per-file counts of inline language maps, `=== 'ur' ?` ternaries and `|| 'en'` floors, and fails
 * when a file gets WORSE than `.claude/scripts/language-audit.snapshot.json` or a teacher-facing string goes
 * over its WhatsApp field cap. Debt already in the snapshot never fails it. Route a string through the
 * catalog to bring a count down, then ratchet the snapshot with it:
 *
 *   node .claude/scripts/language-audit.js --update      # and review the diff before committing
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, '.claude', 'scripts', 'language-audit.js');

function audit(targets) {
  // An empty LANG_AUDIT_TARGETS means "the default target", this repo's bot/shared.
  return spawnSync(process.execPath, [AUDIT], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, LANG_AUDIT_TARGETS: targets },
  });
}

describe('language ratchet (bd-3lhh9.2)', () => {
  test('no bot/shared file carries more language debt than the snapshot, and no string is over its cap', () => {
    const r = audit('');
    // 0 = clean · 1 = new debt or a cap violation · 2 = nothing to scan, which must never read as a pass
    if (r.status !== 0) {
      throw new Error(`language-audit exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
    }
  });

  test('a file that gets worse fails it, naming the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-ratchet-'));
    try {
      fs.mkdirSync(path.join(dir, 'services'));
      fs.writeFileSync(path.join(dir, 'services', 'zz-new.service.js'),
        "const greet = (lang) => (lang === 'ur' ? 'خوش آمدید' : 'Welcome');\nmodule.exports = { greet };\n");
      const r = audit(`niete=${dir}`);
      expect(r.status).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toMatch(/NEW language debt[\s\S]*services\/zz-new\.service\.js/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
