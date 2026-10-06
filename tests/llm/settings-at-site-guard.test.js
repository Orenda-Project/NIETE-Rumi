/**
 * bd-gr4fy.6 — every call site that reads the settings row itself is flagged `settingsAtSite`.
 *
 * Such a call site resolves its model through `resolveModelForJob(job, { cfg: ... })`, so the row
 * has already moved it when the request reaches llm-client. Unflagged, llm-client sees the moved
 * model twice (as the override and as the call site's own) and puts NOTHING behind it, which is
 * what the audit found on vision and assessment. The flag is what makes llm-client stand the
 * job's own model behind it instead. This guard keeps the flag and the code in step: a new call
 * site that reads the settings fails here until its job is flagged, and a flag whose call site
 * stopped reading the settings fails here until it is removed.
 */
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', '..', 'bot');
const SKIP = new Set(['node_modules', 'tests', '__tests__']);

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** job -> files whose call to resolveModelForJob passes the settings (`cfg:`). */
function sitesReadingSettings() {
  const found = {};
  for (const file of jsFiles(BOT)) {
    if (file.endsWith(path.join('config', 'model-registry.js'))) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/resolveModelForJob\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      if (/\bcfg\s*:/.test(m[2])) (found[m[1]] = found[m[1]] || []).push(path.relative(BOT, file));
    }
  }
  return found;
}

describe('settingsAtSite matches the code', () => {
  const { JOBS } = require('../../bot/shared/config/model-registry');
  const sites = sitesReadingSettings();

  test('the scan finds the call sites it is meant to find', () => {
    // Guard the guard: vision and assessment read the settings today. Zero would mean the scan broke.
    expect(Object.keys(sites).sort()).toEqual(expect.arrayContaining(['assessment.generate', 'vision.analyse']));
  });

  test('every job whose call site reads the settings is flagged', () => {
    const unflagged = Object.keys(sites).filter((job) => !(JOBS[job] && JOBS[job].settingsAtSite));
    expect(unflagged).toEqual([]);
  });

  test('every flagged job has such a call site', () => {
    const stale = Object.keys(JOBS).filter((job) => JOBS[job].settingsAtSite && !sites[job]);
    expect(stale).toEqual([]);
  });
});
