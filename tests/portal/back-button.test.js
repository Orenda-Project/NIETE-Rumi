/**
 * Android hardware back key — what one press should do.
 *
 * Before this, the app had no back handling: the key fell through to Android's
 * default, which leaves the app from ANY page — a teacher three screens deep
 * in Training pressed back and was dropped out to the home screen.
 *
 * The rule, in order:
 *   1. An open dialog, sheet or menu closes first (as Escape would).
 *   2. On a home page — the teacher dashboard, the leader home, or the
 *      signed-out login — back leaves the app, even if there is history
 *      behind it. Going "back" from the dashboard to the login form she just
 *      submitted, or to a page she left, is not what back means there.
 *   3. Anywhere else, back goes to the previous page.
 *   4. With nothing behind (she arrived from a tapped link), back leaves the
 *      app — which returns her to WhatsApp, where she came from.
 */

const fs = require('fs');
const path = require('path');

const { HOME_PATHS, OVERLAY_SELECTOR, resolveBackAction } = require('../../portal/src/lib/back-button.cjs');

describe('resolveBackAction', () => {
  it('closes an open dialog/sheet/menu before anything else', () => {
    expect(resolveBackAction({ path: '/portal/curriculum', canGoBack: true, overlayOpen: true })).toBe('close-overlay');
    expect(resolveBackAction({ path: '/portal/dashboard', canGoBack: false, overlayOpen: true })).toBe('close-overlay');
  });

  it.each(['/portal/dashboard', '/portal/leader', '/portal/login', '/'])(
    'leaves the app from the home page %s, even with history behind it',
    (home) => {
      expect(resolveBackAction({ path: home, canGoBack: true, overlayOpen: false })).toBe('leave-app');
      expect(resolveBackAction({ path: home, canGoBack: false, overlayOpen: false })).toBe('leave-app');
    }
  );

  it('treats a trailing slash on a home page as the home page', () => {
    expect(resolveBackAction({ path: '/portal/dashboard/', canGoBack: true })).toBe('leave-app');
  });

  it.each(['/portal/curriculum', '/portal/training/unit/7', '/portal/coaching/session/42', '/portal/leader/teachers'])(
    'goes back from %s when there is a previous page',
    (page) => {
      expect(resolveBackAction({ path: page, canGoBack: true, overlayOpen: false })).toBe('history-back');
    }
  );

  it('leaves the app from an inner page with nothing behind it (arrived from a link)', () => {
    expect(resolveBackAction({ path: '/portal/curriculum', canGoBack: false, overlayOpen: false })).toBe('leave-app');
  });

  it('defaults safely on missing input', () => {
    expect(resolveBackAction()).toBe('leave-app');
    expect(resolveBackAction({ path: '/portal/curriculum' })).toBe('leave-app');
  });

  it('lists exactly the four home pages', () => {
    expect([...HOME_PATHS].sort()).toEqual(['/', '/portal/dashboard', '/portal/leader', '/portal/login']);
  });
});

// bd-5rz1v.10 — a lesson can now keep recording while the teacher uses other
// pages, so Back can walk her to a home page, where Back leaves the app. Android
// silences the microphone of an app in the background, so while a lesson is
// recording (`recordingPath` = where its screen is) the Back that would leave
// goes to the recording instead. Every other Back is unchanged: not trapped.
describe('resolveBackAction while a lesson is recording', () => {
  const recordingPath = '/portal/coaching/new';

  it.each(['/portal/dashboard', '/portal/leader', '/'])(
    'from the home page %s goes to the recording instead of leaving the app',
    (home) => {
      expect(resolveBackAction({ path: home, canGoBack: true, recordingPath })).toBe('to-recording');
      expect(resolveBackAction({ path: home, canGoBack: false, recordingPath })).toBe('to-recording');
    }
  );

  it('from an inner page with nothing behind it goes to the recording', () => {
    expect(resolveBackAction({ path: '/portal/curriculum', canGoBack: false, recordingPath })).toBe('to-recording');
  });

  it('still just goes back where there is a page behind — Back is not trapped', () => {
    expect(resolveBackAction({ path: '/portal/curriculum', canGoBack: true, recordingPath })).toBe('history-back');
    expect(resolveBackAction({ path: recordingPath, canGoBack: true, recordingPath })).toBe('history-back');
  });

  it('on the recording itself with nothing behind, stays rather than going silent in the background', () => {
    expect(resolveBackAction({ path: recordingPath, canGoBack: false, recordingPath })).toBe('stay');
    expect(resolveBackAction({ path: `${recordingPath}/`, canGoBack: false, recordingPath })).toBe('stay');
  });

  it('an open dialog still closes first', () => {
    expect(resolveBackAction({ path: '/portal/dashboard', canGoBack: true, overlayOpen: true, recordingPath })).toBe('close-overlay');
  });

  it('with no recording, nothing changes', () => {
    expect(resolveBackAction({ path: '/portal/dashboard', canGoBack: true, recordingPath: null })).toBe('leave-app');
  });
});

describe('OVERLAY_SELECTOR', () => {
  it('matches the open Radix overlays the portal uses (dialog, alert dialog, menu, select list)', () => {
    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
      expect(OVERLAY_SELECTOR).toContain(`[role="${role}"][data-state="open"]`);
    }
  });
});

describe('App.tsx wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../portal/src/App.tsx'), 'utf8');

  it('mounts the back-button handler inside the router (it needs navigate)', () => {
    const open = app.indexOf('<BrowserRouter') /* bd-fxk3t8: the tag carries future={{ v7_startTransition }} */;
    const handler = app.indexOf('<BackButtonHandler />');
    const close = app.indexOf('</BrowserRouter>');
    expect(open).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(open);
    expect(handler).toBeLessThan(close);
  });
});

describe('native config — the handler is switched on by the web code, not the APK', () => {
  // The plugin's handler stays OFF in the APK and BackButtonHandler turns it on
  // at runtime (toggleBackButtonHandler). So back-key behaviour ships over the
  // air, and a portal rolled back to a bundle without the handler leaves the
  // back key exactly as Android's default — never stuck.
  const config = fs
    .readFileSync(path.join(__dirname, '../../portal/capacitor.config.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('keeps disableBackButtonHandler: true in capacitor.config.ts', () => {
    expect(config).toMatch(/App\s*:\s*\{[\s\S]*disableBackButtonHandler\s*:\s*true/);
  });
});
