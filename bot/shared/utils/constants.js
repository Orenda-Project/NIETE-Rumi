require('dotenv').config();
const path = require('path');

// Environment Variables
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const SONIOX_API_KEY = process.env.SONIOX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const UPLIFT_API_KEY = process.env.UPLIFT_API_KEY;
const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LOADING_STICKER_MEDIA_ID = process.env.LOADING_STICKER_MEDIA_ID;
const REGISTRATION_SUCCESS_STICKER_MEDIA_ID = process.env.REGISTRATION_SUCCESS_STICKER_MEDIA_ID;
const LISTENING_ANIMATION_MEDIA_ID = process.env.LISTENING_ANIMATION_MEDIA_ID;
const PEDAGOGICAL_ANALYSIS_MEDIA_ID = process.env.PEDAGOGICAL_ANALYSIS_MEDIA_ID;
const MENU_IMAGE_MEDIA_ID = process.env.MENU_IMAGE_MEDIA_ID;
const WABA_ID = process.env.WABA_ID;
const PORT = process.env.PORT || 3000;

// Attendance Flow IDs (registered with Meta)
const ATTENDANCE_SETUP_FLOW_ID = process.env.ATTENDANCE_SETUP_FLOW_ID || '';
const ATTENDANCE_MARKING_FLOW_ID = process.env.ATTENDANCE_MARKING_FLOW_ID || '';
// WhatsApp Flow ID for the user settings form (empty → /settings is disabled).
const SETTINGS_FLOW_ID = process.env.SETTINGS_FLOW_ID || '';
// bd-2712 — STEPS "S" Supervisor Remark Flow. Presence-gated: when unset,
// /remark falls back to the plain-text roster rather than failing.
const REMARK_FLOW_ID = process.env.REMARK_FLOW_ID || '';
// WhatsApp Flow ID for the /status snapshot (empty → /status falls back to a
// plain-text summary instead of the interactive Flow).
const STATUS_FLOW_ID = process.env.STATUS_FLOW_ID || '';
// WhatsApp Flow ID for the Student Video Library picker. When set, /video
// opens the library; when empty, /video uses the runtime video generator.
const STUDENT_VIDEOS_FLOW_ID = process.env.STUDENT_VIDEOS_FLOW_ID || '';
// WhatsApp Flow ID for the homework request flow (empty → /homework replies
// that the feature is not configured).
const HOMEWORK_FLOW_ID = process.env.HOMEWORK_FLOW_ID || '';
// WhatsApp Flow ID for the edit-class roster flow (empty → "edit class" replies
// that the feature is not available).
const EDIT_CLASS_FLOW_ID = process.env.EDIT_CLASS_FLOW_ID || '';
// Class manager — the teacher-facing surface for the classes model
// (CLASSES -> ADD -> SUBJECTS -> SAVED).
const CLASS_MANAGER_FLOW_ID = process.env.CLASS_MANAGER_FLOW_ID || '';
// Roster — coach photographs a class register. Absent = the /roster command does not exist.
const ROSTER_FLOW_ID = process.env.ROSTER_FLOW_ID || '';

