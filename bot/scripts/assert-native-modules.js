#!/usr/bin/env node
'use strict';
/**
 * bd-vq0mfv: fail the install, not the boot, when the optional native `canvas` did not install.
 * npm drops a failed optional dependency silently ("added 731 packages" against 783 on the same commit, 27 Oct 2026),
 * the build then passes, and the sqs-worker crashed at boot. Run from bot's postinstall, a missing canvas fails the
 * build instead, so Railway keeps the previous deployment serving, and the load error lands in the build log.
 * Local escape hatch (a machine without the cairo/pango libraries): ALLOW_MISSING_CANVAS=1.
 */
try {
  require('canvas');
  console.log('[assert-native-modules] canvas OK');
} catch (error) {
  const msg = `[assert-native-modules] canvas failed to load: ${error.message}`;
  if (process.env.ALLOW_MISSING_CANVAS === '1') {
    console.warn(`${msg} (ALLOW_MISSING_CANVAS=1: continuing; exam annotation will be disabled)`);
    process.exit(0);
  }
  console.error(`${msg}\n[assert-native-modules] failing the install so the previous deployment keeps serving. Set ALLOW_MISSING_CANVAS=1 to skip locally.`);
  process.exit(1);
}
