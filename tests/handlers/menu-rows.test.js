/**
 * bd-2504 — the /menu list shows Training first, and no longer offers Reading
 * Assessment or AI Video Generation.
 *
 * Operator decision 2026-08-02: those two are not part of what NIETE teachers
 * are being asked to do, and Training — the thing they ARE being asked to do —
 * was missing from the menu entirely.
 *
 * The ROWS are removed; the HANDLERS are deliberately kept. WhatsApp list rows
 * persist in scrollback forever, so a teacher tapping "Reading Assessment" from
 * a message sent last week must still land somewhere sensible. Removing the
 * handler would turn an old tap into an unknown-selection error — the same
 * class of bug as bd-2454.
 *
 * ── Row 122 (2026-09-15) ──────────────────────────────────────────────────
 * The rows are no longer a literal in whatsapp.service: they are built per
 * role by config/role-features.featureMenuRows, because DC and HITL are
 * role-shaped and the menu said so nowhere. These assertions therefore read
 * the builder rather than scraping the source, and every bd-2504 guarantee
 * above is re-asserted against it — for EVERY role, so no role can lose
 * Training or gain a removed row.
 */
const fs = require('fs');
const path = require('path');

const MENU = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/menu.service.js'), 'utf8');
const WA = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/whatsapp.service.js'), 'utf8');
const { featureMenuRows } = require('../../bot/shared/config/role-features');

const ROLES = ['teacher', 'principal', 'coach', null];
const ids = (role) => featureMenuRows(role === null ? null : { id: 'u', role },
  { observeEnabled: true }).map((r) => r.id);

describe('bd-2504 — menu rows', () => {
  it('offers Training, and offers it FIRST, to every role', () => {
    for (const role of ROLES) {
      expect(ids(role)).toContain('menu_training');
      expect(ids(role)[0]).toBe('menu_training');
    }
  });

  it('no longer offers Reading Assessment or AI Video Generation', () => {
    for (const role of ROLES) {
      expect(ids(role)).not.toContain('menu_reading');
      expect(ids(role)).not.toContain('menu_video');
    }
  });

  it('keeps the surviving options', () => {
    for (const role of ROLES) {
      expect(ids(role)).toEqual(expect.arrayContaining(['menu_lesson_plan', 'menu_other']));
    }
    // menu_coaching survives for the roles that may self-coach.
    expect(ids('teacher')).toContain('menu_coaching');
    expect(ids('principal')).toContain('menu_coaching');
  });

  it("stays within WhatsApp's 10-row list cap for every role", () => {
    for (const role of ROLES) expect(ids(role).length).toBeLessThanOrEqual(10);
  });
});

describe('row 122 — the list is built per role, not hardcoded', () => {
  it('whatsapp.service builds its rows from the role map', () => {
    expect(WA).toMatch(/featureMenuRows/);
  });

  it('no stray hardcoded menu_ row survives in the list payload', () => {
    const start = WA.indexOf("title: 'My Features'");
    expect(start).toBeGreaterThan(-1);
    const block = WA.slice(start, start + 1200);
    expect(block).not.toMatch(/id:\s*'menu_[a-z_]+'/);
  });

  it('the menu carries the user through to the row builder', () => {
    expect(WA).toMatch(/sendFeatureMenuListFallback\s*\(\s*to\s*,\s*user/);
    expect(MENU).toMatch(/sendFeatureMenuCarousel\(from,\s*user\)/);
  });
});

describe('bd-2504 — removed rows keep their handlers', () => {
  it('still handles a menu_reading tap from scrollback', () => {
    expect(MENU).toMatch(/case 'menu_reading'/);
  });

  it('still handles a menu_video tap from scrollback', () => {
    expect(MENU).toMatch(/case 'menu_video'/);
  });

  it('handles the new menu_training selection', () => {
    expect(MENU).toMatch(/case 'menu_training'/);
  });

  it('handles the new menu_observe selection', () => {
    expect(MENU).toMatch(/case 'menu_observe'/);
  });
});
