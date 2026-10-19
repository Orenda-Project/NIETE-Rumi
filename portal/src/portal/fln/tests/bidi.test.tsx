import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * Port of the red team's `rt_bidi_check.py` (RUBRIC B2, DESIGN v2 §1 rules) onto the rendered DOM of
 * the plan page for an Urdu plan on an Urdu page, with every band and "Full details" opened:
 *   FAIL  a run of ASCII letters/digits in an rtl context that is not inside <bdi> / dir=ltr / unicode-bidi:isolate
 *   FAIL  the «·» separator anywhere in rtl text (Urdu chrome uses «—»)
 * The walk mirrors the script: the nearest `dir` decides the context; any isolating ancestor clears the run.
 */
vi.mock('../player', async (orig) => (await import('./fixtures/playerMock')).withStandIns(await orig()));

import { resetPlayerMock } from './fixtures/playerMock';
import { renderPlan } from './fixtures/renderPlan';
import { rhUr, rhEn } from './fixtures/plans';

const RUN = /[A-Za-z0-9]+(?:[ .,:'’/+\-–()]+[A-Za-z0-9]+)*/g;
const SKIP = new Set(['STYLE', 'SCRIPT', 'TITLE', 'SVG', 'PATH', 'TEMPLATE', 'NOSCRIPT']);

interface Finding { kind: 'unisolated' | 'middot'; run: string; text: string; path: string }

export function bidiFindings(root: Element): { findings: Finding[]; rtlTextNodes: number } {
  const findings: Finding[] = [];
  let rtlTextNodes = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const data = n.nodeValue || '';
    if (!data.trim()) continue;
    let dir = 'ltr';
    let iso = false;
    let skip = false;
    const path: string[] = [];
    // innermost `dir` wins; any isolating element on the way up isolates
    let decided = false;
    for (let el = n.parentElement; el; el = el.parentElement) {
      if (SKIP.has(el.tagName.toUpperCase())) skip = true;
      if (path.length < 4) path.unshift(el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : ''));
      const d = (el.getAttribute('dir') || '').toLowerCase();
      const style = (el.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
      if (el.tagName === 'BDI' || d === 'ltr' || style.includes('unicode-bidi:isolate') || style.includes('direction:ltr')) iso = true;
      if (!decided && d) { dir = d; decided = true; }
    }
    if (skip || dir !== 'rtl') continue;
    rtlTextNodes += 1;
    const txt = data.split(/\s+/).join(' ');
    if (!iso) for (const m of txt.matchAll(RUN)) findings.push({ kind: 'unisolated', run: m[0], text: txt.slice(0, 90), path: path.join('>') });
    if (txt.includes('·')) findings.push({ kind: 'middot', run: '·', text: txt.slice(0, 90), path: path.join('>') });
  }
  return { findings, rtlTextNodes };
}

async function openEverything() {
  fireEvent.click(screen.getByRole('button', { name: /مکمل تفصیل|Full details/ }));
  document.querySelectorAll<HTMLButtonElement>('[data-fln-band]').forEach((b) => fireEvent.click(b));
}

beforeEach(() => { resetPlayerMock(); window.history.replaceState(null, ''); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('bidi — Urdu plan on an Urdu page', () => {
  it('has 0 un-isolated ASCII runs and 0 «·» in rtl text, every band open', async () => {
    renderPlan(rhUr, { lang: 'ur' });
    await screen.findByText(rhUr.plan.title);
    await openEverything();
    const { findings, rtlTextNodes } = bidiFindings(document.body);
    expect(rtlTextNodes).toBeGreaterThan(30);
    expect(findings).toEqual([]);
  });

  it('the checker itself catches an un-isolated run (guards against a vacuous pass)', () => {
    const div = document.createElement('div');
    div.setAttribute('dir', 'rtl');
    div.innerHTML = '<p>سبق 24 <bdi>SLO</bdi> — ریڈنگ · آور</p>';
    document.body.appendChild(div);
    const { findings } = bidiFindings(div);
    expect(findings.map((f) => f.kind + ':' + f.run)).toEqual(['unisolated:24', 'middot:·']);
    div.remove();
  });

  it('an English plan on an Urdu page keeps its text ltr (no rtl findings from plan text)', async () => {
    renderPlan(rhEn, { lang: 'ur' });
    await screen.findByText(rhEn.plan.title);
    await openEverything();
    expect(bidiFindings(document.body).findings).toEqual([]);
  });
});
