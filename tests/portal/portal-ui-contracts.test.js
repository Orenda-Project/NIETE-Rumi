/**
 * bd-2465 / bd-2466 / bd-2467 — source-level guards for three portal UI fixes.
 *
 * These assert on file CONTENTS rather than rendering anything. There is no
 * TSX transform in this test runner and no browser here, so a render test
 * isn't available — but each of these bugs is a specific token being present
 * or absent in a specific file, which is exactly what a future edit would
 * silently undo. That is worth pinning even without a DOM.
 *
 * What these CANNOT tell you: whether it looks right on a phone. The tray
 * layout and the wrapped dropdown rows need a human eye on the PR.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir, exts, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

describe('bd-2465 — every WhatsApp CTA points at NIETE, from one place', () => {
  const NIETE = '923206281951';

  it('the constant is NIETE\'s number', () => {
    const src = read('portal/src/lib/whatsapp.ts');
    expect(src).toContain(`'${NIETE}'`);
  });

  it('Rumi\'s wa.me short-link appears nowhere outside the explanatory comment', () => {
    const offenders = walk('portal/src', ['.ts', '.tsx'])
      .filter((f) => f !== 'portal/src/lib/whatsapp.ts')
      .filter((f) => read(f).includes('WCYNS4DTDB2MD1'));
    expect(offenders).toEqual([]);
  });

  it('no real wa.me URL is hardcoded anywhere but the constant', () => {
    // A short-link hides which number it opens, which is why the wrong bot
    // went unnoticed across 11 call sites. Everything routes through the
    // constant now.
    //
    // `wa.me/<number>` is allowed: that placeholder form appears in comments
    // explaining the shape of the URL, and can't itself point anywhere.
    const REAL_URL = /https:\/\/wa\.me\/(?!<)/;
    const offenders = walk('portal/src', ['.ts', '.tsx'])
      .filter((f) => f !== 'portal/src/lib/whatsapp.ts')
      .filter((f) => REAL_URL.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('every file importing the constant actually uses it', () => {
    const unused = walk('portal/src', ['.ts', '.tsx']).filter((f) => {
      const s = read(f);
      if (!s.includes("from '@/lib/whatsapp'")) return false;
      return (s.match(/WHATSAPP_URL/g) || []).length < 2; // import + >=1 use
    });
    expect(unused).toEqual([]);
  });
});

describe('bd-2466 — the mobile bar carries four items plus a tray', () => {
  const nav = () => read('portal/src/portal/components/PortalNavigation.tsx');

  it('names the four primary destinations', () => {
    expect(nav()).toMatch(/MOBILE_PRIMARY\s*=\s*\[[^\]]*'Dashboard'[^\]]*'Lesson Plans'[^\]]*'Training'[^\]]*'Coaching'[^\]]*\]/s);
  });

  it('renders the overflow in a Sheet, not inline in the bar', () => {
    const s = nav();
    expect(s).toContain('SheetTrigger');
    expect(s).toContain('data-testid="mobile-nav-more"');
  });

  it('moves Logout into the tray', () => {
    const s = nav();
    expect(s).toContain('data-testid="mobile-nav-logout"');
    // the old inline logout button sat directly in the flex row
    expect(s).not.toMatch(/justify-around h-16[\s\S]{0,400}onClick=\{logout\}/);
  });

  it('falls back to the first four when no title matches, so the bar is never empty', () => {
    // Guards a rename of any nav title silently emptying the mobile bar.
    expect(nav()).toMatch(/primaryNav\.length > 0 \? primaryNav : navItems\.slice\(0, 4\)/);
  });

  it('lets bar labels shrink instead of pushing each other out', () => {
    expect(nav()).toMatch(/min-w-0/);
    expect(nav()).toMatch(/truncate/);
  });
});

describe('bd-2467 — Select cannot overflow its control or the viewport', () => {
  const sel = () => read('portal/src/components/ui/select.tsx');

  it('the trigger value can shrink — line-clamp needs min-w-0 on a flex child', () => {
    // Without min-w-0 a flex child keeps min-width:auto and refuses to shrink
    // below its content, so line-clamp-1 never engages and the text spills
    // outside the control. This is bug #5.
    expect(sel()).toContain('[&>span]:min-w-0');
  });

  it('the chevron does not get squashed once the value can shrink', () => {
    expect(sel()).toMatch(/ChevronDown className="h-4 w-4 shrink-0/);
  });

  it('the dropdown panel is capped to the viewport', () => {
    // A long option used to widen the panel indefinitely; on a phone it ran
    // off the screen edge and cropped. This is bug #3.
    const s = sel();
    const caps = (s.match(/max-w-\[calc\(100vw-2rem\)\]/g) || []).length;
    expect(caps).toBeGreaterThanOrEqual(2); // content + viewport
  });

  it('long option rows wrap rather than forcing the panel wider', () => {
    expect(sel()).toContain('whitespace-normal break-words');
  });

  it('the fix lives in the shared primitive, so it applies platform-wide', () => {
    // Every dropdown in the portal composes this file. If a page ever
    // hand-rolls its own trigger it would escape the fix.
    const rogue = walk('portal/src', ['.tsx'])
      .filter((f) => f !== 'portal/src/components/ui/select.tsx')
      .filter((f) => /SelectPrimitive\.Trigger|SelectPrimitive\.Content/.test(read(f)));
    expect(rogue).toEqual([]);
  });
});
