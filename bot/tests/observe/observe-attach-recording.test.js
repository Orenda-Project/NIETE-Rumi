'use strict';
/**
 * bd-twyobl (queue #289) — the pure parts of the one-off ops script that attaches a recording WhatsApp refused
 * (Meta 131052) to the coach's planned /observe visit, as an inbound voice note would have been captured.
 */
const {
  oggOpusDurationSeconds,
  buildObservationRow,
  checkVisit,
  muteSends,
} = require('../../scripts/ops/observe-attach-recording');

// A minimal Ogg Opus stream: an OpusHead page (pre-skip 312) and a last page whose granule is 48 000 * 10 + 312.
function oggPage(granule, payload) {
  const h = Buffer.alloc(27);
  h.write('OggS', 0, 'ascii');
  h.writeBigUInt64LE(BigInt(granule), 6);
  h[26] = 1;
  return Buffer.concat([h, Buffer.from([payload.length]), payload]);
}
function opusHead(preSkip) {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'ascii');
  b[8] = 1; b[9] = 1;
  b.writeUInt16LE(preSkip, 10);
  return b;
}

describe('oggOpusDurationSeconds', () => {
  test('reads the last granule position minus the pre-skip, at 48 kHz', () => {
    const buf = Buffer.concat([oggPage(0, opusHead(312)), oggPage(48000 * 10 + 312, Buffer.from('x'))]);
    expect(oggOpusDurationSeconds(buf)).toBeCloseTo(10, 5);
  });
  test('refuses a file that is not Ogg Opus', () => {
    expect(() => oggOpusDurationSeconds(Buffer.from('ID3 not an ogg file'))).toThrow(/Ogg Opus/);
  });
});

describe('buildObservationRow', () => {
  const base = {
    observerId: 'obs-1', teacherUserId: 'tch-1', chatSessionId: 'chat-1', durationSeconds: 1158.5,
    nowIso: '2026-11-26T12:00:00.000Z',
  };
  test('is observe-capture.startFromAudio\'s row, field for field, with no WhatsApp media id', () => {
    expect(buildObservationRow({ ...base, framework: null })).toEqual({
      user_id: 'tch-1',
      session_id: 'chat-1',
      audio_id: null,
      audio_duration_seconds: 1159,
      status: 'confirmed',
      observation_type: 'leader_observation',
      observer_user_id: 'obs-1',
      debrief_status: 'pending',
      created_at: '2026-11-26T12:00:00.000Z',
    });
  });
  test('carries the v6 stamp exactly as startFromAudio writes it', () => {
    const row = buildObservationRow({ ...base, framework: 'fico17_v6' });
    expect(row.framework).toBe('fico17_v6');
    expect(row.framework_selection_reason).toBe('coach_rubric_switch');
  });
});

describe('checkVisit', () => {
  const schedule = {
    id: 'sch-1', leader_user_id: 'obs-1', teacher_ext_id: '923000000001', teacher_name: 'AAMIR AYAZ',
    school_ext_id: 'niete:419', status: 'upcoming', session_id: null,
  };
  const teacher = { id: 'tch-1', name: 'AAMIR AYAZ', role: 'teacher', phone_number: '+923000000001', deleted_at: null };
  const observer = { id: 'obs-1', role: 'coach', phone_number: '+923000000009', deleted_at: null };
  test('an upcoming visit of this teacher by this coach passes', () => {
    expect(checkVisit({ schedule, teacher, observer, expectTeacherId: 'tch-1' })).toEqual({ ok: true });
  });
  test('a visit that already has a recording is refused', () => {
    expect(checkVisit({ schedule: { ...schedule, status: 'done', session_id: 'x' }, teacher, observer, expectTeacherId: 'tch-1' }))
      .toEqual({ ok: false, reason: 'visit_not_upcoming' });
  });
  test('a teacher whose phone is not the visit\'s is refused', () => {
    expect(checkVisit({ schedule, teacher: { ...teacher, phone_number: '+923000000002' }, observer, expectTeacherId: 'tch-1' }))
      .toEqual({ ok: false, reason: 'teacher_not_the_visits' });
  });
  test('a teacher other than the one expected is refused', () => {
    expect(checkVisit({ schedule, teacher, observer, expectTeacherId: 'tch-2' }))
      .toEqual({ ok: false, reason: 'teacher_not_expected' });
  });
  test('a non-leader observer is refused', () => {
    expect(checkVisit({ schedule, teacher, observer: { ...observer, role: 'teacher' }, expectTeacherId: 'tch-1' }))
      .toEqual({ ok: false, reason: 'observer_not_a_leader' });
  });
});

describe('muteSends', () => {
  test('every send* method is replaced, records the call and sends nothing', async () => {
    const real = jest.fn();
    const svc = { sendMessage: real, sendSticker: real, downloadMedia: jest.fn(() => 'kept') };
    const calls = muteSends(svc);
    await svc.sendMessage('+92', 'hi');
    await svc.sendSticker('+92', 'id');
    expect(real).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: 'sendMessage' }, { method: 'sendSticker' }]);
    expect(svc.downloadMedia()).toBe('kept');
  });
});
