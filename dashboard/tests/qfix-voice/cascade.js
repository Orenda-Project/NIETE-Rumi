'use strict';
/**
 * The CSS cascade for a test, not one rule: given an element's ancestor chain and a property, the value the phone
 * would compute from the page's own style files. Shared by the qfix-voice tests (one test file per item).
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '..', '..', 'public', 'wq');

// The cascade itself, not one rule: every rule in wq.css whose selector matches the element (descendant and child
// combinators, classes, ids, [attr=value]), ranked by !important, specificity, then source order, the way the browser
// ranks them. @media rules count when they hold on a 360 × 740 phone.
const postcss = require('postcss');
const selParser = require('postcss-selector-parser');

// One of the page's style files, parsed with its comments dropped (a comment is not a selector).
const root = (file) => postcss.parse(fs.readFileSync(path.join(WQ, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
const CSS_ROOT = root('wq.css');
const VIEW = { width: 360, height: 740 };
function mediaHolds(params) {
  return params.split(/\s+and\s+/).every((cond) => {
    const m = /\(\s*(min|max)-(width|height)\s*:\s*(\d+)px\s*\)/.exec(cond);
    if (!m) return false; // reduced motion, print, hover: not this phone
    const v = VIEW[m[2]];
    return m[1] === 'min' ? v >= Number(m[3]) : v <= Number(m[3]);
  });
}
function compoundMatches(nodes, el) {
  return nodes.every((n) => {
    if (n.type === 'tag') return n.value.toLowerCase() === el.tag;
    if (n.type === 'class') return el.classes.includes(n.value);
    if (n.type === 'id') return el.id === n.value;
    if (n.type === 'attribute') {
      const have = el.attrs[n.attribute];
      return n.operator ? n.operator === '=' && have === n.value : have !== undefined;
    }
    if (n.type === 'universal') return true;
    return false; // pseudo-classes and pseudo-elements: never the element at rest
  });
}
function selectorMatches(sel, path) {
  const parts = [[]];
  const combs = [];
  sel.nodes.forEach((n) => {
    if (n.type === 'combinator') { combs.push(n.value.trim() || ' '); parts.push([]); } else parts[parts.length - 1].push(n);
  });
  let at = path.length - 1;
  if (!compoundMatches(parts[parts.length - 1], path[at])) return false;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const comb = combs[i];
    if (comb === '>') {
      at -= 1;
      if (at < 0 || !compoundMatches(parts[i], path[at])) return false;
    } else if (comb === ' ') {
      do { at -= 1; } while (at >= 0 && !compoundMatches(parts[i], path[at]));
      if (at < 0) return false;
    } else return false;
  }
  return true;
}
function specificity(sel) {
  let a = 0; let b = 0; let c = 0;
  sel.walk((n) => {
    if (n.type === 'id') a += 1;
    else if (n.type === 'class' || n.type === 'attribute' || (n.type === 'pseudo' && !n.value.startsWith('::'))) b += 1;
    else if (n.type === 'tag' || (n.type === 'pseudo' && n.value.startsWith('::'))) c += 1;
  });
  return a * 1e6 + b * 1e3 + c;
}
// The size or the family out of a `font` shorthand: [style] [weight] size[/line-height] family.
function fromFont(value, prop) {
  const m = /(\d+(?:\.\d+)?px)(?:\/\S+)?\s+(.+)$/.exec(value);
  if (!m) return null;
  return prop === 'font-size' ? m[1] : m[2].trim();
}
// roots: the style files in the order the page loads them (wq.css alone unless a test names more).
function computed(path, prop, roots = [CSS_ROOT]) {
  let best = null;
  let order = 0;
  roots.forEach((root) => root.walkRules((rule) => {
    const p = rule.parent;
    if (p.type === 'atrule' && !(p.name === 'media' && mediaHolds(p.params))) return;
    if (p.type !== 'root' && p.type !== 'atrule') return;
    // `font: 700 52px/1.7 var(--fu)` sets the size and the family too
    const decls = rule.nodes.filter((d) => d.type === 'decl' && (d.prop === prop || (d.prop === 'font' && /^font-(size|family)$/.test(prop))));
    if (!decls.length) return;
    selParser((sels) => {
      sels.each((sel) => {
        if (!selectorMatches(sel, path)) return;
        decls.forEach((d) => {
          order += 1;
          const rank = [d.important ? 1 : 0, specificity(sel), order];
          if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
            best = { rank, value: d.prop === 'font' ? fromFont(d.value, prop) : d.value, selector: String(sel).trim() };
          }
        });
      });
    }).processSync(rule.selector);
  }));
  return best;
}
const node = (tag, classes = [], attrs = {}, id) => ({ tag, classes, attrs, id });

module.exports = { CSS_ROOT, VIEW, computed, node, root, selectorMatches, specificity };
