'use strict';
/**
 * bd-5gyspy.12 — the child hub's selected tab (Stories / Games / Videos) draws its label white on the land's bright
 * colour: Games 3.43:1 on NIETE prod (design-qa-r5, 28 Oct, measured on prod_d5cb_grp_g3_en_390_3all.png). The label is
 * ~15 px bold, so it is normal text and needs 4.5:1 (WCAG 2.x). The same fix as 04 #142 (bd-6dbdwy.72).
 *
 * Reads the SHIPPED stylesheets (wq.css :root, then wq-adventure.css html.wq-adv and the door rules, in cascade
 * order) and resolves the selected door's fill and label colour through the real var() chain.
 */
const fs = require('fs');
const path = require('path');

const WQ = path.join(__dirname, '../../dashboard/public/wq');

function rules(file) {
  const s = fs.readFileSync(path.join(WQ, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const decls = {};
    m[2].split(';').forEach((d) => { const c = d.indexOf(':'); if (c > 0) decls[d.slice(0, c).trim()] = d.slice(c + 1).trim(); });
    m[1].split(',').forEach((sel) => out.push({ sel: sel.trim(), decls }));
  }
  return out;
}
const ALL = [...rules('wq.css'), ...rules('wq-adventure.css')];
const declsOf = (sel) => ALL.filter((r) => r.sel === sel).reduce((acc, r) => Object.assign(acc, r.decls), {});

function resolve(v, scope, n = 0) {
  const m = /var\(\s*(--[\w-]+)\s*\)/.exec(v);
  if (!m) return v.trim();
  if (n > 20 || scope[m[1]] === undefined) throw new Error(`cannot resolve ${m[1]}`);
  return resolve(v.replace(m[0], scope[m[1]]), scope, n + 1);
}
const rgb = (c) => {
  const h = c.toLowerCase() === 'white' ? 'ffffff' : c.replace('#', '');
  const x = h.length === 3 ? h.split('').map((k) => k + k).join('') : h;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
const lum = (x) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]); };
const ratio = (a, b) => { const x = lum(rgb(a)); const y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function selectedTab(door) {
  const scope = {};
  [':root', 'html.wq-adv', `html.wq-adv .wq-door[data-door=${door}]`, 'html.wq-adv .wq-door', 'html.wq-adv .wq-door.at'].forEach((sel) => {
    const d = declsOf(sel);
    Object.keys(d).forEach((k) => { if (k.startsWith('--')) scope[k] = d[k]; });
  });
  const at = declsOf('html.wq-adv .wq-door.at');
  const bg = resolve(at['background'], scope);
  const fg = resolve(at['color'], scope);
  return { bg, fg, ratio: Math.round(ratio(fg, bg) * 100) / 100 };
}

describe('the selected tab label reads at 4.5:1 (normal text)', () => {
  test.each(['stories', 'games', 'videos'])('%s', (door) => {
    const t = selectedTab(door);
    expect({ door, ...t, ok: t.ratio >= 4.5 }).toEqual({ door, ...t, ok: true });
  });
});
