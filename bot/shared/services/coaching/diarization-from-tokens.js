'use strict';
/**
 * Diarization + silence markers from Soniox tokens — the PURE half of
 * TranscriptionProcessorService.transcribeWithDiarization.
 *
 * Moved out verbatim (bd-2kxxa.5) so a repair job can build diarization_data in
 * exactly the shape the live pipeline writes WITHOUT loading the processor,
 * whose top-level requires pull in WhatsApp. The processor's static methods
 * delegate here, so its two callers and its tests are unchanged.
 *
 * Output shape (persisted as coaching_sessions.diarization_data):
 *   { segments:[{speaker,label,text,start_ms,end_ms}],
 *     speakers:[{id,label,tokenCount,segments}], totalSegments, confidence }
 */

const { logToFile } = require('../../utils/logger');

function cleanSegmentText(rawText) {
  return rawText
    .replace(/\s+/g, ' ')
    .replace(/([۔،؟!])([^\s])/g, '$1 $2')
    .replace(/([.?!])([^\s])/g, '$1 $2')
    .trim();
}

/**
 * Build diarization data from Soniox tokens
 * Groups consecutive tokens by speaker and calculates speaker statistics
 *
 * @param {Array} tokens - Array of token objects from Soniox
 * @returns {Object} { segments, speakers, totalSegments, confidence }
 */
function buildDiarizationFromTokens(tokens) {
  // Handle null/empty tokens
  if (!tokens || tokens.length === 0) {
    return {
      segments: [],
      speakers: [],
      totalSegments: 0,
      confidence: 0
    };
  }

  // Calculate token counts per speaker to identify Teacher (most tokens)
  const speakerStats = {};
  tokens.forEach(token => {
    const speakerId = token.speaker || 'unknown';
    if (!speakerStats[speakerId]) {
      speakerStats[speakerId] = { tokenCount: 0 };
    }
    speakerStats[speakerId].tokenCount++;
  });

  // Sort speakers by token count (descending)
  const sortedSpeakers = Object.entries(speakerStats)
    .sort((a, b) => b[1].tokenCount - a[1].tokenCount)
    .map(([id]) => id);

  // Assign labels: speaker with most tokens = Teacher, others = Students
  const speakerLabels = {};
  speakerLabels[sortedSpeakers[0]] = 'Teacher';
  for (let i = 1; i < sortedSpeakers.length; i++) {
    speakerLabels[sortedSpeakers[i]] = i === 1 ? 'Student' : `Student ${i}`;
  }

  // Group consecutive tokens from same speaker into segments
  const segments = [];
  let currentSpeaker = null;
  let currentTokens = [];
  let segmentStartMs = null;

  tokens.forEach((token) => {
    const speakerId = token.speaker || 'unknown';

    if (speakerId !== currentSpeaker) {
      // Speaker changed - save previous segment
      if (currentSpeaker && currentTokens.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          label: speakerLabels[currentSpeaker] || currentSpeaker,
          text: cleanSegmentText(currentTokens.map(t => t.text).join('')),
          start_ms: segmentStartMs,
          end_ms: currentTokens[currentTokens.length - 1].end_ms
        });
      }

      // Start new segment
      currentSpeaker = speakerId;
      currentTokens = [token];
      segmentStartMs = token.start_ms;
    } else {
      // Same speaker - accumulate token
      currentTokens.push(token);
    }
  });

  // Add final segment
  if (currentSpeaker && currentTokens.length > 0) {
    segments.push({
      speaker: currentSpeaker,
      label: speakerLabels[currentSpeaker] || currentSpeaker,
      text: cleanSegmentText(currentTokens.map(t => t.text).join('')),
      start_ms: segmentStartMs,
      end_ms: currentTokens[currentTokens.length - 1].end_ms
    });
  }

  // Build speakers array with segment counts
  const speakers = sortedSpeakers.map(speakerId => ({
    id: speakerId,
    label: speakerLabels[speakerId],
    tokenCount: speakerStats[speakerId].tokenCount,
    segments: segments.filter(s => s.speaker === speakerId)
  }));

  return {
    segments,
    speakers,
    totalSegments: segments.length,
    confidence: 85 // Soniox diarization confidence estimate
  };
}

