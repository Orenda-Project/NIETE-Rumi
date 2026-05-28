/**
 * Customization-doc accuracy guard.
 *
 * The customization docs are the map agents follow to re-shape Rumi. Across the 5 feature
 * audits, every customization doc was found pointing at a WRONG or DEAD file — the single
 * worst failure for an agent-first repo (it confidently sends an agent to edit the wrong place).
 *
 * This guard fails if any repo file path cited in docs/customization.md (and the markdown-link
 * targets in docs/agent-customization.md) does not exist — so the map can't rot into misdirection.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DOCS = path.join(ROOT, 'docs');

// A repo path worth checking: starts with a known top-level dir and ends in a real source ext.
const REPO_PATH_RE = /^(?:\.\.\/)*(?:bot|docs|tests|infrastructure|\.claude|portal|dashboard)\/[\w./@-]+\.(?:js|ts|tsx|md|sql|json)$/;

function resolveFromDoc(docPath, target) {
  const clean = target.split('#')[0].trim();           // drop anchors
  if (!clean || clean.startsWith('http')) return null;  // external
  return path.resolve(path.dirname(docPath), clean);
}

// Markdown link targets: [text](target)
function markdownLinkTargets(text) {
  const out = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// Backticked code paths: `bot/shared/.../x.js`
function backtickedPaths(text) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[1].trim();
    if (REPO_PATH_RE.test(t)) out.push(t);
  }
  return out;
}

describe('Customization docs point at files that exist', () => {
  it('docs/customization.md — every cited repo path resolves', () => {
    const doc = path.join(DOCS, 'customization.md');
    const text = fs.readFileSync(doc, 'utf-8');
    const offenders = [];

    for (const target of markdownLinkTargets(text)) {
      if (target.startsWith('#') || target.startsWith('http')) continue;
      const abs = resolveFromDoc(doc, target);
      if (abs && !fs.existsSync(abs)) offenders.push(`link → ${target}`);
    }
    for (const p of backtickedPaths(text)) {
      if (!fs.existsSync(path.join(ROOT, p.replace(/^(\.\.\/)+/, '')))) offenders.push(`code path → ${p}`);
    }

    expect(offenders).toEqual([]);
  });

  it('docs/agent-customization.md — every markdown-link repo target resolves', () => {
    const doc = path.join(DOCS, 'agent-customization.md');
    if (!fs.existsSync(doc)) return;
    const text = fs.readFileSync(doc, 'utf-8');
    const offenders = [];
    for (const target of markdownLinkTargets(text)) {
      if (target.startsWith('#') || target.startsWith('http')) continue;
      const clean = target.split('#')[0].trim();
      if (!clean) continue;
      // only check things that look like repo file links
      if (!/\.(js|ts|tsx|md|sql|json)$/.test(clean)) continue;
      const abs = resolveFromDoc(doc, target);
      if (abs && !fs.existsSync(abs)) offenders.push(`link → ${target}`);
    }
    expect(offenders).toEqual([]);
  });
});
