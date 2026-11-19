/**
 * bd-2453 — NIETE branding for the remaining HITL/observe rendered assets,
 * extending the bd-2452 hero-template pattern (PALETTES: default vs niete).
 *
 *  1. The observe TEACHER report (observe-send → generateHeroReport) must
 *     carry the same brand the coaching-pipeline FICO report gets via
 *     renderer-registry — it previously bypassed the registry and rendered
 *     the default (Rumi navy) palette.
 *  2. The coach-the-coach card must be brand-tokenized like the hero
 *     template: default = original navy, niete = Green #47BA7D + Navy Slate
 *     #333748, selected per framework on the FICO/NIETE path.
 *  3. The commitment-card accent for the FICO framework is the NIETE green,
 *     not the old purple.
 */

const fs = require('fs');
const path = require('path');

const SRC = (p) => fs.readFileSync(path.join(__dirname, '../../shared', p), 'utf8');

describe('bd-2453 — brand routing', () => {
  test('renderer-registry exposes heroBrandFor (fico → niete, others → undefined)', () => {
    const registry = require('../../shared/services/coaching/report-renderers/renderer-registry');
    expect(typeof registry.heroBrandFor).toBe('function');
    expect(registry.heroBrandFor('fico')).toBe('niete');
    expect(registry.heroBrandFor('FICO')).toBe('niete');
    expect(registry.heroBrandFor('hots')).toBeUndefined();
    expect(registry.heroBrandFor(undefined)).toBeUndefined();
  });

  test('observe-send passes the framework brand into generateHeroReport', () => {
    const src = SRC('services/observe/observe-send.service.js');
    // the generateHeroReport opts block must include a brand derived via
    // heroBrandFor — not a hardcoded palette and not omitted.
    expect(src).toMatch(/heroBrandFor/);
    const call = src.slice(src.indexOf('generateHeroReport(session'));
    expect(call.slice(0, 400)).toMatch(/brand:/);
  });
});

describe('bd-2453 — coach card brand tokens', () => {
  const { buildCoachCardHtml } = require('../../shared/services/observe/observe-coach-card');
  const fb = {
    praise_line: 'Great listening.',
    wins: [{ behaviour: 'Opened with praise', evidence: 'You started well' }],
    try: { move: 'Hold the silence', evidence: 'You answered fast', instead: 'Wait 30s' },
    value: 'usikivu',
    rubric: {},
  };

  test('default brand keeps the original navy header', () => {
    const html = buildCoachCardHtml(fb, { lang: 'en' });
    expect(html).toContain('#0c1a4e');
    expect(html).not.toContain('#333748');
  });

  test('niete brand renders Navy Slate + NIETE green, no Rumi navy', () => {
    const html = buildCoachCardHtml(fb, { lang: 'ur', brand: 'niete' });
    expect(html).toContain('#333748');
    expect(html).toMatch(/#47BA7D|#2f7d55/i);
    expect(html).not.toContain('#0c1a4e');
  });

  test('debrief delivery selects the coach-card brand from the session framework', () => {
    // bd-9652yj: the card sender moved unchanged to coach-report-card.js (the report-ready reply sends it too); the
    // debrief job hands it the session's framework.
    expect(SRC('services/observe/coach-report-card.js')).toMatch(/renderCoachCard\([^)]*brand/);
    expect(SRC('services/observe/observe-debrief.service.js'))
      .toMatch(/sendCoachReportPicture\(from, feedback, S, framework, lang\)/);
  });
});

describe('bd-2453 — commitment-card FICO accent is NIETE green', () => {
  test('card-image framework accent for fico is #47BA7D', () => {
    const src = SRC('services/coaching/coaching-card/card-image.service.js');
    expect(src).toMatch(/fico:\s*'#47BA7D'/i);
    expect(src).not.toMatch(/fico:\s*'#7C3AED'/);
  });
});
