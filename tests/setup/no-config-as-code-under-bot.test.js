/**
 * No Railway config-as-code file under bot/.
 *
 * Every Railway service here is configured in its service settings (builder,
 * build/start command, healthcheck, restart policy) and builds from the repo
 * root. A bot/railway.json is not read by that build — but Railway still picks
 * it up as config-as-code and spawns a SECOND, commitless deployment for the bot
 * service on every main push, which runs the root-level build command inside
 * bot/ and dies at `cd: bot: No such file or directory`. Harmless to serving,
 * red on every prod push, and it made two deploy watches quit early on
 * 2026-09-10 (bd-8rz55). The service settings already carry every value the
 * file declared, so the file is dead weight with a side effect. Keep it gone.
 */
const fs = require('fs');
const path = require('path');

describe('no Railway config-as-code under bot/', () => {
  it('bot/railway.json does not exist', () => {
    const p = path.join(__dirname, '../../bot/railway.json');
    expect(fs.existsSync(p)).toBe(false);
  });
  it('bot/railway.toml does not exist either', () => {
    const p = path.join(__dirname, '../../bot/railway.toml');
    expect(fs.existsSync(p)).toBe(false);
  });
});
