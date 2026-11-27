'use strict';
// bd-8sr958 — the order the plan fixes: repair BEFORE the portal short-recording gate and BEFORE the duplicate check;
// a damaged failure never reaches the generic "please try again" text.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../shared/services/coaching/transcription-processor.service.js'), 'utf8');

describe('processTranscription wiring', () => {
  test('the repair step runs before the portal short-recording gate', () => {
    const early = src.indexOf('repairBeforeTranscription');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(src.indexOf('ShortGate.refuseShortPortalRecording'));
  });
  test('the repair step also runs before the audio hash / duplicate check on the WhatsApp path', () => {
    const second = src.indexOf('repairBeforeTranscription', src.indexOf('repairBeforeTranscription') + 10);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(src.indexOf('computeAudioHash(audioData)'));
  });
  test('handleTranscriptionError sends a damaged recording to the damaged handler before any generic message', () => {
    const handler = src.indexOf('handleDamagedFailure');
    expect(handler).toBeGreaterThan(0);
    expect(handler).toBeLessThan(src.indexOf('Sorry, there was an error transcribing your classroom audio'));
  });
  test('"all three transcribers refused" is still marked permanent (#6112) and then handled as damaged', () => {
    expect(src.indexOf('markPermanentIfUnreadable(error)')).toBeLessThan(src.indexOf('Damaged.asDamaged(error)'));
  });
});