/**
 * Detect silence gaps in token stream
 * Identifies gaps > 3 seconds between consecutive tokens
 *
 * @param {Array} tokens - Array of token objects from Soniox
 * @param {number} minGapMs - Minimum gap to consider as silence (default: 3000ms)
 * @returns {Array} Array of silence markers { start_ms, end_ms, duration_ms }
 */
function detectSilences(tokens, minGapMs = 3000) {
  if (!tokens || tokens.length < 2) {
    return [];
  }

  const silences = [];

  for (let i = 1; i < tokens.length; i++) {
    const prevToken = tokens[i - 1];
    const currToken = tokens[i];

    const gap = currToken.start_ms - prevToken.end_ms;

    if (gap >= minGapMs) {
      silences.push({
        start_ms: prevToken.end_ms,
        end_ms: currToken.start_ms,
        duration_ms: gap,
        prevText: prevToken.text,
        nextText: currToken.text,
        prevSpeaker: prevToken.speaker,
        nextSpeaker: currToken.speaker
      });
    }
  }

  return silences;
}

/**
 * Turn a raw AudioService.transcribe() result into the object the pipeline
 * persists: { transcript, language, diarization, tokens, silences, cost }.
 * This is the tail of transcribeWithDiarization; both the live processor and
 * the Section B backfill call it so the persisted shape cannot drift.
 *
 * @param {{text:string, language:string, tokens?:Array, source?:string}} transcriptionResult
 * @param {{primary?:string, neutral?:string}|null} [roles] speaker vocabulary; null = CLASSROOM
 */
function assembleDiarizedTranscription(transcriptionResult, roles = null) {
  // Extract tokens from Soniox response (may be empty for Whisper fallback)
  const tokens = transcriptionResult.tokens || [];

  // Build diarization from real tokens (not mock data)
  let diarization;
  if (tokens.length > 0) {
    diarization = buildDiarizationFromTokens(tokens);
    logToFile('Built diarization from Soniox tokens', {
      tokenCount: tokens.length,
      segmentCount: diarization.totalSegments,
      speakerCount: diarization.speakers.length
    });
  } else {
    // Fallback for Whisper (no token-level data).
    // bd-ri5o9.2 — this is the SECOND place a lesson label was hardcoded. A fix
    // applied only to _formatTranscriptWithSpeakers leaves a debrief that fell
    // back to Whisper still calling its single speaker "Teacher".
    const { CLASSROOM_ROLES } = require('../speaker-roles');
    const fallbackLabel = roles
      ? `${roles.neutral || 'Speaker'} 1`   // a debrief: we cannot tell who this is
      : CLASSROOM_ROLES.primary;             // a lesson: one voice is the teacher
    diarization = {
      speakers: [
        { id: 'speaker_0', label: fallbackLabel, tokenCount: 0, segments: [] }
      ],
      segments: [],
      totalSegments: 0,
      confidence: 50 // Lower confidence for Whisper fallback
    };
    logToFile('No tokens available - using fallback diarization (Whisper)', {
      source: transcriptionResult.source || 'unknown'
    });
  }

  // Detect silence markers for enhanced viewer
  const silences = detectSilences(tokens);
  if (silences.length > 0) {
    logToFile('Detected silences in transcript', {
      silenceCount: silences.length,
      totalSilenceMs: silences.reduce((sum, s) => sum + s.duration_ms, 0)
    });
  }

  return {
    transcript: transcriptionResult.text,
    language: transcriptionResult.language,
    diarization,
    tokens,           // Raw tokens for enhanced viewer storage
    silences,         // Silence markers for enhanced viewer
    cost: 0.10        // Approximate Soniox cost
  };
}

module.exports = { buildDiarizationFromTokens, detectSilences, assembleDiarizedTranscription };