// Pic-to-LP (photo → illustrated lesson plan)
const KIE_API_KEY = process.env.KIE_API_KEY;
// Pic-to-LP uses a dedicated Kie.ai key for rate-limit isolation; falls back
// to the shared KIE_API_KEY when a feature-specific key isn't set.
const KIE_API_KEY_PIC_LP = process.env.KIE_API_KEY_PIC_LP || process.env.KIE_API_KEY;
// R2 object key for the NIETE brand mark used as the header logo in generated LPs.
// Defaults to the padded NIETE "N" mark (brand/niete-mark-ondark-v1.png, uploaded
// to this deployment's R2 bucket) so the fork is correct-by-default without a
// Railway env var; still overridable via RUMI_LOGO_R2_KEY. The padded variant
// carries ~21% transparent margin so the mark never crops in the LP header bar.
const RUMI_LOGO_R2_KEY = process.env.RUMI_LOGO_R2_KEY || 'brand/niete-mark-ondark-v1.png';
// WhatsApp Flow ID for the pic-to-LP confirmation form (empty → text fallback).
const PIC_LP_FLOW_ID = process.env.PIC_LP_FLOW_ID || '';
// WhatsApp Flow ID for the Quiz Manager form (empty → text fallback / direct path).
const QUIZ_FLOW_ID = process.env.QUIZ_FLOW_ID || '';
// WhatsApp Flow ID for the Teacher Training home + level detail (empty → text fallback).
const TEACHER_TRAINING_FLOW_ID = process.env.TEACHER_TRAINING_FLOW_ID || '';
// WhatsApp Flow ID for multi-answer ("select all that apply") training quiz
// questions. Empty → those questions fall back to the interactive-list +
// "Done" delivery. Clearing this env var is the rollback lever for the Flow.
const TRAINING_MSQ_FLOW_ID = process.env.TRAINING_MSQ_FLOW_ID || '';
// WhatsApp Flow ID for the Exam Generator (empty → /exam is disabled and replies with a hint).
const EXAM_GENERATOR_FLOW_ID = process.env.EXAM_GENERATOR_FLOW_ID || '';
// WhatsApp Flow ID for the Assessment Generator Service (Orenda-Project/UG_EG).
// Empty → /assessment is disabled and replies with a hint.
const ASSESSMENT_GEN_FLOW_ID = process.env.ASSESSMENT_GEN_FLOW_ID || '';
// WhatsApp Flow ID for the Pakistan LP picker (FEAT-059). Empty → the `lp`
// keyword falls through to the text-intercept path (topic → grade+subject).
const PAKISTAN_LP_FLOW_ID = process.env.PAKISTAN_LP_FLOW_ID || '';
// Teacher-facing WhatsApp number shown in the lesson-plan Coaching Corner
// (empty → the contact line is omitted from the rendered LP).
const COACHING_WHATSAPP_NUMBER = process.env.COACHING_WHATSAPP_NUMBER || '';

// Directory Paths
const TEMP_DIR = path.join(__dirname, '../../temp');
const LOGS_DIR = path.join(__dirname, '../../logs');

// Loading sticker shown while a long-running feature is processing.
// The file is OPTIONAL — `bot/marketing/` ships with a README but no binary
// assets; the cloner brings their own WebP. WhatsAppService.sendSticker
// existsSync-guards this path and skips the send (cosmetic, not blocking)
// when the file isn't there. Set LOADING_STICKER_MEDIA_ID in .env to use a
// pre-uploaded Meta media ID instead of a local file.
const LOADING_STICKER_PATH = path.join(__dirname, '../../marketing/loading-sticker.webp');
const REGISTRATION_VIDEO_MEDIA_ID = process.env.REGISTRATION_VIDEO_MEDIA_ID;

// Test Data (for validation)
const TEST_NUMBERS = ['16315551181', '16505551111', '123456123'];
const TEST_ENTRY_IDS = ['0', 0, null, undefined];

// Timeout Constants
const SONIOX_V3_TIMEOUT = 180; // 3 minutes
const SONIOX_V2_TIMEOUT = 120; // 2 minutes

// Soniox async model cascade (bd-2377, FEAT-106 #1). stt-async-v3 was RETIRED by
// Soniox on 2026-02-28 — the code's old primary was a dead model. The current
// recommended async model is stt-async-v5 (released 2026-06-11); stt-async-v4
// aliases to v5. Env-overridable so a future model rename is a config fix.
const SONIOX_PRIMARY_MODEL = process.env.SONIOX_PRIMARY_MODEL || 'stt-async-v5';
const SONIOX_BACKUP_MODEL = process.env.SONIOX_BACKUP_MODEL || 'stt-async-v4';
const GAMMA_MAX_ATTEMPTS = 60; // Maximum polling attempts for Gamma
const GAMMA_POLL_INTERVAL = 5000; // 5 seconds between polls
const KIE_MAX_ATTEMPTS = 60;    // Maximum polling attempts for Kie.ai (8s × 60 = 8 min ceiling)
const KIE_POLL_INTERVAL = 8000; // 8 seconds between polls (matches Kie.ai recommendation)
const MESSAGE_MAX_AGE = 23 * 60 * 60; // 23 hours in seconds

