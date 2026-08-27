'use strict';
/**
 * bd-ri5o9.2 — a DEBRIEF was transcribed with the CLASSROOM speaker schema.
 *
 * audio.service.js labels the most-talkative speaker 'Teacher' and everyone else
 * 'Student'. That is right for a lesson. A debrief is two ADULTS — the coach and
 * the teacher — with no students in the room, and it runs through the very same
 * labeller (observe-debrief.service.js:722 → transcribeWithDiarization →
 * _formatTranscriptWithSpeakers).
 *
 * Because the label is decided by WORD COUNT, which adult receives which label
 * is not even consistent. Measured across 520 production debriefs (2026-08-27):
 * the first speaker — essentially always the coach opening the conversation — is
 * labelled 'Teacher' in 417 (80%) and 'Student' in 102 (20%). Two of Javeria
 * Nayyab's own debriefs, same week, carry opposite conventions. A further 84
 * collapsed to a SINGLE label, rendering a two-person conversation as a monologue.
 *
 * Every downstream pass reads that transcript, so "the teacher said…" in a report
 * may be quoting the coach. That is Javeria's "sometimes interpreted incorrectly".
 *
 * The fix is additive and its scope is structural: transcribeWithDiarization has
 * exactly TWO callers in the repo — the classroom path and the debrief path — so
 * an unset `roles` option cannot move the lesson pipeline.
 */
const {
  assignSpeakerLabels,
  CLASSROOM_ROLES,
  DEBRIEF_ROLES,
} = require('../../shared/services/speaker-roles');

const stats = (...counts) =>
  Object.fromEntries(counts.map((n, i) => [`speaker_${i}`, { wordCount: n }]));

describe('bd-ri5o9.2 · the classroom schema is untouched (regression guard)', () => {
  test('two speakers still yield Teacher / Student', () => {
    expect(assignSpeakerLabels(stats(900, 120), CLASSROOM_ROLES))
      .toEqual({ speaker_0: 'Teacher', speaker_1: 'Student' });
  });

  test('extra speakers still yield Student 2, Student 3 — the existing numbering', () => {
    expect(assignSpeakerLabels(stats(900, 120, 80, 40), CLASSROOM_ROLES))
      .toEqual({
        speaker_0: 'Teacher', speaker_1: 'Student',
        speaker_2: 'Student 2', speaker_3: 'Student 3',
      });
  });

  test('a lesson with one voice is still the Teacher', () => {
    expect(assignSpeakerLabels(stats(400), CLASSROOM_ROLES)).toEqual({ speaker_0: 'Teacher' });
  });

  test('classroom NEVER degrades to neutral labels, however even the split', () => {
    // A lesson where a child talks as much as the teacher is unusual but must not
    // change how lessons have always been labelled.
    expect(assignSpeakerLabels(stats(500, 499), CLASSROOM_ROLES))
      .toEqual({ speaker_0: 'Teacher', speaker_1: 'Student' });
  });

  test('the default is the classroom schema — an unset option cannot move the lesson path', () => {
    expect(assignSpeakerLabels(stats(900, 120))).toEqual(
      assignSpeakerLabels(stats(900, 120), CLASSROOM_ROLES));
  });
});

describe('bd-ri5o9.2 · the debrief schema names the two adults', () => {
  test('the dominant speaker is the Coach and the other is the Teacher', () => {
    expect(assignSpeakerLabels(stats(1200, 300), DEBRIEF_ROLES))
      .toEqual({ speaker_0: 'Coach', speaker_1: 'Teacher' });
  });

  test('NO debrief label is ever "Student" — there are no students in the room', () => {
    for (const s of [stats(1200, 300), stats(800, 700, 90), stats(500)]) {
      const labels = Object.values(assignSpeakerLabels(s, DEBRIEF_ROLES));
      expect(labels.join('|')).not.toMatch(/Student/);
    }
  });

  test('a marginal split degrades to neutral labels instead of asserting a role', () => {
    // 80/20 in production means the heuristic is wrong ~1 debrief in 5. Where the
    // evidence is weak, an honest "Speaker 1" beats a confident wrong "Coach".
    expect(assignSpeakerLabels(stats(510, 490), DEBRIEF_ROLES))
      .toEqual({ speaker_0: 'Speaker 1', speaker_1: 'Speaker 2' });
  });

  test('a decisive split still gets real roles', () => {
    expect(assignSpeakerLabels(stats(900, 100), DEBRIEF_ROLES))
      .toEqual({ speaker_0: 'Coach', speaker_1: 'Teacher' });
  });

  test('a single-speaker debrief is neutral, not a monologue by "the Teacher"', () => {
    // 84 of 520 production debriefs collapsed to one speaker.
    expect(assignSpeakerLabels(stats(600), DEBRIEF_ROLES)).toEqual({ speaker_0: 'Speaker 1' });
  });

  test('a third voice in a debrief is neutral, never "Student 2"', () => {
    const labels = assignSpeakerLabels(stats(900, 300, 60), DEBRIEF_ROLES);
    expect(labels.speaker_0).toBe('Coach');
    expect(labels.speaker_1).toBe('Teacher');
    expect(labels.speaker_2).toBe('Speaker 3');
  });

  test('empty or absent stats never throw', () => {
    expect(assignSpeakerLabels({}, DEBRIEF_ROLES)).toEqual({});
    expect(assignSpeakerLabels(null, DEBRIEF_ROLES)).toEqual({});
    expect(assignSpeakerLabels(undefined)).toEqual({});
  });
});

describe('bd-ri5o9.2 · the wiring — both hardcoded sites, and only the debrief caller', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const audio = read('../../shared/services/audio.service.js');
  const debrief = read('../../shared/services/observe/observe-debrief.service.js');
  const classroom = read('../../shared/services/coaching/transcription-processor.service.js');

  test('audio.service.js labels through the shared helper, not its own inline loop', () => {
    expect(audio).toMatch(/assignSpeakerLabels/);
  });

  test('the debrief call site passes the debrief roles', () => {
    expect(debrief).toMatch(/DEBRIEF_ROLES|roles:\s*DEBRIEF/);
  });

  test('the CLASSROOM call site is not edited — it passes no roles at all', () => {
    // The guarantee is structural: the lesson path keeps today's behaviour because
    // nothing about its call changes.
    const call = classroom.match(/transcribeWithDiarization\(tempAudioPath[^)]*\)/);
    expect(call).not.toBeNull();
    expect(call[0]).not.toMatch(/roles/);
  });

  test('the Whisper fallback no longer hardcodes a lesson label on a debrief', () => {
    // The SECOND hardcoded site — transcribeWithDiarization builds a fallback
    // diarization with label:'Teacher' when Soniox returns no tokens. A one-site
    // fix silently leaves this one wrong.
    const idx = classroom.indexOf('Fallback for Whisper');
    expect(idx).toBeGreaterThan(-1);
    const window = classroom.slice(idx, idx + 700);
    expect(window).not.toMatch(/label:\s*'Teacher'/);
  });
});
