#!/usr/bin/env node
'use strict';
/**
 * The Urdu fit walk over every self-administered battery screen, as a report (tests/support/sa-ur-walk.js).
 *
 *   PWCORE=<playwright-core> node dashboard/scripts/sa-ur-fit-walk.js <out dir> [--grades 1,3] [--vp 360x640] [--english] [--game] [--frames all|fails]
 *
 * --ur-fit / --app-asks turn those switches on in the battery's ui. --css <file> appends a stylesheet (to try a fix before it is made).
 * Writes <out>/nodes.jsonl (every Urdu text node on every screen: its box, its holder, the nearest picture or layer),
 * <out>/fails.jsonl, <out>/summary.json, and frames <out>/<viewport>/<scenario>/<n>_<task>_<screen>.png (the failures
 * marked: red = the word's ink, blue = what it ran into).
 */
const fs = require('fs');
const path = require('path');
const W = require('../tests/support/sa-ur-walk');

const args = process.argv.slice(2);
const out = args[0];
if (!out) { process.stderr.write('usage: sa-ur-fit-walk.js <out dir> [--grades 1,2] [--vp 360x640]\n'); process.exit(2); }
const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
const grades = opt('--grades') ? opt('--grades').split(',').map(Number) : undefined;
const vps = opt('--vp') ? W.VIEWPORTS.filter((v) => opt('--vp').split(',').indexOf(v.name) >= 0) : W.VIEWPORTS;
const frames = opt('--frames') || 'fails';

(async () => {
  const { chromium } = require(process.env.PWCORE || 'playwright-core');
  const browser = await chromium.launch(process.env.PWCHROME_EXE ? { executablePath: process.env.PWCHROME_EXE } : {});
  fs.mkdirSync(out, { recursive: true });
  const nodesF = fs.createWriteStream(path.join(out, 'nodes.jsonl'));
  const failsF = fs.createWriteStream(path.join(out, 'fails.jsonl'));
  const summary = { at: new Date().toISOString(), viewports: {}, kinds: {}, screens: 0, nodes: 0, fails: 0, by_screen: {} };
  const framed = new Set();
  const css = opt('--css') ? fs.readFileSync(opt('--css'), 'utf8') : null;
  for (const vp of vps) {
    summary.viewports[vp.name] = { screens: 0, nodes: 0, fails: 0 };
    for (const sc of W.scenarios({ grades, english: args.includes('--english'), game: args.includes('--game') })) {
      const { variants } = W.batteryOf(sc, 0);
      for (let variant = 0; variant < variants; variant++) {
        const dir = path.join(out, vp.name, sc.id + (variants > 1 ? '.v' + variant : ''));
        await W.walk(browser, sc, vp, {
          variant, css, urFit: args.includes('--ur-fit'), appAsks: args.includes('--app-asks'),
          onScreen: async (rec, page, n) => {
            const st = rec.state;
            const tag = `${String(n).padStart(3, '0')}_${st.task || '-'}_${(st.shown || '').replace(/[^a-z_]/gi, '')}`;
            summary.screens++; summary.viewports[vp.name].screens++;
            rec.nodes.forEach((nd) => {
              summary.nodes++; summary.viewports[vp.name].nodes++;
              nodesF.write(JSON.stringify(Object.assign({ vp: vp.name, sc: sc.id, variant, frame: tag, phase: st.shown, task: st.task }, nd)) + '\n');
            });
            summary.touches = (summary.touches || 0) + rec.touches.length;
            summary.cut_words = (summary.cut_words || 0) + rec.cut.length;
            if (rec.scrolls) summary.scroll_screens = (summary.scroll_screens || 0) + 1;
            rec.fails.forEach((f) => {
              summary.fails++; summary.viewports[vp.name].fails++;
              summary.kinds[f.kind] = (summary.kinds[f.kind] || 0) + 1;
              const sk = `${f.kind} ${f.sel || ''}`;
              summary.by_screen[sk] = (summary.by_screen[sk] || 0) + 1;
              failsF.write(JSON.stringify(Object.assign({ vp: vp.name, sc: sc.id, variant, frame: tag, phase: st.shown, task: st.task }, f)) + '\n');
            });
            // One frame per failure family (kind + where) per viewport, unless --frames all.
            const fresh = rec.fails.filter((f) => { const k = vp.name + f.kind + (f.sel || '') + (f.by || f.holder || f.clip || f.other_sel || ''); if (framed.has(k)) return false; framed.add(k); return true; });
            if (frames === 'all' || fresh.length) {
              fs.mkdirSync(dir, { recursive: true });
              if (rec.fails.length) await page.evaluate(W.markInPage, rec.fails);
              await page.screenshot({ path: path.join(dir, tag + '.png'), fullPage: true });
              await page.evaluate(() => { const m = document.getElementById('__marks'); if (m) m.remove(); });
            }
          },
        });
        process.stdout.write(`${vp.name} ${sc.id} v${variant}: ${summary.viewports[vp.name].fails} fails so far\n`);
        if (sc.block === 'rdf_manual') break; // the manual walk shows the passage the same way; one variant is enough
      }
    }
  }
  await browser.close();
  nodesF.end(); failsF.end();
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify({ screens: summary.screens, nodes: summary.nodes, fails: summary.fails, kinds: summary.kinds, touches: summary.touches, cut_words: summary.cut_words, scroll_screens: summary.scroll_screens }) + '\n');
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
