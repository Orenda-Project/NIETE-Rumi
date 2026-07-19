/**
 * FEAT-053 bd-18 — structural contract for the generated MEWAKA Flow JSON.
 * The flow is GENERATED from mewaka-framework.js; this test pins the
 * file↔framework consistency so drift fails CI, not production.
 */

const fs = require('fs');
const path = require('path');
const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/observe-mewaka-flow.json');

describe('observe-mewaka-flow.json', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
  const { domains, totalIndicators } = mewaka.getScoringConstants();
  const domainScreens = flow.screens.filter(s => s.id.startsWith('DOMAIN_'));

  test('7 screens: 6 domains + terminal SUCCESS', () => {
    expect(flow.screens).toHaveLength(7);
    expect(domainScreens).toHaveLength(6);
    const success = flow.screens.find(s => s.id === 'SUCCESS');
    expect(success.terminal).toBe(true);
  });

  test('data_exchange flow (endpoint-based, v3.0)', () => {
    expect(flow.data_api_version).toBe('3.0');
  });

  test('every framework indicator has rating + evidence + improvement fields', () => {
    const allNames = new Set();
    domainScreens.forEach(s => {
      s.layout.children[0].children.forEach(c => { if (c.name) allNames.add(c.name); });
    });
    let count = 0;
    Object.values(domains).forEach(d => d.indicators.forEach(ind => {
      const f = ind.id.replace(/\./g, '_');
      expect(allNames.has(`r_${f}`)).toBe(true);
      expect(allNames.has(`ev_${f}`)).toBe(true);
      expect(allNames.has(`imp_${f}`)).toBe(true);
      count += 1;
    }));
    expect(count).toBe(totalIndicators); // 25
  });

  test('rating options are the production 0-3 scale', () => {
    const a = domainScreens[0];
    const scale = a.data.scale.__example__;
    expect(scale.map(o => o.id)).toEqual(['0', '1', '2', '3']);
  });

  test('every init-values binding is declared in the screen data object', () => {
    domainScreens.forEach(s => {
      const iv = s.layout.children[0]['init-values'];
      const declared = new Set(Object.keys(s.data));
      Object.values(iv).forEach(binding => {
        const key = binding.match(/^\$\{data\.(.+)\}$/)[1];
        expect(declared.has(key)).toBe(true);
      });
    });
  });

  test('component count per screen is under the Meta cap (50)', () => {
    domainScreens.forEach(s => {
      expect(s.layout.children[0].children.length).toBeLessThanOrEqual(50);
    });
  });

  test('routing model is strictly forward-only A→B→C→D→E→F→SUCCESS', () => {
    expect(flow.routing_model).toEqual({
      DOMAIN_A: ['DOMAIN_B'], DOMAIN_B: ['DOMAIN_C'], DOMAIN_C: ['DOMAIN_D'],
      DOMAIN_D: ['DOMAIN_E'], DOMAIN_E: ['DOMAIN_F'], DOMAIN_F: ['SUCCESS'],
      SUCCESS: [],
    });
  });

  test('terminal completion carries the observe_action tag (bd-1249 wiring contract)', () => {
    const success = flow.screens.find(s => s.id === 'SUCCESS');
    const footer = success.layout.children.find(c => c.type === 'Footer');
    expect(footer['on-click-action'].name).toBe('complete');
    expect(footer['on-click-action'].payload.observe_action).toBe('submitted');
  });
});

// bd-61: the PK HOTS flow shipped with "MEWAKA undefined · 1/6" title bars,
// Kiswahili footers, and an "Asante" SUCCESS screen — mewaka hardcodes that
// leaked through the generator. Pin the generated file clean.
describe('observe-hots-flow.json (bd-61 — no mewaka/Kiswahili leakage)', () => {
  const HOTS_PATH = path.join(__dirname, '../../docs/flows/observe-hots-flow.json');
  const raw = fs.readFileSync(HOTS_PATH, 'utf8');
  const hotsFlow = JSON.parse(raw);

  test('no undefined interpolations, no MEWAKA branding, no Kiswahili labels', () => {
    for (const bad of ['undefined', 'MEWAKA', 'Asante', 'Endelea', 'Wasilisha', 'Maliza', 'Haikuonekana']) {
      expect(raw).not.toContain(bad);
    }
  });

  test('screen titles are HOTS-branded with correct 1/5..5/5 numbering', () => {
    const titles = hotsFlow.screens.map((s) => s.title);
    expect(titles.slice(0, 5)).toEqual(
      [1, 2, 3, 4, 5].map((i) => `HOTS جائزہ ${i}/5`));
    expect(titles[5]).toBe('شکریہ');
  });

  test('all 16 hots indicators present with numeric-id field names', () => {
    const names = new Set();
    hotsFlow.screens.forEach((s) => {
      JSON.stringify(s).replace(/"name":\s*"((?:r|ev|imp)_\d+)"/g, (_, n) => { names.add(n); return _; });
    });
    for (let i = 1; i <= 16; i++) {
      expect(names.has(`r_${i}`)).toBe(true);
      expect(names.has(`ev_${i}`)).toBe(true);
      expect(names.has(`imp_${i}`)).toBe(true);
    }
  });
});