// MMS-ASR Service Configuration (for regional Pakistani languages)
const MMS_SERVICE_URL = process.env.MMS_SERVICE_URL || 'http://localhost:8000';
const MMS_TIMEOUT_MS = parseInt(process.env.MMS_TIMEOUT_MS) || 60000; // 60 seconds
const MMS_API_KEY = process.env.MMS_API_KEY || ''; // API key for authentication

// Voice Configuration (Phase 3: Multi-language support)
// Voice IDs are env-var overridable for clone deployments
const UPLIFT_VOICE_ID = process.env.UPLIFT_VOICE_ID_UR || 'v_8eelc901'; // Info/Education voice - Fast and easy to understand (Urdu)
const UPLIFT_SINDHI_VOICE_ID = process.env.UPLIFT_VOICE_ID_SD || 'v_sd0kl3m9'; // Sindhi voice
const UPLIFT_BALOCHI_VOICE_ID = process.env.UPLIFT_VOICE_ID_BAL || 'v_bl1de2f7'; // Balochi voice

// Eleven Labs Voice IDs (v3 model with emotion tag support)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9'; // Jessica voice (English)
const ELEVENLABS_SPANISH_VOICE_ID = process.env.ELEVENLABS_VOICE_ID_ES || 'vYui54mlc1I9tFZBBz4i'; // Cony Iglesias (Spanish)
const ELEVENLABS_ARABIC_VOICE_ID = process.env.ELEVENLABS_VOICE_ID_AR || '4wf10lgibMnboGJGCLrP'; // Farah (Arabic)
// bd-2375 (FEAT-106 #4b): Urdu coaching voice is Sara — "Warm Storyteller, Urdu &
// Hindi" on eleven_v3. This is the canonical Urdu voice locked by the LP-voicenotes
// V20 work (Jessica + Roman-Urdu was wrong; Sara + Nastaliq is right). Replaces the
// Uplift "Info/Education" voice that mangled code-switched English tokens.
const ELEVENLABS_URDU_VOICE_ID = process.env.ELEVENLABS_VOICE_ID_UR || '9cI5mhBtM4WtQ9Fo6jWQ'; // Sara (Urdu)

// Voice Model Routing Configuration
// Tier 1: Full support (coaching + reading assessment)
// Tier 2: Coaching only (no reading assessment)
const VOICE_MODELS = {
  // Tier 1: Full support
  en: { provider: 'elevenlabs', voiceId: ELEVENLABS_VOICE_ID, supportsEmotionTags: true, tier: 1 },
  // supportsEmotionTags flipped true (bd-njn7u 4.2): false was an Uplift-era
  // leftover — the voice moved to Sara/eleven_v3 (bd-2375), which RENDERS
  // audio tags, but the flag never followed. The v8 voicenote corpus ships
  // [slowly]-style cues on this exact voice+model, operator ear-checked.
  ur: { provider: 'elevenlabs', voiceId: ELEVENLABS_URDU_VOICE_ID, supportsEmotionTags: true, tier: 1 }, // Sara / eleven_v3 (was Uplift v_8eelc901 — bd-2375)

  // Tier 2: Coaching only
  es: { provider: 'elevenlabs', voiceId: ELEVENLABS_SPANISH_VOICE_ID, supportsEmotionTags: true, tier: 2 },
  ar: { provider: 'elevenlabs', voiceId: ELEVENLABS_ARABIC_VOICE_ID, supportsEmotionTags: true, tier: 2 },
  'pa-PK': { provider: 'elevenlabs', voiceId: ELEVENLABS_VOICE_ID, supportsEmotionTags: true, tier: 2 }, // Pakistani Punjabi (Shahmukhi)
  'ps-PK': { provider: 'elevenlabs', voiceId: ELEVENLABS_VOICE_ID, supportsEmotionTags: true, tier: 2 }, // Pakistani Pashto
  'sd-PK': { provider: 'uplift', voiceId: UPLIFT_SINDHI_VOICE_ID, supportsEmotionTags: false, tier: 2 }, // Sindhi
  'bal-PK': { provider: 'uplift', voiceId: UPLIFT_BALOCHI_VOICE_ID, supportsEmotionTags: false, tier: 2 }, // Balochi
  'ta-LK': { provider: 'elevenlabs', voiceId: ELEVENLABS_VOICE_ID, supportsEmotionTags: true, tier: 2 } // Sri Lankan Tamil
};

