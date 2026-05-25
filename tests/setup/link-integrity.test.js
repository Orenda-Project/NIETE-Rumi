/**
 * Link Integrity (Phase 7-final) — the rot-prevention backstop for the progressive-disclosure web.
 *
 * The agent-native docs (root CLAUDE.md, the folder routers, and the skill markdown under
 * .claude) are wired together by hand into a link web: each skill up-links to .claude/CLAUDE.md, cross-links to
 * sibling skills, and code-links to real bot/ paths. This guard asserts every one of those
 * relative markdown links resolves to a real file/dir — so a renamed skill, a deleted reference
 * file, or a typo'd path fails CI instead of silently rotting and misleading a future agent.
 *
 * It deliberately only checks RELATIVE links (./ ../ or bare in-repo paths). External links
 * (http/https/mailto) and pure in-page anchors (#section) are skipped.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// Same agent-native doc set the source-hygiene guard scans.
function collectAgentDocs() {
  const docs = [];
  for (const top of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(ROOT, top);
    if (fs.existsSync(p)) docs.push(p);
  }
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue;
        walk(p);
      } else if (e.name === 'CLAUDE.md') {
        docs.push(p);
      }
    }
  };
  walk(ROOT);
  const claudeDir = path.join(ROOT, '.claude');
  if (fs.existsSync(claudeDir)) {
    const walkMd = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walkMd(p); }
        else if (e.name.endsWith('.md')) docs.push(p);
      }
    };
    walkMd(claudeDir);
  }
  return [...new Set(docs)];
}

// Extract relative link targets from a markdown file, with their line numbers.
function relativeLinks(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  const out = [];
  lines.forEach((line, idx) => {
    let m;
    while ((m = re.exec(line)) !== null) {
      let target = m[1].trim();
      // skip external + anchor-only links
      if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
      if (target.startsWith('#')) continue;
      // strip any #anchor / ?query suffix
      target = target.split('#')[0].split('?')[0].trim();
      if (!target) continue;
      out.push({ target, line: idx + 1 });
    }
  });
  return out;
}

describe('Link Integrity (agent-native progressive-disclosure web)', () => {
  const docs = collectAgentDocs();

  test('agent docs exist to scan', () => {
    expect(docs.length).toBeGreaterThan(0);
  });

  test('every relative markdown link resolves to a real file or directory', () => {
    const broken = [];
    for (const doc of docs) {
      const dir = path.dirname(doc);
      for (const { target, line } of relativeLinks(doc)) {
        // decode %20 etc. so "Open%20Source" style paths resolve like the editor opens them
        const decoded = (() => { try { return decodeURIComponent(target); } catch { return target; } })();
        const resolved = path.resolve(dir, decoded);
        if (!fs.existsSync(resolved)) {
          broken.push(`${path.relative(ROOT, doc)}:${line} → ${target}`);
        }
      }
    }
    if (broken.length) {
      throw new Error(
        `Dangling internal link(s) in agent-native docs:\n  ${broken.join('\n  ')}\n` +
        `Fix the path, restore the target, or update the link.`
      );
    }
  });
});