// Message Limits
const PROCESSED_MESSAGES_LIMIT = 1000;
const PROCESSED_MESSAGES_CLEANUP = 100;
const CONVERSATION_HISTORY_LIMIT = 11; // System message + 10 messages

// Rate Limiting (env-configurable for clone deployments)
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 30; // Max messages per window
const RATE_LIMIT_WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS, 10) || 60; // Window in seconds

module.exports = {
  // Environment Variables
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  WEBHOOK_VERIFY_TOKEN,
  SONIOX_API_KEY,
  ELEVENLABS_API_KEY,
  UPLIFT_API_KEY,
  GAMMA_API_KEY,
  OPENAI_API_KEY,
  LOADING_STICKER_MEDIA_ID,
  REGISTRATION_SUCCESS_STICKER_MEDIA_ID,
  LISTENING_ANIMATION_MEDIA_ID,
  PEDAGOGICAL_ANALYSIS_MEDIA_ID,
  MENU_IMAGE_MEDIA_ID,
  WABA_ID,
  PORT,

  // Attendance Flow IDs
  ATTENDANCE_SETUP_FLOW_ID,
  ATTENDANCE_MARKING_FLOW_ID,
  SETTINGS_FLOW_ID,
  REMARK_FLOW_ID,
  STATUS_FLOW_ID,
  STUDENT_VIDEOS_FLOW_ID,
  HOMEWORK_FLOW_ID,
  EDIT_CLASS_FLOW_ID,
  CLASS_MANAGER_FLOW_ID,
  ROSTER_FLOW_ID,

  // Pic-to-LP
  KIE_API_KEY,
  KIE_API_KEY_PIC_LP,
  RUMI_LOGO_R2_KEY,
  PIC_LP_FLOW_ID,
  QUIZ_FLOW_ID,
  TEACHER_TRAINING_FLOW_ID,
  TRAINING_MSQ_FLOW_ID,
  EXAM_GENERATOR_FLOW_ID,
  ASSESSMENT_GEN_FLOW_ID,
  PAKISTAN_LP_FLOW_ID,
  COACHING_WHATSAPP_NUMBER,

  // Directory Paths
  TEMP_DIR,
  LOGS_DIR,
  LOADING_STICKER_PATH,
  REGISTRATION_VIDEO_MEDIA_ID,

  // Test Data
  TEST_NUMBERS,
  TEST_ENTRY_IDS,

  // Timeouts
  SONIOX_V3_TIMEOUT,
  SONIOX_V2_TIMEOUT,
  SONIOX_PRIMARY_MODEL,
  SONIOX_BACKUP_MODEL,
  GAMMA_MAX_ATTEMPTS,
  GAMMA_POLL_INTERVAL,
  KIE_MAX_ATTEMPTS,
  KIE_POLL_INTERVAL,
  MESSAGE_MAX_AGE,

  // MMS-ASR Service
  MMS_SERVICE_URL,
  MMS_TIMEOUT_MS,
  MMS_API_KEY,

  // Voice
  UPLIFT_VOICE_ID,
  UPLIFT_SINDHI_VOICE_ID,
  UPLIFT_BALOCHI_VOICE_ID,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_URDU_VOICE_ID, // bd-2651: Sara — needed by video-script Urdu voice routing
  ELEVENLABS_SPANISH_VOICE_ID,
  ELEVENLABS_ARABIC_VOICE_ID,
  VOICE_MODELS,

  // Limits
  PROCESSED_MESSAGES_LIMIT,
  PROCESSED_MESSAGES_CLEANUP,
  CONVERSATION_HISTORY_LIMIT,

  // Rate Limiting
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS
};
