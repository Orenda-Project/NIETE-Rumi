/**
 * Teacher Portal API Routes
 * Handles authentication and data access for teacher portal
 * Version: 2.8.1 - Reading Assessments Integration
 *
 * Endpoints:
 * - POST /api/portal/validate-token - Validate invitation token
 * - POST /api/portal/setup - Complete portal setup (set password)
 * - POST /api/portal/login - Log in to portal
 * - POST /api/portal/logout - Log out from portal
 * - POST /api/portal/request-reset - Request password reset code
 * - POST /api/portal/verify-reset-code - Verify reset code
 * - POST /api/portal/reset-password - Reset password with code
 * - GET /api/portal/dashboard - Get dashboard stats
 * - GET /api/portal/lesson-plans - Get all lesson plans
 * - GET /api/portal/coaching-sessions - Get all coaching sessions
 * - GET /api/portal/coaching-session/:id - Get single coaching session detail
 * - GET /api/portal/coaching-analytics - Get coaching score trends
 * - GET /api/portal/reading-assessments - Get all reading assessments (paginated + filters)
 * - GET /api/portal/reading-assessment/:id - Get single reading assessment detail
 * - GET /api/portal/reading-stats - Get reading assessment summary stats
 * - GET /api/portal/reading-analytics - Get reading assessment trends over time
 *
 * Related: TEACHER_PORTAL_IMPLEMENTATION_PLAN.md, READING_ASSESSMENTS_PORTAL_INTEGRATION_PLAN.md
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
// bd-60085 — bands go over the internal API, NOT by requiring the bot in-process.
//
// This was `require('../../bot/shared/services/training/band-selection.service')`, and saving
// grades answered 500: that module reaches bot/shared/config/supabase.js, whose `require('dotenv')`
// resolves from /app/bot/node_modules then /app/node_modules and never /app/dashboard/node_modules
// where dotenv actually is. The portal service installs only the ROOT package.json, which does
// not carry it, and never installs bot/ at all. Same trap certificates.service.js documents.
const TrainingBands = require('../services/training-bands.service');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { generatePresignedUrl, generatePresignedUrls, isValidR2Url } = require('../services/r2.service');
const axios = require('axios');
const { fetchAllPaged } = require('../lib/fetch-all-paged');
// bd-5rz1v.10 — lesson plan PDFs, relayed through this origin for the portal's viewer.
const { relayLessonPlanPdf } = require('../lib/lesson-plan-file');
// bd-5rz1v.15 — every lesson plan she opens here is recorded (niete_lp_opens), fire-and-forget,
// and read back as her recent plans; bd-5rz1v.17 — the Home's counts for a Pakistan-time range.
const LpActivity = require('../services/lp-activity.service');
const Progress = require('../services/progress.service');
const { resolveRange, RangeInputError } = require('../lib/pk-range');
// bd-2469 — the portal's single source of training decisions. Asks the bot;
// holds no rules of its own. See dashboard/services/training-rules.service.js.
const TrainingRules = require('../services/training-rules.service');
// bd-2673 — the multi-answer predicate, from the bot's marking module.
//
// Required directly rather than over HTTP, unlike the decisions above, and that
// is deliberate: paper-marking.service.js has ZERO requires of its own, so it
// cannot drag in the queue driver / aws-sdk mismatch that made bd-2461 forbid
// requiring bot code here. Same precedent as CAPSTONE_PASS_PCT and
// issueCertificate, already required from this file. Anything in it that needs a
// DB read or the vendor's bar stays behind the internal API.
const { isMultiKey } = require('../../bot/shared/services/training/paper-marking.service');
const { readingsForCourse } = require('../../bot/shared/services/training/isaps-readings.rules');
const { buildIsapsScoreSheet } = require('../../bot/shared/services/training/isaps-score-sheet.rules');
// bd-2460 — Assessment Generator availability. Fail-closed, shared with the
// bot via one app_settings row (see dashboard/lib/feature-flags.js).
const {
  isAssessmentGeneratorEnabled,
  ASSESSMENT_GENERATOR_OFF_MESSAGE,
  isFlagEnabledForUser,
  PORTAL_SELF_OBSERVATION_KEY,
  PORTAL_COACH_OBSERVATION_KEY,
  PORTAL_NEW_UI_KEY,
  isPortalAssessmentEditingEnabled,
  PORTAL_COACH_V2_KEY,
  PORTAL_TEACHER_V2_KEY,
  isCoachObservationOn,
} = require('../lib/feature-flags');
// bd-2434 — Leader Portal (NIETE port of upstream bd-2385..2388):
// role gate (school-leader family only) + framework-agnostic overall score.
const { publicUserPayload, makeRequireLeaderRole } = require('../lib/leader-role');
const { resolveUserSchoolName } = require('../lib/user-school-name');
// A coach's observation of her is the teacher's to see only once it is SENT to her.
const TeacherObservation = require('../lib/teacher-observation');
const { getOverall } = require('../services/coaching-frameworks.service');
const { narrativeView } = require('../services/report-narrative-view'); // bd-fmf24g.10
// Leader "patch" resolver (leader_teachers → Rumi users + activity) needs the
// pg pool — the LATERAL-join SQL can't be expressed through supabase-js.
const pool = require('../config/database');
/** The pool as a plain (sql, params) function — what the activity and progress services take. */
const dbQuery = (sql, params) => pool.query(sql, params);
// TERMINAL is imported rather than respelled: two spellings of "finished" is
// exactly how 629 observations went missing once.
const { getPatchTeachers, TERMINAL } = require('../services/leader-patch.service');
// My Patch overview aggregation (pure, over the resolver output).
const { summarizePatch } = require('../services/leader-overview.service');
// school-level coaching analytics for a principal (pure, over the
// school's scored sessions).
const { summarizeSchoolAnalytics } = require('../services/school-analytics.service');
// the remaining two STEPS components. P is two separate figures on
// purpose (the teacher:student weighting is still unresolved); S delegates its
// /20 math to remark-rubric rather than restating it.
const { summarizePresence } = require('../services/steps-presence.service');
const { summarizeRemarks, remarksReceived } = require('../services/steps-remarks.service');
// attendance, merged per group (G3) and split per day.
const { summarizeGroups, summarizeByDay } = require('../services/attendance-detail.service');
// Single teacher detail (patch-membership guarded).
const { getPatchTeacherDetail } = require('../services/leader-teacher-detail.service');
// The coach's /observe world (upcoming schedules + pending debriefs + past
// observations) — bd-2455.
const { getLeaderObservations } = require('../services/leader-observations.service');
// bd-2676 — the portal's WRITE side for scheduled visits (create + cancel).
const { createSchedule, cancelSchedule } = require('../services/leader-schedule-write.service');
const ObserveNotice = require('../services/observe-notice.service');
// bd-o15qnr.11 — Edit teacher: the patch guard here, the /observe teacher admin in the bot.
const CoachTeacherAdmin = require('../services/coach-teacher-admin.service');
const ObserveTeacherAdmin = require('../services/observe-teacher-admin.client');
// bd-88krt — coach self-service: edit a visit, own the school list, search by name.
const {
  editSchedule, searchSchools, addSchool, removeSchool, searchTeachers,
} = require('../services/leader-assignment.service');

// Configure R2 S3 client for private PDF access. Lazy — resolved on first
// use, not at module load, so mounting these routes never depends on R2 env
// vars being set (mirrors the no-eager-sdk-construction guard contract).
let _r2Client = null;
function getR2Client() {
  if (_r2Client) return _r2Client;
  _r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Required for CloudFlare R2 (uses path-style URLs)
  });
  return _r2Client;
}

// ============================================================================
// RATE LIMITING (SECURITY)
// ============================================================================

/**
 * SECURITY: Extra aggressive rate limiting for public authentication endpoints
 * Prevents brute force attacks and enumeration attempts
 *
 * TEMPORARY: DISABLED FOR TESTING - MUST RE-ENABLE BEFORE PRODUCTION
 * PRODUCTION VALUES: windowMs: 60 * 60 * 1000 (1 hour), max: 10
 * TESTING VALUES: DISABLED (max: 10000)
 */
const publicAuthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // TEMP: 1 minute window
  max: 10000, // TEMP: Effectively disabled
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests (prevents timing attacks)
  keyGenerator: (req) => {
    // Use IP + endpoint to prevent cross-endpoint abuse
    return `${req.ip}-${req.path}`;
  }
});

/**
 * SECURITY: Very strict rate limiting for token validation (prevent enumeration)
 *
 * TEMPORARY: DISABLED FOR TESTING - MUST RE-ENABLE BEFORE PRODUCTION
 * PRODUCTION VALUES: windowMs: 60 * 60 * 1000 (1 hour), max: 5
 * TESTING VALUES: DISABLED (max: 10000)
 */
const tokenValidationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // TEMP: 1 minute window
  max: 10000, // TEMP: Effectively disabled
  message: 'Too many validation attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Input validation helpers (SECURITY: Prevent injection attacks)
 */
function validatePhoneNumber(phone) {
  // International format: Country code + number (10-15 digits total)
  // Supports: Pakistan (92), Oman (968/971), UAE (971), Saudi (966), UK (44), US (1), etc.
  if (!phone || typeof phone !== 'string') return false;

  // Remove all whitespace
  phone = phone.replace(/\s+/g, '');

  // Must be numeric and between 10-15 digits (international standard)
  const regex = /^[0-9]{10,15}$/;
  return regex.test(phone);
}

function validateUUID(token) {
  // UUID v4 format
  if (!token || typeof token !== 'string') return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(token);
}

function validatePassword(password) {
  // 8+ chars, at least 1 number
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8 && /\d/.test(password);
}

function sanitizePhoneNumber(phone) {
  // NIETE is PK-only: canonicalize to E.164 without the leading '+'
  // so DB lookups (which store `923XXXXXXXXX`) always match user input.
  // Accepted inputs: '03361234567', '3361234567', '+92 336 1234567',
  //                  '0092 336 1234567', '923361234567', with any spaces/dashes.
  if (!phone || typeof phone !== 'string') return phone;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return '92' + digits.slice(1);
  if (digits.startsWith('3') && digits.length === 10) return '92' + digits;
  return digits;
}

/**
 * Middleware to check if user is authenticated for portal
 * ENHANCED: Comprehensive logging for mobile debugging
 */
const requirePortalAuth = (req, res, next) => {
  // MOBILE DEBUGGING: Log all authentication attempts with detailed context
  const authDebugInfo = {
    hasSession: !!req.session,
    hasPortalUserId: !!(req.session && req.session.portalUserId),
    sessionId: req.session ? req.session.id : null,
    userAgent: req.get('User-Agent'),
    hasCookieHeader: !!req.headers.cookie,
    cookieHeaderLength: req.headers.cookie ? req.headers.cookie.length : 0,
    origin: req.get('Origin'),
    referer: req.get('Referer'),
    method: req.method,
    path: req.path,
    ip: req.ip
  };

  console.log('🔐 Portal Auth Check:', authDebugInfo);

  if (!req.session || !req.session.portalUserId) {
    console.log('❌ Portal Auth Failed:', {
      reason: !req.session ? 'No session object' : 'No portalUserId in session',
      ...authDebugInfo
    });

    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Please log in.',
      // MOBILE DEBUGGING: Include debug info in response (only for non-production)
      debug: process.env.NODE_ENV !== 'production' ? authDebugInfo : undefined
    });
  }

  console.log('✅ Portal Auth Success:', {
    userId: req.session.portalUserId,
    sessionId: req.session.id
  });

  next();
};

/**
 * Get user by phone number
 */
async function getUserByPhone(phoneNumber) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (error) {
    throw error;
  }

  return user;
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  return user;
}

// bd-2434 — server-side gate for the leader-only endpoints below. Client-side
// nav gating is UX; this is the real access control.
const requireLeaderRole = makeRequireLeaderRole({ getUser: getUserById });

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * GET /api/portal/auth/verify
 * Verify current session status
 * MOBILE DEBUGGING: Helps diagnose mobile session/cookie issues
 */
router.get('/auth/verify', (req, res) => {
  const sessionInfo = {
    authenticated: !!(req.session && req.session.portalUserId),
    userId: req.session?.portalUserId || null,
    sessionId: req.session?.id || null,
    hasSession: !!req.session,
    hasCookie: !!req.headers.cookie,
    cookieLength: req.headers.cookie ? req.headers.cookie.length : 0,
    userAgent: req.get('User-Agent'),
    origin: req.get('Origin'),
    referer: req.get('Referer')
  };

  console.log('🔍 Session Verification Request:', sessionInfo);

  res.json({
    success: true,
    ...sessionInfo
  });
});

/**
 * POST /api/portal/validate-token
 * Validate invitation token for portal setup
 * SECURITY: Generic errors to prevent token enumeration + strict rate limiting
 */
router.post('/validate-token', tokenValidationLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    // Validate input format
    if (!token || !validateUUID(token)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid invitation link. Please check the link and try again.'
      });
    }

    // Query user with this token
    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone_number, portal_activated, portal_invite_expires_at, name')
      .eq('portal_invite_token', token)
      .single();

    // SECURITY: Generic error - don't reveal if token exists or is expired
    if (error || !user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired invitation link. Please request a new link via WhatsApp.'
      });
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(user.portal_invite_expires_at);

    if (now > expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired invitation link. Please request a new link via WhatsApp.'
      });
    }

    // Check if already activated
    if (user.portal_activated) {
      return res.status(400).json({
        success: false,
        error: 'This portal account is already set up. Please log in instead.',
        redirectToLogin: true
      });
    }

    res.json({
      success: true,
      user: {
        firstName: user.name,
        // No surname column since V1.4.4; the setup screen joins first + last,
        // so echoing `name` here printed it twice.
        lastName: null,
        phoneNumber: user.phone_number
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/**
 * POST /api/portal/setup
 * Complete portal setup - set password and activate account
 * SECURITY: Input validation, session regeneration, and rate limiting
 */
router.post('/setup', publicAuthLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    // Validate inputs
    if (!token || !validateUUID(token)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid invitation link'
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters and contain at least one number'
      });
    }

    // Get user with token
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, portal_activated, portal_invite_expires_at')
      .eq('portal_invite_token', token)
      .single();

    // SECURITY: Generic error
    if (userError || !user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired invitation link'
      });
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(user.portal_invite_expires_at);

    if (now > expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired invitation link'
      });
    }

    // Check if already activated
    if (user.portal_activated) {
      return res.status(400).json({
        success: false,
        error: 'Portal already activated. Please log in instead.'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user - activate portal and set password
    const { error: updateError } = await supabase
      .from('users')
      .update({
        portal_password_hash: passwordHash,
        portal_activated: true,
        portal_last_login: new Date().toISOString(),
        // SECURITY: Clear invitation token after use (single-use)
        portal_invite_token: null,
        portal_invite_expires_at: null
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    // SECURITY: Regenerate session ID (prevent session fixation)
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({
          success: false,
          error: 'Setup failed. Please try again.'
        });
      }

      // Set new session data
      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;

      res.json({
        success: true,
        message: 'Portal setup complete! Redirecting to dashboard...'
      });
    });
  } catch (error) {
    console.error('Portal setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/**
 * POST /api/portal/login
 * Log in to teacher portal
 * SECURITY: Input validation, generic errors, session regeneration, and rate limiting
 */
router.post('/login', publicAuthLimiter, async (req, res) => {
  try {
    let { phoneNumber, password } = req.body;

    // Validate inputs
    if (!phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and password are required'
      });
    }

    phoneNumber = sanitizePhoneNumber(phoneNumber);
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number.'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, portal_password_hash, portal_activated, name')
      .eq('phone_number', phoneNumber)
      .eq('portal_activated', true)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: 'No portal account found for this phone number.'
      });
    }

    const validPassword = await bcrypt.compare(password, user.portal_password_hash);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Incorrect password. Please try again.'
      });
    }

    // Update last login
    await supabase
      .from('users')
      .update({
        portal_last_login: new Date().toISOString()
      })
      .eq('id', user.id);

    // SECURITY: Regenerate session ID (prevent session fixation)
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({
          success: false,
          error: 'Login failed. Please try again.'
        });
      }

      // Set new session data
      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;
      req.session.portalUserName = user.name;

      res.json({
        success: true,
        message: 'Login successful',
        // bd-2434: includes `role` so the frontend can gate the leader nav / My Patch.
        user: publicUserPayload(user)
      });
    });
  } catch (error) {
    console.error('Portal login error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/**
 * POST /api/portal/logout
 * Log out from portal
 */
router.post('/logout', requirePortalAuth, (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to log out'
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

/**
 * POST /api/portal/request-reset
 * Request password reset code via WhatsApp
 * SECURITY: Generic responses to prevent phone number enumeration + rate limiting
 */
router.post('/request-reset', publicAuthLimiter, async (req, res) => {
  try {
    let { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    phoneNumber = sanitizePhoneNumber(phoneNumber);
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid phone number.'
      });
    }

    const PasswordResetService = require('../services/password-reset.service');

    const rateLimitCheck = await PasswordResetService.checkRateLimit(phoneNumber);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: rateLimitCheck.error || 'Too many attempts. Please wait a moment and try again.'
      });
    }

    const result = await PasswordResetService.sendResetCode(phoneNumber);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error || 'No portal account found for this phone number.'
      });
    }

    res.json({
      success: true,
      message: 'A reset code has been sent to your WhatsApp.'
    });
  } catch (error) {
    console.error('Request reset error:', error);
    // SECURITY: Generic error message
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/**
 * POST /api/portal/verify-reset-code
 * Verify password reset code
 * SECURITY: Input validation, generic error messages, and rate limiting
 */
router.post('/verify-reset-code', publicAuthLimiter, async (req, res) => {
  try {
    let { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and code are required'
      });
    }

    // Sanitize and validate phone number
    phoneNumber = sanitizePhoneNumber(phoneNumber);
    if (!validatePhoneNumber(phoneNumber)) {
      // SECURITY: Generic error - don't reveal phone format issue
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired code. Please request a new reset code.'
      });
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired code. Please request a new reset code.'
      });
    }

    const PasswordResetService = require('../services/password-reset.service');

    const result = await PasswordResetService.verifyResetCode(phoneNumber, code);

    if (!result.valid) {
      // SECURITY: Generic error - same message for wrong code or expired
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired code. Please request a new reset code.'
      });
    }

    // Store userId in session temporarily for password reset
    req.session.resetUserId = result.userId;

    res.json({
      success: true,
      message: 'Code verified. You can now reset your password.'
    });
  } catch (error) {
    console.error('Verify reset code error:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/**
 * POST /api/portal/reset-password
 * Reset password with verified code
 * SECURITY: Input validation and session cleanup
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.session.resetUserId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Please verify your reset code first'
      });
    }

    // Validate password using helper function
    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters and contain at least one number'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update password and clear reset code
    const { data: user, error } = await supabase
      .from('users')
      .update({
        portal_password_hash: passwordHash,
        password_reset_code: null,
        password_reset_expires_at: null,
        portal_last_login: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id, country, role, name')
      .maybeSingle();

    if (error) {
      throw error;
    }

    // Clear the one-shot reset grant BEFORE opening a real session, so the
    // code can never be replayed even if session setup fails below.
    delete req.session.resetUserId;

    // The password has now changed. Everything from here is a convenience —
    // if the row didn't come back we still must not fail the request, or the
    // teacher is told the reset failed when it actually succeeded.
    if (!user) {
      console.error('Reset succeeded but user row not returned:', userId);
      return res.json({
        success: true,
        message: 'Password reset successful. Please sign in with your new password.'
      });
    }

    // bd-2513: log the teacher straight in rather than bouncing them to an
    // empty login form to retype the number and the password they just chose.
    //
    // This is not trusting the client: `userId` came from
    // `req.session.resetUserId`, which /verify-reset-code wrote server-side
    // after checking the WhatsApp code. We already proved who this is — the
    // old behaviour just threw that proof away.
    //
    // SECURITY: Regenerate session ID (prevent session fixation) — same
    // pattern as the /login handler above.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        // The password DID change. Don't fail the request — fall back to the
        // old behaviour and let them log in manually.
        console.error('Session regeneration error after reset:', regenErr);
        return res.json({
          success: true,
          message: 'Password reset successful. Please sign in with your new password.'
        });
      }

      req.session.portalUserId = user.id;
      req.session.isPortalAuth = true;
      req.session.portalUserName = user.name;

      res.json({
        success: true,
        message: 'Password reset successful.',
        // bd-2434: carries `role` so the client can route a leader to My Patch.
        user: publicUserPayload(user)
      });
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

// ============================================================================
// DATA ENDPOINTS (Protected)
// ============================================================================

/**
 * The signed-in user as the app holds her: /dashboard and /me answer exactly this.
 * bd-2434: includes `role` (+ contact fields) via the shared shaper.
 */
function sessionUserPayload(req, user, schoolName) {
  return {
    ...publicUserPayload(user, { includeContact: true }),
    schoolName,
  };
}

/**
 * GET /api/portal/me — who is signed in, and nothing else (bd-fxk3t8).
 *
 * The app asks this before it can draw any page (portal AuthProvider). It used to ask
 * /dashboard, which also counts her sessions, assessments and training — 0.9–1.2 s on
 * sandbox. Same user, same shape, no counts.
 */
router.get('/me', requirePortalAuth, async (req, res) => {
  try {
    const user = await getUserById(req.session.portalUserId);
    res.json({ success: true, user: sessionUserPayload(req, user, await resolveUserSchoolName(supabase, user)) });
  } catch (error) {
    console.error('portal/me error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your account' });
  }
});

/**
 * GET /api/portal/dashboard
 * Get dashboard overview stats
 */
router.get('/dashboard', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    // Get user first (critical - must succeed)
    const user = await getUserById(userId).catch(err => {
      console.error('Failed to get user:', err);
      throw err;  // User is critical, must fail
    });

    // Her own school, for the My account page. Started now so it runs alongside
    // the counts below; it never rejects (null when unknown or unreadable).
    const schoolNamePromise = resolveUserSchoolName(supabase, user);

    // Counts, gathered with allSettled so one dead table cannot blank the page.
    //
    // bd-60079 — the lesson_plans count is gone. It counted her own
    // Gamma-generated output, and custom generation is off, so the number was
    // frozen at whatever she reached and could never move again. A headline
    // metric that cannot change is not a metric.
    //
    // In its place: training and assessments, both read from tables the bot
    // already writes. Nothing new is stored for this.
    const [coachingSessionsResult, assessmentsResult, progressResult] = await Promise.allSettled([
      supabase
        .from('coaching_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed'),
      supabase
        .from('assessment_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      // Modules she has completed, with the course each belongs to so they can
      // be attributed to a level. INSERT-only table: a row IS a completion,
      // there is no status to filter on.
      supabase
        .from('teacher_training_progress')
        .select('module_id, training_modules!inner(course_id, is_active)')
        .eq('user_id', userId)
        .eq('training_modules.is_active', true),
    ]);

    // The training breakdown: what she has DONE, and where she is up to.
    //
    // Deliberately NOT "X of Y". An earlier cut showed modules completed over
    // every active module in the catalogue (384), which was wrong twice over:
    // a teacher only sees the levels her programme scopes her to, and — the
    // operator's correction — even within that scope she is not expected to
    // finish everything. A fraction states a target that does not exist, and
    // it makes steady progress look like permanent incompleteness.
    //
    // So: a count of what she has completed, and the level she is furthest
    // into. Both are facts about her, neither implies a finish line.
    const training = await (async () => {
      const empty = { modulesCompleted: 0, currentLevel: null };
      if (progressResult.status !== 'fulfilled') return empty;

      const rows = progressResult.value.data || [];
      if (!rows.length) return empty;

      const doneCourseIds = [...new Set(rows
        .map((r) => r.training_modules && r.training_modules.course_id)
        .filter(Boolean))];
      if (!doneCourseIds.length) return { modulesCompleted: rows.length, currentLevel: null };

      const { data: courses } = await supabase
        .from('training_courses')
        .select('level_id')
        .in('id', doneCourseIds);

      const levelIds = [...new Set((courses || []).map((c) => c.level_id).filter(Boolean))];
      if (!levelIds.length) return { modulesCompleted: rows.length, currentLevel: null };

      // Furthest along = the highest order_index she has touched, which is the
      // level she is working through rather than the one she started in.
      const { data: levels } = await supabase
        .from('training_levels')
        .select('name, order_index')
        .in('id', levelIds)
        .order('order_index', { ascending: false })
        .limit(1);

      return {
        modulesCompleted: rows.length,
        currentLevel: (levels && levels[0] && levels[0].name) || null,
      };
    })().catch(() => ({ modulesCompleted: 0, currentLevel: null }));

    // bd-60079 — the recent-lesson-plans fetch is gone with the card that
    // rendered it. It read `lesson_plans` (her own Gamma output) and the
    // dashboard no longer returns them, so keeping the query would be three
    // rows fetched on every page load for nobody.

    // Get recent coaching session with error handling
    // FIXED: Removed .single() to prevent crash when no results
    const recentCoachingSessionData = await supabase
      .from('coaching_sessions')
      .select('id, created_at, analysis_data')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('analysis_data', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      // REMOVED .single() - now returns array
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch recent coaching session:', error);
          return null;
        }
        return data && data.length > 0 ? data[0] : null;
      });

    // Return partial data even if some queries failed
    res.json({
      success: true,
      user: sessionUserPayload(req, user, await schoolNamePromise),
      stats: {
        totalCoachingSessions: coachingSessionsResult.status === 'fulfilled' ? (coachingSessionsResult.value.count || 0) : 0,
        totalAssessments: assessmentsResult.status === 'fulfilled' ? (assessmentsResult.value.count || 0) : 0,
        training
      },
      recentCoachingSession: recentCoachingSessionData ? {
        id: recentCoachingSessionData.id,
        date: recentCoachingSessionData.created_at,
        session_date: recentCoachingSessionData.created_at,
        // bd-2434: framework-agnostic overall score. NIETE FICO stores
        // scores.{overall_marks, overall_max_marks, overall_percentage} —
        // getOverall normalises that AND the legacy max_marks/percentage shape
        // (the old inline read showed 0% for FICO rows).
        ...(() => {
          const o = getOverall(recentCoachingSessionData.analysis_data);
          return { score: o.points, overallScore: o.points, maxScore: o.maxPoints || 118, percentage: o.percentage };
        })()
      } : null
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load dashboard data'
    });
  }
});

// ============================================================================
// LEADER PORTAL (bd-2434, NIETE port of upstream bd-2385+) — school-leader
// family only. Every route below is guarded by requireLeaderRole (server-side),
// which loads the user once and attaches it as req.portalUser.
// ============================================================================

/**
 * GET /api/portal/leader/me
 * Session hydration for the leader portal — confirms the caller is in the
 * leader family (the gate 403s otherwise) and returns their identity so the
 * "My Patch" home can greet them by name. The overview KPIs / roster arrive on
 * the dedicated endpoints below.
 */
router.get('/leader/me', requirePortalAuth, requireLeaderRole, async (req, res) => {
  res.json({
    success: true,
    user: publicUserPayload(req.portalUser, { includeContact: true })
  });
});

/**
 * GET /api/portal/leader/overview
 * "My Patch" home data — headline KPIs across the leader's patch (teacher count,
 * how many are on Rumi, total coaching sessions + lesson plans, average recent
 * score) and a focus list (on-Rumi teachers with the lowest recent scores).
 */
router.get('/leader/overview', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const teachers = await getPatchTeachers(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      // a principal's patch is her own school, not a coach's school
      // assignments. requireLeaderRole already loaded the row, so the role
      // costs no extra round-trip.
      { role: req.portalUser && req.portalUser.role }
    );
    res.json({ success: true, overview: summarizePatch(teachers) });
  } catch (error) {
    console.error('leader/overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your patch overview.' });
  }
});

/**
 * GET /api/portal/leader/teachers
 * The leader's whole patch — every teacher migrated into Rumi under them
 * (leader_teachers), each joined to their Rumi activity (coaching sessions,
 * lesson plans, last framework-agnostic score). Teachers not yet on Rumi are
 * included with onRumi:false so the leader sees their full patch.
 */
router.get('/leader/teachers', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const teachers = await getPatchTeachers(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      // a principal's patch is her own school, not a coach's school
      // assignments. requireLeaderRole already loaded the row, so the role
      // costs no extra round-trip.
      { role: req.portalUser && req.portalUser.role }
    );
    res.json({
      success: true,
      total: teachers.length,
      onRumi: teachers.filter((t) => t.onRumi).length,
      teachers
    });
  } catch (error) {
    console.error('leader/teachers error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your teachers.' });
  }
});

/**
 * GET /api/portal/leader/teacher/:id
 * One teacher's detail — but ONLY if they're in this leader's patch (the
 * resolver proves membership and returns null otherwise, so a leader cannot view
 * a teacher outside their patch). :id is the teacher's Rumi user id.
 */
router.get('/leader/teacher/:id', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const detail = await getPatchTeacherDetail(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      req.params.id,
      // a principal proves membership through her own school.
      { role: req.portalUser && req.portalUser.role }
    );
    if (!detail) {
      return res.status(404).json({ success: false, error: 'Teacher not found in your patch.' });
    }
    res.json({ success: true, ...detail });
  } catch (error) {
    console.error('leader/teacher/:id error:', error);
    res.status(500).json({ success: false, error: 'Failed to load teacher detail.' });
  }
});

/**
 * The attendance window: ?from=&to= (inclusive dates). Blank ends are open —
 * all time, like every other part of Analytics, which is where this report
 * now lives (operator, 2026-09-30). The denominator stays "days somebody
 * marked", so an open window never invents a term. Anything that is not a
 * real YYYY-MM-DD is dropped, never passed to SQL.
 */
function attendanceWindow(query = {}) {
  const ok = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
  return { from: ok(query.from), to: ok(query.to) };
}

/**
 * The attendance detail for a set of teachers: their classes' registers
 * (students) and their own days (staff), each as merged groups and by day.
 * Shared by the principal's page and a teacher's own page, so both read the
 * same bars from the same rules.
 */
async function buildAttendanceReport(userIds, from, to) {
  const [studentRows, staffRows] = await Promise.all([
    // class_name already contains the section — appending it yields
    // "Grade 2 - A-A" (measured on prod).
    pool.query(
      `SELECT s.session_date::text AS date,
              COALESCE(sl.class_name, 'Unnamed class') AS "group",
              s.total_students AS total,
              s.present_count  AS present
         FROM attendance_sessions s
         LEFT JOIN student_lists sl ON sl.id = s.list_id
        WHERE s.user_id = ANY($1::uuid[])
          AND ${inWindow('s.session_date', '$2', '$3')}
        ORDER BY s.session_date ASC`,
      [userIds, from, to]
    ),
    // Staff: one "group" per teacher, so the same summariser serves both.
    // present/absent are per-person, hence total 1 per row; leave is NOT an
    // absence and is excluded from the register entirely.
    pool.query(
      `SELECT r.date::text AS date,
              COALESCE(u.name, 'Unnamed teacher') AS "group",
              1 AS total,
              CASE WHEN r.status = 'present' THEN 1 ELSE 0 END AS present,
              r.status
         FROM teacher_attendance_records r
         JOIN users u ON u.id = r.teacher_id
        WHERE r.teacher_id = ANY($1::uuid[])
          AND ${inWindow('r.date', '$2', '$3')}
        ORDER BY r.date ASC`,
      [userIds, from, to]
    ),
  ]);

  // The window's school days are the days SOMEBODY marked anything. Without
  // a school calendar this is the only defensible denominator — inventing
  // one from weekday arithmetic would state a term we do not know.
  const dayset = new Set();
  for (const r of studentRows.rows) dayset.add(r.date);
  for (const r of staffRows.rows) dayset.add(r.date);
  const schoolDays = [...dayset].sort();

  // Leave is not an absence: a teacher on approved leave is dropped from the
  // register rather than counted against her.
  const staffSessions = staffRows.rows
    .filter((r) => r.status !== 'leave')
    .map((r) => ({ group: r.group, date: r.date, total: 1, present: Number(r.present) }));

  const studentSessions = studentRows.rows.map((r) => ({
    group: r.group, date: r.date, total: Number(r.total), present: Number(r.present),
  }));


  return {
    schoolDays,
    students: {
      groups: summarizeGroups(studentSessions, schoolDays),
      byDay: summarizeByDay(studentSessions, schoolDays),
    },
    staff: {
      groups: summarizeGroups(staffSessions, schoolDays),
      byDay: summarizeByDay(staffSessions, schoolDays),
    },
  };
}

/**
 * GET /api/portal/my-attendance
 *
 * The Attendance page, for a teacher: the same report as the principal's,
 * scoped to ONE person — the signed-in teacher's classes and her own days.
 * The scope is the session, never the request: a ?teacherId= is ignored.
 */
router.get('/my-attendance', requirePortalAuth, async (req, res) => {
  try {
    const { from, to } = attendanceWindow(req.query);
    const report = await buildAttendanceReport([req.session.portalUserId], from, to);
    res.json({ success: true, from, to, focusTeacher: null, teachers: [], ...report });
  } catch (error) {
    console.error('my-attendance error:', error);
    res.status(500).json({ success: false, error: 'Failed to load attendance.' });
  }
});

/**
 * GET /api/portal/leader/attendance
 *
 * the attendance detail, in the two shapes settled on the design
 * canvas (operator, 2026-09-17):
 *   · `groups`  (G3) every grade merged across its children AND its days, one
 *     row each on one scale. The dashboard default.
 *   · `byDay`   the same groups split back out per day, for the detail page.
 *   · `staff`   the same two shapes for teachers, so one grammar covers both.
 *
 * Filters: ?from=&to= (dates, inclusive) and ?teacherId= (one teacher's own
 * classes). The teacher id is validated against her roster and 404s otherwise,
 * the same boundary the rest of this page uses.
 *
 * PRINCIPALS ONLY, like the analytics tab beside it.
 */
router.get('/leader/attendance', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const role = req.portalUser && req.portalUser.role;
    if (String(role || '').trim().toLowerCase() !== 'principal') {
      return res.status(403).json({ success: false, error: 'Attendance is available to principals.' });
    }

    const teachers = await getPatchTeachers(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      { role }
    );

    const requestedTeacherId = (req.query.teacherId || '').trim() || null;
    let focusTeacher = null;
    if (requestedTeacherId) {
      focusTeacher = teachers.find((t) => t.rumiUserId === requestedTeacherId) || null;
      if (!focusTeacher) {
        return res.status(404).json({ success: false, error: 'Teacher not found in your school.' });
      }
    }

    const { from, to } = attendanceWindow(req.query);

    const scopeTeachers = focusTeacher ? [focusTeacher] : teachers;
    const userIds = scopeTeachers.filter((t) => t.rumiUserId).map((t) => t.rumiUserId);

    if (userIds.length === 0) {
      return res.json({
        success: true, from, to,
        focusTeacher: null,
        teachers: [],
        schoolDays: [],
        students: { groups: [], byDay: [] },
        staff: { groups: [], byDay: [] },
      });
    }

    const report = await buildAttendanceReport(userIds, from, to);

    res.json({
      success: true,
      from, to,
      focusTeacher: focusTeacher
        ? { id: focusTeacher.rumiUserId, name: focusTeacher.name }
        : null,
      teachers: teachers
        .filter((t) => t.rumiUserId)
        .map((t) => ({ id: t.rumiUserId, name: t.name, isPrincipal: t.isPrincipal })),
      ...report,
    });
  } catch (error) {
    console.error('leader/attendance error:', error);
    res.status(500).json({ success: false, error: 'Failed to load attendance.' });
  }
});

/**
 * GET /api/portal/leader/school-analytics
 *
 * the Analytics tab, asked of a principal's SCHOOL rather than of
 * her own handful of sessions. (Across all 460 principals there are 46 own
 * completed sessions in total — 0.10 each — so "her own coaching data" is not
 * a view worth giving her. Her school's is: sampling 40 principals, 34 had
 * scored sessions, some with 68, 79, 135.)
 *
 * PRINCIPALS ONLY, by decision. requireLeaderRole lets the whole leader family
 * through, so this 403s the other four rather than silently showing an AEO or
 * a coach a one-school slice of a patch that actually spans many — a wrong
 * answer in the shape of a right one. Roster scoping comes from the session
 * user id via the same resolver the roster uses, never from a query param.
 */
router.get('/leader/school-analytics', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const role = req.portalUser && req.portalUser.role;
    if (String(role || '').trim().toLowerCase() !== 'principal') {
      return res.status(403).json({
        success: false,
        error: 'School analytics is available to principals.'
      });
    }

    // Same patch resolver the roster uses, so the two can never disagree about
    // who is in this school.
    const teachers = await getPatchTeachers(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      { role }
    );

    // optional ?teacherId= narrows every component to one teacher
    // ("build teacher report card individually", Osama 2026-09-10). It is
    // VALIDATED AGAINST THE PATCH, never trusted: an id that is not in her
    // school 404s rather than quietly scoping to someone else's teacher. This
    // is the same boundary the teacher drawer enforces.
    const requestedTeacherId = (req.query.teacherId || '').trim() || null;
    let focusTeacher = null;
    if (requestedTeacherId) {
      focusTeacher = teachers.find((t) => t.rumiUserId === requestedTeacherId) || null;
      if (!focusTeacher) {
        return res.status(404).json({ success: false, error: 'Teacher not found in your school.' });
      }
    }

    const scopeTeachers = focusTeacher ? [focusTeacher] : teachers;
    const userIds = scopeTeachers.filter((t) => t.rumiUserId).map((t) => t.rumiUserId);
    const range = analyticsRange(req.query);
    const w = [range.from, range.to];

    // One round-trip per STEPS component, all scoped to the same id set, so a
    // filtered view and the school view can never disagree about who counts.
    const [sessionRows, teacherAttRows, studentSessRows, remarkRows, outputRows] = await Promise.all([
      // S/T/E — TERMINAL, not status='completed': a leader observation never
      // reaches 'completed', and filtering on it hid the entire
      // observation programme once already.
      userIds.length ? pool.query(
        `SELECT c.created_at, c.analysis_data, c.observation_type, u.name AS teacher_name
           FROM coaching_sessions c
           JOIN users u ON u.id = c.user_id
          WHERE c.user_id = ANY($1::uuid[])
            AND c.status IN ${TERMINAL}
            AND c.analysis_data IS NOT NULL
            AND ${inWindow(pkDay('c.created_at'), '$2', '$3')}
          ORDER BY c.created_at ASC`, [userIds, ...w]) : { rows: [] },

      // P (teacher) — keyed by teacher_id, so it filters with the same ids.
      userIds.length ? pool.query(
        `SELECT status, date
           FROM teacher_attendance_records
          WHERE teacher_id = ANY($1::uuid[])
            AND ${inWindow('date', '$2', '$3')}
          ORDER BY date ASC`, [userIds, ...w]) : { rows: [] },

      // P (students) — attendance_sessions.user_id is the teacher who MARKED
      // the register, which is how a student roll reaches a school at all.
      userIds.length ? pool.query(
        `SELECT total_students, present_count, session_date
           FROM attendance_sessions
          WHERE user_id = ANY($1::uuid[])
            AND ${inWindow('session_date', '$2', '$3')}
          ORDER BY session_date ASC`, [userIds, ...w]) : { rows: [] },

      // S (supervisor remarks) — the principal's own quarterly forms, with
      // their per-indicator scores folded in. Only her remarks (she is the
      // author), about teachers in the scope above.
      userIds.length ? pool.query(
        `SELECT r.id, r.teacher_id, r.submitted_at, r.comment_text, r.cycle_id,
                COALESCE(
                  json_agg(json_build_object('ordinal', sc.indicator_ordinal, 'score', sc.score)
                           ORDER BY sc.indicator_ordinal)
                  FILTER (WHERE sc.id IS NOT NULL), '[]'
                ) AS scores
           FROM supervisor_remarks r
           LEFT JOIN supervisor_remark_scores sc ON sc.remark_id = r.id
          WHERE r.teacher_id = ANY($1::uuid[])
            AND r.principal_user_id = $2
            AND ${inWindow(pkDay('r.submitted_at'), '$3', '$4')}
          GROUP BY r.id`, [userIds, req.session.portalUserId, ...w]) : { rows: [] },

      // Lesson plans and exams, in the same window and the same scope.
      userIds.length ? countOutputs(userIds, w) : { rows: [{ lesson_plans: 0, exams: 0 }] },
    ]);
    const outputs = (outputRows.rows && outputRows.rows[0]) || {};

    const remarks = (remarkRows.rows || []).map((r) => ({
      teacherId: r.teacher_id,
      submittedAt: r.submitted_at,
      comment: r.comment_text || null,
      scores: Array.isArray(r.scores) ? r.scores : [],
    }));

    res.json({
      success: true,
      range,
      school: {
        name: (teachers.find((t) => t.schoolName) || {}).schoolName || null,
        totalTeachers: teachers.length,
        onRumi: teachers.filter((t) => t.onRumi).length,
        // Lesson plans and ready exams, in the date window and the same scope.
        totalLessonPlans: Number(outputs.lesson_plans) || 0,
        totalExams: Number(outputs.exams) || 0,
      },
      // The filter's own state, so the page renders the right heading without
      // re-deriving who was asked for.
      focusTeacher: focusTeacher
        ? { id: focusTeacher.rumiUserId, name: focusTeacher.name }
        : null,
      // Every teacher in the school, for the filter control. Name + id only.
      teachers: teachers
        .filter((t) => t.rumiUserId)
        .map((t) => ({ id: t.rumiUserId, name: t.name, isPrincipal: t.isPrincipal })),
      analytics: summarizeSchoolAnalytics(sessionRows.rows || []),
      presence: summarizePresence(teacherAttRows.rows || [], studentSessRows.rows || []),
      remarks: summarizeRemarks(remarks),
    });
  } catch (error) {
    console.error('leader/school-analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your school analytics.' });
  }
});

/**
 * The Analytics page's date window (operator, 2026-09-30): ?from=&to=, both
 * optional and inclusive. Blank is all time — what the page showed before the
 * filter existed. Anything that is not a real YYYY-MM-DD is dropped, never
 * passed to SQL.
 */
function analyticsRange(query = {}) {
  const ok = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) ? v : null);
  return { from: ok(query.from), to: ok(query.to) };
}

/** A timestamp read as the Pakistan-time day it happened on. */
const pkDay = (col) => `(${col} AT TIME ZONE 'Asia/Karachi')::date`;

/**
 * `expr` falls inside [$a, $b], either end open when its parameter is NULL.
 * `expr` is a date: a plain date column as-is, a timestamp through pkDay().
 */
const inWindow = (expr, a, b) =>
  `(${a}::date IS NULL OR ${expr} >= ${a}::date) AND (${b}::date IS NULL OR ${expr} <= ${b}::date)`;

/**
 * Lesson plans and READY exams for a set of teachers, inside the window.
 * The same two definitions the patch roster counts all-time: every lesson
 * plan, and only papers that finished generating.
 */
function countOutputs(userIds, [from, to]) {
  return pool.query(
    `SELECT
       (SELECT count(*) FROM lesson_plans l
         WHERE l.user_id = ANY($1::uuid[])
           AND ${inWindow(pkDay('l.created_at'), '$2', '$3')}) AS lesson_plans,
       (SELECT count(*)
          FROM assessment_papers p
          JOIN assessment_requests r ON r.id = p.request_id
         WHERE r.user_id = ANY($1::uuid[]) AND p.status = 'ready'
           AND ${inWindow(pkDay('p.created_at'), '$2', '$3')}) AS exams`,
    [userIds, from, to]
  );
}

/**
 * GET /api/portal/my-analytics
 * A TEACHER's own Analytics page: the same sections her principal sees when
 * she picks that teacher (operator, 2026-09-30) — observations, attendance,
 * the remarks she received — plus lesson plans and exams generated.
 *
 * Scoped to the session user and nothing else: there is no id parameter to
 * trust. Two differences from the principal's view, both decided:
 *   · her Digital Coach Observations carry their ratings (rateDigital);
 *   · remarks are the ones she RECEIVED, with the comment and each area.
 */
router.get('/my-analytics', requirePortalAuth, async (req, res) => {
  try {
    const me = req.session.portalUserId;
    const range = analyticsRange(req.query);
    const w = [range.from, range.to];
    const [sessionRows, teacherAttRows, studentSessRows, remarkRows, counts] = await Promise.all([
      pool.query(
        `SELECT created_at, analysis_data, observation_type
           FROM coaching_sessions
          WHERE user_id = $1
            AND status IN ${TERMINAL}
            AND analysis_data IS NOT NULL
            -- A coach's observation counts for her once it is sent, never as a draft.
            AND ${TeacherObservation.VISIBLE_TO_TEACHER_SQL}
            AND ${inWindow(pkDay('created_at'), '$2', '$3')}
          ORDER BY created_at ASC`, [me, ...w]),
      pool.query(
        `SELECT status, date FROM teacher_attendance_records
          WHERE teacher_id = $1 AND ${inWindow('date', '$2', '$3')}
          ORDER BY date ASC`, [me, ...w]),
      pool.query(
        `SELECT total_students, present_count, session_date
           FROM attendance_sessions
          WHERE user_id = $1 AND ${inWindow('session_date', '$2', '$3')}
          ORDER BY session_date ASC`, [me, ...w]),
      pool.query(
        `SELECT r.submitted_at, r.comment_text, c.name AS cycle_name,
                COALESCE(
                  json_agg(json_build_object('ordinal', sc.indicator_ordinal, 'score', sc.score)
                           ORDER BY sc.indicator_ordinal)
                  FILTER (WHERE sc.id IS NOT NULL), '[]'
                ) AS scores
           FROM supervisor_remarks r
           JOIN evaluation_cycles c ON c.id = r.cycle_id
           LEFT JOIN supervisor_remark_scores sc ON sc.remark_id = r.id
          WHERE r.teacher_id = $1
            AND ${inWindow(pkDay('r.submitted_at'), '$2', '$3')}
          GROUP BY r.id, c.name`, [me, ...w]),
      countOutputs([me], w),
    ]);
    const c = (counts.rows && counts.rows[0]) || {};
    res.json({
      success: true,
      range,
      totals: { lessonPlans: Number(c.lesson_plans) || 0, examsGenerated: Number(c.exams) || 0 },
      analytics: summarizeSchoolAnalytics(sessionRows.rows || [], { rateDigital: true }),
      presence: summarizePresence(teacherAttRows.rows || [], studentSessRows.rows || []),
      remarksReceived: remarksReceived(remarkRows.rows || []),
    });
  } catch (error) {
    console.error('my-analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your analytics.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MY PROGRESS — the new Home (bd-5rz1v.17, server half)
// ───────────────────────────────────────────────────────────────────────────
// Five activity counts for a date range — lesson plans used, training modules completed, Digital
// Coaching + observations, assessments made, attendance marked — and the list behind each tile.
// Activity, not ratings: a rating appears only inside the coaching list, as a band. Every rule is
// in services/progress.service.js; the range (calendar periods in Pakistan time) in
// lib/pk-range.js. The teacher is the SESSION's user — there is no id parameter to trust.

/** A bad range is hers to fix (400); anything else is ours (500). */
function rangeFrom(req, res) {
  try {
    return resolveRange(req.query);
  } catch (error) {
    if (error instanceof RangeInputError) {
      res.status(400).json({ success: false, error: error.message });
      return null;
    }
    throw error;
  }
}

/**
 * GET /api/portal/progress?range=this_week|this_month|last_3_months|this_year|all|custom&from=&to=
 * → { success, range: { key, from, to, timezone },
 *     lessonPlans: { used, opened, received, days }, training: { completed },
 *     coaching: { total, digitalCoach, observations }, assessments: { made },
 *     attendance: { days, registers, unit: 'days' } }
 * Default range: this_month.
 */
router.get('/progress', requirePortalAuth, async (req, res) => {
  const range = rangeFrom(req, res);
  if (!range) return undefined;
  try {
    const counts = await Progress.progressCounts(dbQuery, req.session.portalUserId, range);
    return res.json({ success: true, range, ...counts });
  } catch (error) {
    console.error('❌ Portal progress failed', { error: error?.message });
    return res.status(500).json({ success: false, error: 'Could not load your progress' });
  }
});

/**
 * GET /api/portal/progress/:metric?range=…&limit=
 *   :metric = lesson-plans | coaching | training | assessments | attendance
 * → { success, range, metric, total, truncated, items: [...] }
 * The items behind one tile for the SAME range; `total` is the tile's own number. ?limit=
 * defaults to 50, at most 200, newest first.
 */
router.get('/progress/:metric', requirePortalAuth, async (req, res) => {
  const metric = String(req.params.metric || '');
  if (!Progress.METRICS.includes(metric)) {
    return res.status(404).json({ success: false, error: 'No such progress list' });
  }
  const range = rangeFrom(req, res);
  if (!range) return undefined;
  let out;
  try {
    out = await Progress.progressList(dbQuery, req.session.portalUserId, metric, range, {
      limit: parseInt(req.query.limit, 10),
      describe: LpCatalogue.describePlans,
    });
  } catch (error) {
    // Lesson plans are named by the bot: unreachable is a 502 she can retry, never an empty list.
    const status = metric === 'lesson-plans' ? 502 : 500;
    console.error('❌ Portal progress list failed', { metric, error: error?.message });
    return res.status(status).json({ success: false, error: 'Could not load this list' });
  }
  return res.json({ success: true, range, ...out });
});

/**
 * GET /api/portal/leader/observations
 * The coach's /observe world in one payload — upcoming scheduled observations
 * (overdue-flagged), pending debriefs (the bot's listPendingDebriefs
 * semantics), and completed past observations. The resolver degrades to empty
 * lists on failure, so this route only 500s on unexpected throw.
 */
router.get('/leader/observations', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const observations = await getLeaderObservations(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId
    );
    res.json({ success: true, observations });
  } catch (error) {
    console.error('leader/observations error:', error);
    res.status(500).json({ success: false, error: 'Failed to load your observations.' });
  }
});


/**
 * POST /api/portal/leader/schedules — book a visit from the portal (bd-2676).
 *
 * Riffat R33: a coach who clears WhatsApp storage lost her schedule. The leader
 * id comes from the SESSION, never the body, and the service re-checks that the
 * teacher is in this coach's patch — so a hand-posted teacher id cannot book
 * against someone else's teacher, and the stored names come from the patch
 * rather than the request.
 */
router.post('/leader/schedules', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const { teacherExtId, date, slot } = req.body || {};
    const result = await createSchedule(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      { teacherExtId, date, slot }
    );
    res.json({ success: true, ...result });
    // bd-xorfy + bd-o15qnr.17 — the bot announces it the way a WhatsApp booking
    // is announced: the coach's calendar invite and the teacher's WhatsApp
    // notice (observe-schedule.service announce). Not awaited: the booking is
    // saved and answered already; the client never throws. A same-slot re-book
    // re-times the invite but is not news to the teacher (moved:false).
    // bd-o15qnr.8: a past-dated booking records a visit that already happened —
    // nothing is sent.
    if (result && result.id && !result.past) {
      ObserveNotice.notifyTeacher({
        scheduleId: result.id,
        leaderUserId: req.session.portalUserId,
        kind: result.updated ? 'rescheduled' : 'scheduled',
        moved: result.changed !== false,
      });
    }
  } catch (error) {
    // These are user-facing validation messages ("Unknown time slot"),
    // so they are returned as 400s with the reason rather than a blank 500.
    console.error('leader/schedules create error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

/** POST /api/portal/leader/schedules/:id/cancel — cancel one upcoming visit. */
router.post('/leader/schedules/:id/cancel', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const result = await cancelSchedule(
      (sql, params) => pool.query(sql, params),
      req.session.portalUserId,
      req.params.id
    );
    res.json({ success: true, ...result });
    ObserveNotice.notifyTeacher({
      scheduleId: req.params.id,
      leaderUserId: req.session.portalUserId,
      kind: 'cancelled',
    });
  } catch (error) {
    console.error('leader/schedules cancel error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});


/**
 * bd-88krt — coach self-service (HITL R38/R39/R41).
 *
 * Every one of these takes the leader id from the SESSION, never the body, and
 * the service re-checks ownership. R41's root cause was a two-table write done
 * by hand; POST /leader/schools performs both halves in one call so the pair
 * cannot drift apart again.
 */
router.post('/leader/schedules/:id/edit', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const { date, slot } = req.body || {};
    const result = await editSchedule(
      (sql, params) => pool.query(sql, params), req.session.portalUserId, req.params.id, { date, slot });
    res.json({ success: true, ...result });
    // bd-xorfy + bd-o15qnr.17 — announced as WhatsApp's move is: the invite is
    // re-timed, and only a real move (result.changed) is news to the teacher.
    // Not awaited; never throws. bd-o15qnr.8: a move into the past sends nothing.
    if (result && !result.past) {
      ObserveNotice.notifyTeacher({
        scheduleId: req.params.id,
        leaderUserId: req.session.portalUserId,
        kind: 'rescheduled',
        moved: !!result.changed,
      });
    }
  } catch (error) {
    console.error('leader/schedules edit error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/leader/schools/search', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const results = await searchSchools(
      (sql, params) => pool.query(sql, params), req.session.portalUserId, req.query.q);
    res.json({ success: true, results });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/leader/schools', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const result = await addSchool(
      (sql, params) => pool.query(sql, params), req.session.portalUserId, (req.body || {}).schoolExtId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('leader/schools add error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/leader/schools/remove', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const result = await removeSchool(
      (sql, params) => pool.query(sql, params), req.session.portalUserId, (req.body || {}).schoolExtId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('leader/schools remove error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/leader/teachers/search', requirePortalAuth, requireLeaderRole, async (req, res) => {
  try {
    const results = await searchTeachers(
      (sql, params) => pool.query(sql, params), req.session.portalUserId, req.query.q);
    res.json({ success: true, results });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/* ---------------------------------------------------------------------------
 * bd-o15qnr — the coach app v2 (the v18 coach design), read side.
 *
 * Dark behind app_settings.portal_coach_v2: off for this user → 404, the same as
 * a route that does not exist. The portal shows v2 only to role=coach; these
 * routes need the leader role plus the flag. Every number comes from existing
 * tables (services/coach-v2.service.js). Writes reuse the existing routes:
 * POST /leader/schedules (book), /leader/schedules/:id/edit (Reschedule),
 * /leader/schedules/:id/cancel, and the /leader/observe pipeline.
 *
 * IDENTITY: the coach is ALWAYS req.session.portalUserId. Inputs are checked
 * before any query, so a malformed uuid never reaches pg as a cast error.
 * ------------------------------------------------------------------------- */
const CoachV2 = require('../services/coach-v2.service');

async function requireCoachV2(req, res, next) {
  const on = await isFlagEnabledForUser(supabase, PORTAL_COACH_V2_KEY, req.session && req.session.portalUserId);
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}
const coachV2 = [requirePortalAuth, requireLeaderRole, requireCoachV2];
const pgQuery = (sql, params) => pool.query(sql, params);
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * "Today" for the coach. The server's day is UTC; Pakistan is UTC+5, so before
 * 05:00 PKT the two differ. The page sends its own day (?today=); it is used
 * only when it is a real date within one day of the server's.
 */
function coachToday(req) {
  const server = new Date().toISOString().slice(0, 10);
  const asked = req.query && req.query.today;
  if (!isDay(asked)) return server;
  const gap = Math.abs(Date.parse(`${asked}T00:00:00Z`) - Date.parse(`${server}T00:00:00Z`));
  return gap <= 86400000 ? asked : server;
}

function coachFail(res, where, error) {
  console.error(`coach/${where} error:`, error && error.message);
  return res.status(500).json({ success: false, error: 'Could not load this page.' });
}

/** GET /api/portal/coach/home — today's visits (the current one marked) and the tile numbers. */
router.get('/coach/home', ...coachV2, async (req, res) => {
  try {
    const home = await CoachV2.getCoachHome(pgQuery, req.session.portalUserId, { today: coachToday(req) });
    return res.json({ success: true, home });
  } catch (error) { return coachFail(res, 'home', error); }
});

/** GET /api/portal/coach/pending — bd-o15qnr.21: { waiting, ids } — what waits on her (Feedback Form, Debrief), for the banner. */
router.get('/coach/pending', ...coachV2, async (req, res) => {
  try {
    const out = await CoachV2.getCoachPending(pgQuery, req.session.portalUserId);
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'pending', error); }
});

/** GET /api/portal/coach/schedule?from=&to= — her visits in the range (default this week) and the overdue ones. */
router.get('/coach/schedule', ...coachV2, async (req, res) => {
  const { from, to } = req.query || {};
  if ((from != null && !isDay(from)) || (to != null && !isDay(to))) {
    return res.status(400).json({ success: false, error: 'Invalid date — expected YYYY-MM-DD' });
  }
  try {
    const out = await CoachV2.getCoachSchedule(pgQuery, req.session.portalUserId, { today: coachToday(req), from, to });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'schedule', error); }
});

/** GET /api/portal/coach/team?date=&coach= — every coach (or one): totals, the week, the day by time. */
router.get('/coach/team', ...coachV2, async (req, res) => {
  const { date, coach } = req.query || {};
  if (date != null && !isDay(date)) return res.status(400).json({ success: false, error: 'Invalid date — expected YYYY-MM-DD' });
  if (coach != null && coach !== '' && !UUID_RX.test(String(coach))) {
    return res.status(400).json({ success: false, error: 'Unknown coach' });
  }
  try {
    const out = await CoachV2.getTeamSchedule(pgQuery, {
      today: coachToday(req), date: date || undefined, coachId: coach || null, me: req.session.portalUserId,
    });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'team', error); }
});

/** GET /api/portal/coach/people — the Teachers and Schools tabs. */
router.get('/coach/people', ...coachV2, async (req, res) => {
  try {
    const out = await CoachV2.getCoachPeople(pgQuery, req.session.portalUserId, { today: coachToday(req) });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'people', error); }
});

/** GET /api/portal/coach/school/:emis — one of her schools and its teachers. */
router.get('/coach/school/:emis', ...coachV2, async (req, res) => {
  const emis = String(req.params.emis || '');
  if (!/^[A-Za-z0-9-]{1,32}$/.test(emis)) return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const out = await CoachV2.getCoachSchool(pgQuery, req.session.portalUserId, emis, { today: coachToday(req) });
    if (!out) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'school', error); }
});

/** GET /api/portal/coach/teacher/:teacherExtId — one teacher in her patch: numbers, history, next visit. */
router.get('/coach/teacher/:teacherExtId', ...coachV2, async (req, res) => {
  const ext = String(req.params.teacherExtId || '');
  if (!/^\d{6,15}$/.test(ext)) return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const out = await CoachV2.getCoachTeacher(pgQuery, req.session.portalUserId, ext, { today: coachToday(req) });
    if (!out) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'teacher', error); }
});

/**
 * GET /api/portal/coach/observation/:id — bd-o15qnr.10: one HITL observation for
 * the v2 observation page (bd-o15qnr.19: any step, not only sent reports).
 * Served only while that teacher is in the coach's patch; the report image is
 * the one the teacher received (teacher_delivery.report_key), signed here the
 * same way the teacher's own session page signs it, and so is the lesson audio.
 */
router.get('/coach/observation/:id', ...coachV2, async (req, res) => {
  if (!UUID_RX.test(String(req.params.id || ''))) return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const out = await CoachV2.getCoachObservation(pgQuery, req.session.portalUserId, req.params.id, { today: coachToday(req) });
    if (!out) return res.status(404).json({ success: false, error: 'Not found' });
    const { reportKey, audioKey, ...rest } = out;
    const imageUrl = reportKey && process.env.R2_ENDPOINT && process.env.R2_BUCKET_NAME
      ? await _resolveMediaUrl(`${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${reportKey}`)
      : null;
    // bd-o15qnr.19 — the lesson itself, for the page's play button (stored as a full R2 URL).
    const audioUrl = audioKey ? await _resolveMediaUrl(audioKey).catch(() => null) : null;
    return res.json({ success: true, ...rest, imageUrl, audioUrl });
  } catch (error) { return coachFail(res, 'observation', error); }
});

/**
 * POST /api/portal/coach/teacher/:teacherExtId/move    Body { schoolExtId }
 * POST /api/portal/coach/teacher/:teacherExtId/remove
 * bd-o15qnr.11 — Edit teacher. Saved by the bot's WhatsApp /observe teacher
 * admin (commitAdd moves her, commitRemovals takes her off her school) after this
 * side has checked she is in the coach's patch. The patch, never the body, names
 * who changes; the bot refuses a school the coach does not hold (403).
 */
router.post('/coach/teacher/:teacherExtId/move', ...coachV2, async (req, res) => {
  const ext = String(req.params.teacherExtId || '');
  if (!/^\d{6,15}$/.test(ext)) return res.status(404).json({ success: false, reason: 'not_found' });
  try {
    const out = await CoachTeacherAdmin.moveTeacher(pgQuery, ObserveTeacherAdmin, req.session.portalUserId, ext, (req.body || {}).schoolExtId);
    return res.status(out.status).json(out.data);
  } catch (error) { return coachFail(res, 'teacher-move', error); }
});

/**
 * POST /api/portal/coach/teacher/:teacherExtId/edit   Body { edit, value }
 * bd-o15qnr.13 — name | level (bands[]) | role | phone_check | phone, saved by
 * main's /observe edit path ported to the bot. The patch names who changes.
 */
router.post('/coach/teacher/:teacherExtId/edit', ...coachV2, async (req, res) => {
  const ext = String(req.params.teacherExtId || '');
  if (!/^\d{6,15}$/.test(ext)) return res.status(404).json({ success: false, reason: 'not_found' });
  try {
    const { edit, value } = req.body || {};
    const out = await CoachTeacherAdmin.editTeacher(pgQuery, ObserveTeacherAdmin, req.session.portalUserId, ext, String(edit || ''), value);
    return res.status(out.status).json(out.data);
  } catch (error) { return coachFail(res, 'teacher-edit', error); }
});

router.post('/coach/teacher/:teacherExtId/remove', ...coachV2, async (req, res) => {
  const ext = String(req.params.teacherExtId || '');
  if (!/^\d{6,15}$/.test(ext)) return res.status(404).json({ success: false, reason: 'not_found' });
  try {
    const out = await CoachTeacherAdmin.removeTeacher(pgQuery, ObserveTeacherAdmin, req.session.portalUserId, ext);
    return res.status(out.status).json(out.data);
  } catch (error) { return coachFail(res, 'teacher-remove', error); }
});

/** GET /api/portal/coach/visit/:id — one of her schedule entries, with the teacher's numbers. */
router.get('/coach/visit/:id', ...coachV2, async (req, res) => {
  if (!UUID_RX.test(String(req.params.id || ''))) return res.status(404).json({ success: false, error: 'Not found' });
  try {
    const out = await CoachV2.getCoachVisit(pgQuery, req.session.portalUserId, req.params.id, { today: coachToday(req) });
    if (!out) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'visit', error); }
});

/** GET /api/portal/coach/reports?page=&q= — waiting for her, in progress, then every observation. */
router.get('/coach/reports', ...coachV2, async (req, res) => {
  const { page, q } = req.query || {};
  try {
    const out = await CoachV2.getCoachReports(pgQuery, req.session.portalUserId, {
      page, q: typeof q === 'string' ? q.slice(0, 64) : undefined,
    });
    return res.json({ success: true, ...out });
  } catch (error) { return coachFail(res, 'reports', error); }
});

/**
 * GET /api/portal/lesson-plans
 * Get all lesson plans for authenticated user
 */
router.get('/lesson-plans', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const contentType = req.query.type; // 'lesson_plan' or 'presentation'

    // NOTE: Database has 'topic', 'grade', 'type' - query with actual column names
    let query = supabase
      .from('lesson_plans')
      .select('id, topic, grade, subject, type, gamma_url, pdf_url, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (contentType) {
      query = query.eq('type', contentType); // Database column is 'type' not 'content_type'
    }

    const { data: lessonPlansRaw, error, count } = await query;

    if (error) {
      throw error;
    }

    // Transform to match portal expectations (title, grade_level, content_type)
    const lessonPlans = (lessonPlansRaw || []).map(plan => ({
      id: plan.id,
      title: plan.topic,
      subject: plan.subject,
      grade_level: plan.grade,
      content_type: plan.type,
      gamma_url: plan.gamma_url,
      pdf_url: plan.pdf_url,
      created_at: plan.created_at
    }));

    res.json({
      success: true,
      lessonPlans: lessonPlans,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Lesson plans error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load lesson plans'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CURRICULUM LP BROWSER — the same catalogue the WhatsApp Flow serves
// ───────────────────────────────────────────────────────────────────────────
// A cascading picker — grade → subject → chapter → lesson — over the v8 K-5
// corpus, plus an endpoint that returns a presigned R2 URL for one lesson's
// PDF (or its answer key).
// All four browse endpoints delegate to the bot. They used to query
// `curriculum_lp_ast` + `pre_generated_lps` here, which is a DIFFERENT corpus
// from the one the K-5 WhatsApp Flow serves (data/lp_catalog.json intersected
// with niete_lp_assets). On production that meant grade 5 maths showed 0
// chapters in the portal and 8 chapters / 87 lessons on WhatsApp, and the
// PORTAL_INCLUDE_CORE_LPS flag hid 2,485 of the portal's own rows on top.
//
// The portal now holds no catalogue logic and reads no LP table: it asks the
// bot, the same way it asks for training rules and certificates. Presentation
// stays here — the client returns full untruncated text, not the Flow's
// 30-code-point NavigationList rows.
const LpCatalogue = require('../services/lp-catalogue.service');
// The bot owns "how was she scored?" — see coaching-breakdown.service.
const CoachingBreakdown = require('../services/coaching-breakdown.service');

/**
 * GET /api/portal/curriculum/grades
 * → { success, grades: [{ grade, subject_count }] }
 */
router.get('/curriculum/grades', requirePortalAuth, async (req, res) => {
  try {
    const grades = await LpCatalogue.listGrades();
    res.json({ success: true, grades });
  } catch (error) {
    console.error('❌ Portal curriculum/grades failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load lesson-plan grades' });
  }
});

/**
 * GET /api/portal/curriculum/subjects?grade=5
 * → { success, subjects: [{ subject_key, subject, rtl, lesson_count }] }
 */
router.get('/curriculum/subjects', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    if (!Number.isFinite(grade)) {
      return res.status(400).json({ success: false, error: 'grade required' });
    }
    const subjects = await LpCatalogue.listSubjects(grade);
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('❌ Portal curriculum/subjects failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load subjects' });
  }
});

/**
 * GET /api/portal/curriculum/chapters?grade=5&subject=math
 * → { success, chapters: [{ chapter_number, chapter_title, pages_label, lesson_count }] }
 *
 * `subject` is the catalogue's lowercase subject_key. The old handler matched
 * on a display name ('Math'), which is one reason chapters went missing.
 */
router.get('/curriculum/chapters', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subjectKey = String(req.query.subject || '').trim();
    if (!Number.isFinite(grade) || !subjectKey) {
      return res.status(400).json({ success: false, error: 'grade + subject required' });
    }
    const chapters = await LpCatalogue.listChapters(grade, subjectKey);
    res.json({ success: true, chapters });
  } catch (error) {
    console.error('❌ Portal curriculum/chapters failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load chapters' });
  }
});

/**
 * GET /api/portal/curriculum/lps?grade=5&subject=math&chapter_number=7
 * → { success, lessons: [...] }
 *
 * The `downloaded` tick is per-teacher and the user id comes from the SESSION,
 * never the query string.
 */
router.get('/curriculum/lps', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subjectKey = String(req.query.subject || '').trim();
    const chapterNumber = parseInt(req.query.chapter_number, 10);
    if (!Number.isFinite(grade) || !subjectKey || !Number.isFinite(chapterNumber)) {
      return res.status(400).json({ success: false, error: 'grade + subject + chapter_number required' });
    }
    const lessons = await LpCatalogue.listLessons(
      grade, subjectKey, chapterNumber, req.session.portalUserId,
    );
    res.json({ success: true, lessons });
  } catch (error) {
    console.error('❌ Portal curriculum/lps failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load lesson plans' });
  }
});
/**
 * GET /api/portal/curriculum/lp/:lesson_id/pdf?kind=lesson|answer_key
 *
 * Was a uuid lookup against curriculum_lp_ast / pre_generated_lps
 * plus a POST /render that queued a Gamma job. Neither applies to the v8
 * corpus the bot serves: assets are pre-rendered and uploaded, and
 * availability — an is_current row in niete_lp_assets — IS the gate. There is
 * nothing for a teacher to queue, so the render endpoint is gone with it.
 *
 * 200 with `{ available: false }` when the lesson exists but has no current
 * asset yet. Only a real failure is a 5xx, so the UI can tell "not ready" from
 * "we are broken" — the distinction the old handler collapsed.
 */
router.get('/curriculum/lp/:lesson_id/pdf', requirePortalAuth, async (req, res) => {
  try {
    const lessonId = String(req.params.lesson_id || '').trim();
    const kind = req.query.kind === 'answer_key' ? 'answer_key' : 'lesson';
    if (!lessonId) {
      return res.status(400).json({ success: false, error: 'lesson_id required' });
    }

    const hit = await LpCatalogue.lessonPdf(lessonId, kind, req.session.portalUserId);
    if (!hit) {
      return res.status(200).json({ success: true, available: false });
    }
    // bd-5rz1v.15 — the link is minted to be opened in another app: that is an open.
    // Not awaited: logging never delays or fails the open.
    LpActivity.logOpen(dbQuery, {
      userId: req.session.portalUserId, kind: 'k5', ref: lessonId, source: 'external',
    });
    res.json({ success: true, available: true, ...hit });
  } catch (error) {
    console.error('❌ Portal curriculum/lp/pdf failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not open this lesson plan' });
  }
});

/**
 * GET /api/portal/curriculum/lp/:lesson_id/file?kind=lesson|answer_key
 * → the lesson plan PDF itself (application/pdf), streamed from storage.
 *
 * bd-5rz1v.10 — what the portal's own lesson plan viewer reads. The same lookup
 * as /pdf above (the bot mints the link, for the signed-in teacher), but the
 * bytes come through this origin, so the viewer never depends on the bucket's
 * CORS naming whichever host the portal is served from. 404 `{ available: false }`
 * is "not published yet", exactly as /pdf answers it; anything else that goes
 * wrong is a 5xx the viewer falls back from (to /pdf, today's way).
 */
router.get('/curriculum/lp/:lesson_id/file', requirePortalAuth, async (req, res) => {
  const lessonId = String(req.params.lesson_id || '').trim();
  const kind = req.query.kind === 'answer_key' ? 'answer_key' : 'lesson';
  if (!lessonId) {
    return res.status(400).json({ success: false, error: 'lesson_id required' });
  }
  let hit;
  try {
    hit = await LpCatalogue.lessonPdf(lessonId, kind, req.session.portalUserId);
  } catch (error) {
    console.error('❌ Portal curriculum/lp/file lookup failed', { error: error?.message });
    return res.status(502).json({ success: false, error: 'Could not open this lesson plan' });
  }
  if (!hit || !hit.url) {
    return res.status(404).json({ success: true, available: false });
  }
  await relayLessonPlanPdf(hit.url, res);
  // bd-5rz1v.15 — recorded only once the PDF has gone out whole (a refused link, a storage error
  // or a dropped connection is not an open). After the response, so it can never delay it.
  if (res.statusCode === 200 && res.writableFinished) {
    LpActivity.logOpen(dbQuery, {
      userId: req.session.portalUserId, kind: 'k5', ref: lessonId, source: 'viewer',
    });
  }
  return undefined;
});

// ═══════════════════════════════════════════════════════════════════════════
// LESSON PLANS, GRADES 6-12 — the other corpus, same delegation
// ───────────────────────────────────────────────────────────────────────────
// The routes above serve grades 1-5, where every lesson is a pre-rendered PDF.
// Grades 6-12 are 5,466 SEGMENTS with a write-once render cache beside them:
// every segment is real and requestable, and about 8% have been written.
//
// So this block has two things the K-5 block does not:
//
//   ready   per lesson, because a tap on an unwritten one starts real work
//   request → poll, because that work takes a MEDIAN OF 172 SECONDS
//             (p90 314s, over all 473 completed renders on production)
//
// No lp612 logic and no lp612 table here — a test asserts it, the same way it
// does for the LP catalogue and the assessment generator.
//
// `userId` comes from req.session.portalUserId on EVERY route below.
// `requirePortalAuth` sets that session key and attaches nothing to `req`;
// `req.portalUser` is set only by the leader guard, which 403s teachers. That
// mistake is what made every Generate on the Assessment Generator answer
// "userId is required", and it had already been sitting unnoticed in
// /curriculum/lps before that.

const Lp612 = require('../services/lp612.service');

/** ?open=1 — the client's mark that this status call IS an open (bd-5rz1v.15). */
const isOpenHint = (v) => v === '1' || v === 'true';

/** GET /api/portal/lp612/grades → { success, grades: [{ grade }] } */
router.get('/lp612/grades', requirePortalAuth, async (req, res) => {
  try {
    res.json({ success: true, grades: await Lp612.listGrades() });
  } catch (error) {
    console.error('❌ Portal lp612/grades failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load grades' });
  }
});

/** GET /api/portal/lp612/subjects?grade=9 */
router.get('/lp612/subjects', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    if (!Number.isFinite(grade)) {
      return res.status(400).json({ success: false, error: 'grade required' });
    }
    res.json({ success: true, subjects: await Lp612.listSubjects(grade) });
  } catch (error) {
    console.error('❌ Portal lp612/subjects failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load subjects' });
  }
});

/** GET /api/portal/lp612/chapters?grade=9&subject=Physics */
router.get('/lp612/chapters', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subject = String(req.query.subject || '').trim();
    if (!Number.isFinite(grade) || !subject) {
      return res.status(400).json({ success: false, error: 'grade + subject required' });
    }
    res.json({ success: true, chapters: await Lp612.listChapters(grade, subject) });
  } catch (error) {
    console.error('❌ Portal lp612/chapters failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load chapters' });
  }
});

/**
 * GET /api/portal/lp612/lessons?grade=9&subject=Physics&chapter_key=c02&lang=en
 *
 * Each lesson carries `ready`. The UI must surface it — starting a
 * three-minute job should be a thing she chooses, not a thing she discovers.
 */
router.get('/lp612/lessons', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subject = String(req.query.subject || '').trim();
    const chapterKey = String(req.query.chapter_key || '').trim();
    if (!Number.isFinite(grade) || !subject || !chapterKey) {
      return res.status(400).json({ success: false, error: 'grade + subject + chapter_key required' });
    }
    const lang = req.query.lang === 'ur' ? 'ur' : 'en';
    // bd-5rz1v.14 — and `sent` per lesson: it reached HER on WhatsApp (the session's teacher).
    res.json({ success: true, lessons: await Lp612.listLessons(grade, subject, chapterKey, lang, req.session.portalUserId) });
  } catch (error) {
    console.error('❌ Portal lp612/lessons failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load lessons' });
  }
});

/**
 * POST /api/portal/lp612/request  { segment_id, lang? }
 * → 202 { success, state: 'ready' | 'authoring', renderId }
 *
 * Always a state, never the document — one code path in the browser whether
 * this was a cache hit or a cold miss.
 */
router.post('/lp612/request', requirePortalAuth, async (req, res) => {
  try {
    const segmentId = String((req.body || {}).segment_id || '').trim();
    if (!segmentId) {
      return res.status(400).json({ success: false, error: 'segment_id required' });
    }
    const lang = (req.body || {}).lang === 'ur' ? 'ur' : 'en';
    const out = await Lp612.requestLesson(segmentId, req.session.portalUserId, lang);

    // Real answers about a real lesson, not faults.
    if (out.notFound) {
      return res.status(404).json({ success: false, error: 'That lesson is not in the catalogue' });
    }
    if (out.withheld) {
      return res.status(403).json({ success: false, error: 'That lesson is not available yet' });
    }

    res.status(202).json({ success: true, state: out.state, renderId: out.renderId });
  } catch (error) {
    console.error('❌ Portal lp612/request failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not start that lesson' });
  }
});

/**
 * GET /api/portal/lp612/status/:render_id
 * → { success, state, url? }
 *
 * The poll. A `ready` answer carries a freshly presigned URL — minted on the
 * way past, never cached, because a presigned link expires.
 */
router.get('/lp612/status/:render_id', requirePortalAuth, async (req, res) => {
  try {
    const renderId = String(req.params.render_id || '').trim();
    if (!renderId) {
      return res.status(400).json({ success: false, error: 'render_id required' });
    }
    const out = await Lp612.requestStatus(renderId, req.session.portalUserId);
    if (out.notFound) {
      return res.status(404).json({ success: false, error: 'No such lesson request' });
    }
    // bd-5rz1v.15 — this route is ALSO the poll that waits for a lesson to be written, so only a
    // call the client marks as an open (?open=1, lib/lessonPlanOpen's "another app" path) on a
    // READY lesson is recorded. The segment + language is the plan; a render id is not stable.
    if (isOpenHint(req.query.open) && out.state === 'ready' && out.url) {
      LpActivity.logOpen(dbQuery, {
        userId: req.session.portalUserId, kind: 'g612', ref: out.segmentId, lang: out.lang, source: 'external',
      });
    }
    res.json({ success: true, ...out });
  } catch (error) {
    console.error('❌ Portal lp612/status failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not check that lesson' });
  }
});

/**
 * GET /api/portal/lp612/file/:render_id → the written lesson's PDF (application/pdf).
 *
 * bd-5rz1v.10 — the 6-12 twin of /curriculum/lp/:lesson_id/file: the same poll
 * as /lp612/status (so only HER request, by the session's user id), with the
 * bytes relayed through this origin for the portal's viewer. Still being written
 * is a 409 answer; no such request (or someone else's) a 404.
 */
router.get('/lp612/file/:render_id', requirePortalAuth, async (req, res) => {
  const renderId = String(req.params.render_id || '').trim();
  if (!renderId) {
    return res.status(400).json({ success: false, error: 'render_id required' });
  }
  let out;
  try {
    out = await Lp612.requestStatus(renderId, req.session.portalUserId);
  } catch (error) {
    console.error('❌ Portal lp612/file lookup failed', { error: error?.message });
    return res.status(502).json({ success: false, error: 'Could not check that lesson' });
  }
  if (!out || out.notFound) {
    return res.status(404).json({ success: false, error: 'No such lesson request' });
  }
  if (out.state !== 'ready' || !out.url) {
    return res.status(409).json({ success: true, state: out.state || 'authoring' });
  }
  await relayLessonPlanPdf(out.url, res);
  // bd-5rz1v.15 — as for grades 1-5: recorded once the PDF went out whole, after the response.
  if (res.statusCode === 200 && res.writableFinished) {
    LpActivity.logOpen(dbQuery, {
      userId: req.session.portalUserId, kind: 'g612', ref: out.segmentId, lang: out.lang, source: 'viewer',
    });
  }
  return undefined;
});

/**
 * GET /api/portal/lp612/mine → { success, lessons: [...] }
 *
 * "My lesson plans". At a median of ~3 minutes she will navigate away; without
 * this list the render we already paid for is lost to her.
 */
router.get('/lp612/mine', requirePortalAuth, async (req, res) => {
  try {
    res.json({ success: true, lessons: await Lp612.myLessons(req.session.portalUserId) });
  } catch (error) {
    console.error('❌ Portal lp612/mine failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load your lesson plans' });
  }
});

/**
 * GET /api/portal/lesson-plans/recent?limit=10 → { success, plans: [...] }
 *
 * bd-5rz1v.15 — her lesson plans, most recently used first, across BOTH grade bands and BOTH ways
 * a plan reaches her: opened here (niete_lp_opens) or received on WhatsApp. Feeds "Last opened"
 * on the Lesson Plans page and "recent lesson plans" in Coaching. Each plan carries its stable
 * key (k5:<lesson_id> | g612:<segment_id>), what it is (named by the bot), lastOpenedAt (portal),
 * lastReceivedAt (WhatsApp), lastUsedAt, and `open` — what the portal needs to open it again,
 * which is also what Coaching's lesson-plan pick takes ({lessonId} | {segmentId, lang}).
 * The teacher is the session's; ?limit= defaults to 10, at most 50.
 */
router.get('/lesson-plans/recent', requirePortalAuth, async (req, res) => {
  const asked = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 10;
  try {
    const plans = await LpActivity.recentPlans(dbQuery, req.session.portalUserId, {
      limit, describe: LpCatalogue.describePlans,
    });
    res.json({ success: true, plans });
  } catch (error) {
    console.error('❌ Portal lesson-plans/recent failed', { error: error?.message });
    res.status(502).json({ success: false, error: 'Could not load your recent lesson plans' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ASSESSMENT GENERATOR — the bot's pipeline, reached over the internal API
// ───────────────────────────────────────────────────────────────────────────
// This tab has been rendering a real form against a route that does
// not exist. On production, both hosts:
//
//   GET  /api/portal/config              assessmentGenerator: true   ← tab ON
//   POST /api/portal/assessment/generate 404                         ← no route
//   GET  /api/portal/lesson-plans        401                         ← control
//
// 404 against 401 is the proof: absent, not merely unauthenticated. The routes
// were razed with the old UG_EG generator and the September rebuild went
// WhatsApp-Flow-only, while the flag lighting the tab is shared between both
// surfaces and stayed on. A feature that is invisible is a gap; one that
// advertises itself and then errors is the state that reads as broken.
//
// Same delegation as the LP catalogue above: no assessment logic here, no
// assessment table read, and no question cap of our own. The dead panel this
// replaces had already drifted — MAX_COUNT = 20 against the bot's 25, its own
// subject lists, and UG_EG subject ids that no longer resolve.
//
// userId comes from req.session.portalUserId on every call — NOT req.portalUser,
// which requirePortalAuth does not set. Only requireLeaderRole attaches that,
// and it is a school-leader gate that 403s teachers. Reading the wrong one is
// silent: it passes undefined, and the bot answers "userId is required".
const Assessment = require('../services/assessment.service');

/** A 400 from the bot carries a message she can act on; anything else is ours. */
function assessmentFailure(res, error, fallback) {
  if (error && error.userFacing) {
    return res.status(400).json({ success: false, error: error.message });
  }
  console.error('❌ Portal assessment failed', { error: error?.message });
  return res.status(502).json({ success: false, error: fallback });
}

/**
 * GET /api/portal/assessment/options?grade=4&subject=science
 * → { success, grades, subjects?, types?, maxQuestions, defaultQuestions }
 *
 * One call for everything the form needs. maxQuestions arrives from the bot so
 * the form cannot offer a number the validator refuses.
 */
router.get('/assessment/options', requirePortalAuth, async (req, res) => {
  try {
    const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
    const subject = String(req.query.subject || '').trim() || null;
    const data = await Assessment.options({
      grade: Number.isFinite(grade) ? grade : null,
      subject,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    assessmentFailure(res, error, 'Could not load assessment options');
  }
});

/**
 * GET /api/portal/assessment/chapters?grade=4&subject=science
 * → { success, chapters: [{ chapter_number, chapter_title, page_start, page_end, page_count }] }
 */
router.get('/assessment/chapters', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subject = String(req.query.subject || '').trim();
    if (!Number.isFinite(grade) || !subject) {
      return res.status(400).json({ success: false, error: 'grade + subject required' });
    }
    const chapters = await Assessment.listChapters(grade, subject);
    res.json({ success: true, chapters });
  } catch (error) {
    assessmentFailure(res, error, 'Could not load chapters');
  }
});

/**
 * POST /api/portal/assessment/generate
 * Body { grade, subject, chapterNumber|pageRanges, questionCount, ... }
 * → 202 { success, requestId }
 *
 * 202 because the paper does not exist yet — generation is a queued job of
 * about a minute and the page polls /status.
 */
router.post('/assessment/generate', requirePortalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const { requestId } = await Assessment.create({
      // Never from the body. The session is the only thing that says who she is.
      userId: req.session.portalUserId,
      grade: body.grade,
      subject: body.subject,
      chapterNumber: body.chapterNumber ?? null,
      // Several chapters (bd-ix9uhr); the bot turns them into the pages the paper covers.
      chapterNumbers: body.chapterNumbers ?? null,
      pageRanges: body.pageRanges ?? null,
      contentSource: body.contentSource,
      questionCount: body.questionCount,
      // bd-fmf24g.6 — Mix's book count and the marks budget, as the WhatsApp Flow sends them.
      seenCount: body.seenCount ?? null,
      totalMarks: body.totalMarks ?? null,
      questionTypes: body.questionTypes,
      includeAnswerKey: body.includeAnswerKey,
      answerLines: body.answerLines,
      outputFormat: body.outputFormat,
    });
    res.status(202).json({ success: true, requestId });
  } catch (error) {
    assessmentFailure(res, error, 'Could not start your paper');
  }
});

/**
 * GET /api/portal/assessment/status/:request_id
 * → { success, status, paperId?, errorCode? }
 *
 * "Still working" is a 200, so the page can tell it apart from "we are broken".
 */
router.get('/assessment/status/:request_id', requirePortalAuth, async (req, res) => {
  try {
    const requestId = String(req.params.request_id || '').trim();
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'request_id required' });
    }
    const state = await Assessment.status(requestId, req.session.portalUserId);
    res.json({ success: true, ...state });
  } catch (error) {
    assessmentFailure(res, error, 'Could not check your paper');
  }
});

/**
 * GET /api/portal/assessment/paper/:paper_id/download?artifact=paper|answer_key
 * → { success, available, url?, filename? }
 *
 * `available: false` with a 200 covers four situations the page treats
 * identically: not hers, does not exist, not finished, or an answer key whose
 * location was never recorded (any paper generated before V1.4.2).
 */
router.get('/assessment/paper/:paper_id/download', requirePortalAuth, async (req, res) => {
  try {
    const paperId = String(req.params.paper_id || '').trim();
    const artifact = req.query.artifact === 'answer_key' ? 'answer_key' : 'paper';
    if (!paperId) {
      return res.status(400).json({ success: false, error: 'paper_id required' });
    }
    const hit = await Assessment.download(paperId, req.session.portalUserId, artifact);
    if (!hit) return res.status(200).json({ success: true, available: false });
    res.json({ success: true, available: true, ...hit });
  } catch (error) {
    assessmentFailure(res, error, 'Could not open this paper');
  }
});

/**
 * GET /api/portal/assessment/papers?page=1&grade=4&subject=science
 * → { success, papers, total, page, pageSize }
 *
 * Her papers, newest first, on the same two axes she picked when making one.
 */
router.get('/assessment/papers', requirePortalAuth, async (req, res) => {
  try {
    const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
    const out = await Assessment.listPapers(req.session.portalUserId, {
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.page_size, 10) || 10,
      grade: Number.isFinite(grade) ? grade : null,
      subject: String(req.query.subject || '').trim() || null,
    });
    res.json({ success: true, ...out });
  } catch (error) {
    assessmentFailure(res, error, 'Could not load your papers');
  }
});

// ── Editing a paper (bd-hb8qs) — the bot owns every rule; this passes through. ──
function editFailure(res, error) {
  if (error && error.body && error.status) return res.status(error.status).json(error.body);
  console.error('portal/assessment/edit error:', error && error.message);
  return res.status(502).json({ success: false, code: 'UNREACHABLE', error: 'We could not reach the paper service.' });
}

router.get('/assessment/edit/:paper_id/versions', requirePortalAuth, async (req, res) => {
  try { return res.json(await Assessment.editVersions(String(req.params.paper_id), req.session.portalUserId)); }
  catch (error) { return editFailure(res, error); }
});

router.get('/assessment/edit/:paper_id/questions', requirePortalAuth, async (req, res) => {
  try { return res.json(await Assessment.editQuestions(String(req.params.paper_id), req.session.portalUserId)); }
  catch (error) { return editFailure(res, error); }
});

router.get('/assessment/edit/:paper_id/add-kinds', requirePortalAuth, async (req, res) => {
  try { return res.json(await Assessment.editAddKinds(String(req.params.paper_id), req.session.portalUserId)); }
  catch (error) { return editFailure(res, error); }
});

router.post('/assessment/edit/:paper_id/validate', requirePortalAuth, async (req, res) => {
  const { id = null, kind = null, edit = {} } = req.body || {};
  try {
    return res.json(await Assessment.editValidate({
      paperId: String(req.params.paper_id), userId: req.session.portalUserId, id, kind, edit,
    }));
  } catch (error) { return editFailure(res, error); }
});

router.post('/assessment/edit/:paper_id/save', requirePortalAuth, async (req, res) => {
  const { changes = {} } = req.body || {};
  try {
    return res.json(await Assessment.editSave({
      parentId: String(req.params.paper_id), userId: req.session.portalUserId, changes,
    }));
  } catch (error) { return editFailure(res, error); }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEACHER TRAINING BROWSER — 3-step cascading picker: Level → Course → Module
// ───────────────────────────────────────────────────────────────────────────
// Mirrors the curriculum browser architecture but over the training tables:
//   training_levels (4 rows — Aspiring / Emerging / Skilled / Leader)
//   training_courses (36 rows) — filtered by level_id
//   training_modules (171 rows) — filtered by course_id
// Progress ✓/○ badges come from teacher_training_progress (INSERT-only,
// completed_at populated on completion).
//
// Read-only from the portal for MVP — teachers still mark modules done via
// WhatsApp (existing training flow). Portal is a browsable reference / recap.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute per-level state — mirrors the WhatsApp bot's loadVisibleLevelsWithProgress
 * (bot/shared/routes/teacher-training-endpoint.js:192-282). Same rules keep portal
 * lockdown consistent with the Flow lockdown teachers see on WhatsApp.
 *
 *   locked         chain-unlock vendor only: previous level's grand quiz NOT
 *                  passed (unless first level). Vendors with
 *                  unlock_logic='all_modules' (Beacon House, Oxbridge) never
 *                  lock — their "levels" are subjects, not a ladder.
 *   certified      this level's grand quiz IS passed
 *   ready_for_quiz all courses started + grand quiz not yet passed
 *   in_progress    at least one course started
 *   not_started    no progress yet
 *
 * @returns Map<level_id, { state, courses_total, courses_completed, module_count,
 *                          completed_count, passed_at, cooldown_until }>
 */
/**
 * bd-2237 — resolve the union of the teacher's active program scopes and
 * filter a level list through it. Mirrors the WhatsApp endpoint's
 * allowedByVendor logic: a NULL/empty level_ids scope covers the entire
 * vendor; otherwise only the listed level ids are visible. No active
 * assignment → empty list.
 */
async function _filterLevelsByScopes(userId, levels) {
  const { data: assignments } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true);
  const programIds = [...new Set((assignments || []).map(a => a.program_id))];
  if (programIds.length === 0) return [];

  const { data: scopes } = await supabase
    .from('training_program_scopes')
    .select('vendor_id, level_ids')
    .in('program_id', programIds);
  if (!scopes || scopes.length === 0) return [];

  const allowedByVendor = new Map();
  for (const s of scopes) {
    const cur = allowedByVendor.get(s.vendor_id);
    if (cur === 'all') continue;
    if (!s.level_ids || s.level_ids.length === 0) allowedByVendor.set(s.vendor_id, 'all');
    else allowedByVendor.set(s.vendor_id, [...(cur || []), ...s.level_ids]);
  }
  return levels.filter(l => {
    const allow = allowedByVendor.get(l.vendor_id);
    return allow === 'all' || (Array.isArray(allow) && allow.includes(l.id));
  });
}

/**
 * bd-2469 / bd-2480 — level state comes from the BOT, not from here.
 *
 * This function used to compute state locally, and its copy of the rules had
 * drifted from the bot's in three ways while its comments still claimed
 * parity ("mirror the WhatsApp endpoint's rule exactly"):
 *
 *   - isGrandPass tested `quiz_kind === 'grand'`, so a level certified by a
 *     CAPSTONE read as un-passed. The first Beacon House certificate ever
 *     issued was invisible here.
 *   - "ready_for_quiz" used coursesStarted (>=1 module per course), the proxy
 *     bd-2447 replaced on the bot with "every module passed" — a fix already
 *     announced as shipped.
 *   - a missing vendor row defaulted to chain-locked here, unlocked there.
 *
 * The decision fields now come over the wire verbatim. The two COUNTS below
 * (module_count / completed_count) stay local deliberately: they are display
 * rollups with no rule in them, and moving raw counting to the bot would buy
 * nothing but a round trip.
 *
 * Throws when the bot cannot be reached — callers must not render a guess.
 */
async function _computeLevelStates(userId, levels) {
  const levelIds = levels.map(l => l.id);

  const [botStates, { data: courses }, { data: progressRows }] = await Promise.all([
    TrainingRules.getLevelStates(userId),
    supabase.from('training_courses').select('id, level_id').eq('is_active', true).in('level_id', levelIds),
    supabase.from('teacher_training_progress')
      .select('module_id, training_modules!inner(course_id, is_active)')
      .eq('user_id', userId)
      .eq('training_modules.is_active', true),
  ]);

  const completedModuleIds = new Set((progressRows || []).map(p => p.module_id));

  // Module counts per level for the "X/Y done" copy. Pure arithmetic.
  const allCourseIds = (courses || []).map(c => c.id);
  const { data: modules } = allCourseIds.length
    ? await supabase.from('training_modules')
        .select('id, course_id').eq('is_active', true).in('course_id', allCourseIds)
    : { data: [] };

  const courseLevel = new Map((courses || []).map(c => [c.id, c.level_id]));
  const moduleCountByLevel = new Map();
  const completedCountByLevel = new Map();
  for (const m of modules || []) {
    const levelId = courseLevel.get(m.course_id);
    if (levelId == null) continue;
    moduleCountByLevel.set(levelId, (moduleCountByLevel.get(levelId) || 0) + 1);
    if (completedModuleIds.has(m.id)) {
      completedCountByLevel.set(levelId, (completedCountByLevel.get(levelId) || 0) + 1);
    }
  }

  const botById = new Map((botStates || []).map(s => [s.id, s]));
  const byLevelId = new Map();
  for (const lv of levels) {
    const bot = botById.get(lv.id);
    // A level the bot does not return is not in this teacher's programme. Say
    // nothing about it rather than inventing a state — callers treat a missing
    // entry as "not found", which is the honest answer.
    if (!bot) continue;
    byLevelId.set(lv.id, {
      state: bot.state,
      courses_total: bot.courses_total,
      courses_completed: bot.courses_completed,
      module_count: moduleCountByLevel.get(lv.id) || 0,
      completed_count: completedCountByLevel.get(lv.id) || 0,
      passed_at: bot.passed_at || null,
      cooldown_until: bot.cooldown_until || null,
      previous_level_order: bot.previous_level_order ?? null,
    });
  }
  return byLevelId;
}

/**
 * GET /api/portal/training/vendors
 *
 * Returns the vendors (Taleemabad / Beacon House / Oxbridge / …) whose
 * training content the authenticated teacher can access through her assigned
 * training programs, plus per-vendor rollups the portal renders as cards at
 * the top of the Training page:
 *
 *   { vendor_key, vendor_name, level_count, course_count, module_count,
 *     completed_module_count, avg_score_pct }
 *
 * Access chain:
 *   teacher_training_assignments (active) → program_ids
 *     → training_program_scopes → vendor_ids
 *       → training_vendors / training_levels / training_courses / training_modules
 *
 * A scope row with NULL level_ids/course_ids/module_ids covers the vendor's
 * entire active tree. This endpoint operates at vendor granularity, so any
 * scope row pulls the vendor in.
 *
 * `avg_score_pct` is computed from the teacher's training_assessment_attempts
 * rows with quiz_kind='training_module' whose training_module_id belongs to
 * this vendor. Grand-quiz attempts are intentionally excluded — those have
 * their own certification surface at the level cascade below. Returns null
 * when the teacher has no per-module attempts on the vendor yet (the frontend
 * renders "—" in that case, distinct from a red 0%).
 *
 * Empty vendors array when the teacher has no active assignments. Vendors
 * sorted alphabetically by name so the cards render in a predictable order.
 */
/**
 * GET /training/bands — what the teacher has chosen, and whether they may change it.
 *
 * The portal half of band self-selection. Before this, a teacher with no active
 * assignment got `vendors: []` and a dead end, and one whose bands were wrong
 * had no way to correct them: nothing in the app had ever written an assignment
 * row. Bands are the teacher's own statement; they map to training programs,
 * which is what makes the partner vendors visible at all.
 *
 * Shares its logic and its write path with the WhatsApp Flow — both surfaces
 * gate on teacher_training_assignments -> training_program_scopes, so one write
 * serves both.
 */
router.get('/training/bands', requirePortalAuth, async (req, res) => {
  try {
    // Everything — the options, the selection, the cooldown gate and the warning copy — comes
    // from the bot. The portal supplies only who is asking.
    const state = await TrainingBands.getBands(req.session.portalUserId);
    return res.json({ success: true, ...state });
  } catch (e) {
    console.error('Portal GET /training/bands error:', e);
    return res.status(500).json({ success: false, error: 'Could not load your grades.' });
  }
});

/**
 * POST /training/bands — save the teacher's choice and assign their programs.
 *
 * Enforces the 48-hour change cooldown before writing anything, so a blocked
 * attempt leaves the database untouched and returns 429 rather than a silent
 * no-op.
 */
router.post('/training/bands', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const raw = req.body && req.body.bands;
    const selection = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    const result = await TrainingBands.applyBands(userId, selection);
    if (!result.ok) {
      // 429 for the cooldown (a retry later succeeds), 400 for a bad selection.
      const status = result.reason === 'cooldown' ? 429
        : result.reason === 'user_not_found' ? 404 : 400;
      return res.status(status).json({ success: false, reason: result.reason, error: result.message });
    }
    return res.json({
      success: true,
      unchanged: Boolean(result.unchanged),
      programs: result.programs || [],
    });
  } catch (e) {
    console.error('Portal POST /training/bands error:', e);
    return res.status(500).json({ success: false, error: 'Could not save your grades.' });
  }
});

router.get('/training/vendors', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    // 1. Active program assignments → program_ids
    const { data: assignments, error: aErr } = await supabase
      .from('teacher_training_assignments')
      .select('program_id')
      .eq('user_id', userId)
      .eq('is_active', true);
    if (aErr) throw aErr;

    const programIds = Array.from(new Set((assignments || []).map(a => a.program_id).filter(Boolean)));
    if (programIds.length === 0) {
      return res.json({ success: true, vendors: [] });
    }

    // 2. Program scopes → vendor_ids (dedup — a single program can list a
    //    vendor multiple times via multiple scope rows)
    const { data: scopes, error: sErr } = await supabase
      .from('training_program_scopes')
      .select('vendor_id')
      .in('program_id', programIds);
    if (sErr) throw sErr;

    const vendorIds = Array.from(new Set((scopes || []).map(s => s.vendor_id).filter(Boolean)));
    if (vendorIds.length === 0) {
      return res.json({ success: true, vendors: [] });
    }

    // 3. Vendor metadata
    const { data: vendors, error: vErr } = await supabase
      .from('training_vendors')
      .select('id, key, name')
      .in('id', vendorIds)
      .eq('is_active', true);
    if (vErr) throw vErr;

    if (!vendors || vendors.length === 0) {
      return res.json({ success: true, vendors: [] });
    }
    const activeVendorIds = vendors.map(v => v.id);

    // 4. Active levels for those vendors
    const { data: levels, error: lErr } = await supabase
      .from('training_levels')
      .select('id, vendor_id')
      .in('vendor_id', activeVendorIds)
      .eq('is_active', true);
    if (lErr) throw lErr;

    const levelIds = (levels || []).map(l => l.id);
    const levelToVendor = new Map((levels || []).map(l => [l.id, l.vendor_id]));

    // 5. Active courses under those levels
    const { data: courses, error: cErr } = levelIds.length
      ? await supabase
          .from('training_courses')
          .select('id, level_id')
          .in('level_id', levelIds)
          .eq('is_active', true)
      : { data: [], error: null };
    if (cErr) throw cErr;

    const courseIds = (courses || []).map(c => c.id);
    const courseToVendor = new Map(
      (courses || []).map(c => [c.id, levelToVendor.get(c.level_id)])
    );

    // 6. Active modules under those courses
    const { data: modules, error: mErr } = courseIds.length
      ? await supabase
          .from('training_modules')
          .select('id, course_id')
          .in('course_id', courseIds)
          .eq('is_active', true)
      : { data: [], error: null };
    if (mErr) throw mErr;

    const moduleIds = (modules || []).map(m => m.id);
    const moduleToVendor = new Map(
      (modules || []).map(m => [m.id, courseToVendor.get(m.course_id)])
    );

    // 7. Teacher's per-module completion rows scoped to this vendor set
    const { data: progressRows, error: pErr } = moduleIds.length
      ? await supabase
          .from('teacher_training_progress')
          .select('module_id')
          .eq('user_id', userId)
          .in('module_id', moduleIds)
      : { data: [], error: null };
    if (pErr) throw pErr;

    // 8. Teacher's per-module quiz attempts (kind='training_module') scoped to
    //    this vendor set. We fetch and aggregate in Node — the row count is
    //    bounded by the teacher's module attempts (~hundreds max).
    const { data: attempts, error: attErr } = moduleIds.length
      ? await supabase
          .from('training_assessment_attempts')
          .select('training_module_id, score, total_score, quiz_kind')
          .eq('user_id', userId)
          .eq('quiz_kind', 'training_module')
          .in('training_module_id', moduleIds)
      : { data: [], error: null };
    if (attErr) throw attErr;

    // 9. Roll up per vendor
    const perVendor = new Map();
    for (const v of vendors) {
      perVendor.set(v.id, {
        vendor_key: v.key,
        vendor_name: v.name,
        level_count: 0,
        course_count: 0,
        module_count: 0,
        completed_module_count: 0,
        // The card leads with certificates earned, so the count
        // must come from the same call that draws the card.
        certificate_count: 0,
        _pctSum: 0,
        _pctN: 0,
      });
    }

    // Certificates held, attributed to the vendor that owns the level.
    const { data: certRows } = levelIds.length
      ? await supabase.from('training_certificates')
        .select('level_id').eq('user_id', userId).in('level_id', levelIds)
      : { data: [] };
    for (const c of certRows || []) {
      const agg = perVendor.get(levelToVendor.get(c.level_id));
      if (agg) agg.certificate_count += 1;
    }

    for (const l of levels || []) {
      const agg = perVendor.get(l.vendor_id);
      if (agg) agg.level_count += 1;
    }
    for (const c of courses || []) {
      const vid = levelToVendor.get(c.level_id);
      const agg = perVendor.get(vid);
      if (agg) agg.course_count += 1;
    }
    for (const m of modules || []) {
      const vid = courseToVendor.get(m.course_id);
      const agg = perVendor.get(vid);
      if (agg) agg.module_count += 1;
    }
    for (const p of progressRows || []) {
      const vid = moduleToVendor.get(p.module_id);
      const agg = perVendor.get(vid);
      if (agg) agg.completed_module_count += 1;
    }
    for (const a of attempts || []) {
      const vid = moduleToVendor.get(a.training_module_id);
      const agg = perVendor.get(vid);
      if (!agg) continue;
      if (a.total_score && a.total_score > 0 && a.score != null) {
        agg._pctSum += (a.score / a.total_score) * 100;
        agg._pctN += 1;
      }
    }

    const out = Array.from(perVendor.values()).map(agg => ({
      vendor_key: agg.vendor_key,
      vendor_name: agg.vendor_name,
      level_count: agg.level_count,
      course_count: agg.course_count,
      module_count: agg.module_count,
      completed_module_count: agg.completed_module_count,
      // This line is why the card read "0 Certificates" for
      // everyone. The count was aggregated correctly above and then dropped
      // here: this mapper names every field it returns, so a field added to
      // the accumulator and not to this list is silently discarded. The
      // aggregation was verified against real data; the RESPONSE never was.
      certificate_count: agg.certificate_count,
      avg_score_pct: agg._pctN > 0 ? Math.round(agg._pctSum / agg._pctN) : null,
    }));

    out.sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));

    res.json({ success: true, vendors: out });
  } catch (error) {
    console.error('training/vendors error:', error);
    res.status(500).json({ success: false, error: 'Failed to load training vendors' });
  }
});

/* ------------------------------------------------------------------------- *
 * Certificates — identity here, everything else in the bot.
 *
 * These two routes used to read `training_certificates` and presign R2 keys in
 * this process. Both moved to the bot, because the RENDER has to live there:
 * `certificate-pdf.service.js` sits under bot/shared, so its
 * `require('pdfkit')` resolves from bot/node_modules and then the repo root
 * and never reaches dashboard/node_modules — Node resolves from the requiring
 * FILE's directory upward, so the dashboard declaring pdfkit itself changes
 * nothing. A portal-side mint therefore works in a dev tree where both
 * installs exist and fails on the deployed service. Same trap as the LP
 * enqueue, which degraded silently for two days.
 *
 * Once the mint is in the bot, keeping the read here would mean two places
 * that know what a certificate is. So the portal keeps the one thing it
 * genuinely owns — WHO IS ASKING — and asks the bot for the rest. Both routes
 * take the userId from the SESSION and never from the path, query or body.
 * ------------------------------------------------------------------------- */

/**
 * GET /api/portal/training/certificates
 *
 * The teacher's certificates, newest first, straight from the bot.
 *
 * This route NEVER mints. A teacher with 40 certificates must not trigger 40
 * PDF renders just to see their names — rendering happens on the download
 * route below, for the one certificate actually asked for. That split is also
 * why a rendering problem can never take this list down.
 *
 * `download_url` is the portal's own download route, present for EVERY
 * certificate. Before fetch-or-mint, a null `pdf_r2_key` meant a permanently
 * undownloadable certificate; now it just means "not rendered yet", so a
 * null download link here would be a bug rather than an honest state.
 * `has_pdf` still reports whether the file already exists, so the UI can warn
 * that a first download may take a moment.
 *
 * A lookup failure is a 500, NOT an empty list: `[]` is a legitimate answer
 * ("none yet"), so returning it on error would tell a teacher their
 * certificates do not exist.
 */
/* ═══════════════════════════════════════════════════════════════════════════
 * CLASSES — the teacher's own classes.
 *
 * Both routes PROXY to the bot's internal API rather than touching the class
 * tables from this process. Two reasons, both learned here:
 *
 *   - creating a class also writes the legacy student_lists mirror and adopts a
 *     colliding roster. A second implementation of that in this process is the
 *     same mistake as the training rules, which rotted while this file's own
 *     comments claimed parity;
 *   - grade and subject labels live in the bot's copy catalog, so resolving them
 *     there means the portal renders the same words as WhatsApp.
 *
 * Requiring the bot's ClassService directly is the trap — see the render route
 * above: that require throws on a bot-only dependency and the throw is swallowed.
 *
 * Scope: TEACHER-OWNED classes only. A principal's or coach's view of a school's
 * classes is deliberately not here yet.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Shared plumbing for the two class routes. */
function internalApiConfig() {
  return {
    baseUrl: process.env.MAIN_BOT_URL || '',
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

async function callBotInternal(pathname, payload) {
  const { baseUrl, apiKey } = internalApiConfig();
  if (!baseUrl || !apiKey) {
    const err = new Error('internal_api_not_configured');
    err.code = 'not_configured';
    throw err;
  }
  // 4xx carries meaning here (409 class-teacher taken, 422 no school), so the
  // response body must survive. Belt AND braces: ask axios not to reject on a
  // non-2xx, and if it rejects anyway, recover the response from the error. The
  // option name has moved between axios majors and this route must not depend on
  // which one is installed.
  try {
    return await axios.post(`${baseUrl}${pathname}`, payload, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      timeout: 10000,
      validateStatus: () => true,
    });
  } catch (err) {
    if (err && err.response) return err.response;
    throw err;
  }
}

/**
 * GET /api/portal/classes
 *
 * The teacher's classes plus everything the page needs to render the add form:
 * the grade and subject options, and whether adding is possible at all.
 */
router.get('/classes', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;

  try {
    const [listRes, optionsRes] = await Promise.all([
      callBotInternal('/api/internal/classes/list', { userId }),
      callBotInternal('/api/internal/classes/options', { userId }),
    ]);

    if (!listRes.data || !listRes.data.success) {
      console.error('portal/classes: bot list failed', { status: listRes.status, data: listRes.data });
      return res.status(502).json({ success: false, error: 'Could not load your classes. Please try again.' });
    }

    return res.json({
      success: true,
      classes: listRes.data.classes || [],
      canAdd: Boolean(listRes.data.canAdd),
      currentSession: listRes.data.currentSession || null,
      grades: (optionsRes.data && optionsRes.data.grades) || [],
      subjects: (optionsRes.data && optionsRes.data.subjects) || [],
      sections: (optionsRes.data && optionsRes.data.sections) || [],
      shifts: (optionsRes.data && optionsRes.data.shifts) || [],
    });
  } catch (error) {
    if (error.code === 'not_configured') {
      console.error('portal/classes: MAIN_BOT_URL or INTERNAL_API_KEY not configured');
      return res.status(503).json({ success: false, error: 'Classes are temporarily unavailable.' });
    }
    console.error('portal/classes error:', error.message);
    return res.status(502).json({ success: false, error: 'Could not load your classes. Please try again.' });
  }
});

/**
 * POST /api/portal/classes
 *
 * Body { gradeCode, section?, subjectCodes?, isClassTeacher? }
 *
 * The teacher id comes from the SESSION, never the body — otherwise one teacher
 * could add a class against another's account.
 */
router.post('/classes', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;
  const { gradeCode, section, shiftCode, subjectCodes, isClassTeacher } = req.body || {};

  if (!gradeCode) {
    return res.status(400).json({ success: false, error: 'Please choose a class.' });
  }

  try {
    const botRes = await callBotInternal('/api/internal/classes/create', {
      userId,
      gradeCode,
      section: typeof section === 'string' ? section : null,
      shiftCode: typeof shiftCode === 'string' && shiftCode ? shiftCode : 'morning',
      subjectCodes: Array.isArray(subjectCodes) ? subjectCodes : [],
      isClassTeacher: Boolean(isClassTeacher),
    });

    const data = botRes.data || {};

    if (botRes.status === 201 && data.success) {
      // A declined class-teacher role or a subject a colleague already teaches is
      // reported ALONGSIDE the success — the class was saved either way, and a 409
      // here used to lose the work and read as "nothing happened".
      return res.status(201).json({
        success: true,
        class: data.class,
        created: data.created,
        classTeacherTaken: Boolean(data.classTeacherTaken),
        subjectsTaken: data.subjectsTaken || [],
      });
    }

    // Distinct, actionable messages. Collapsing these into one "failed" is how a
    // teacher ends up creating the same class three times.
    if (data.error === 'no_school') {
      return res.status(422).json({
        success: false,
        error: 'We do not know which school you are at yet. Ask your coach to link your school, then try again.',
      });
    }
    if (data.error === 'no_current_session') {
      return res.status(503).json({
        success: false,
        error: 'No academic session is set up yet. Please tell your coach.',
      });
    }
    if (data.error === 'unknown_grade') {
      return res.status(400).json({ success: false, error: 'That class is not one we recognise.' });
    }
    if (data.error === 'unknown_section') {
      return res.status(400).json({
        success: false,
        error: 'That section is not one we support yet. Ask NIETE support to add it.',
      });
    }
    if (data.error === 'unknown_shift') {
      return res.status(400).json({ success: false, error: 'Please choose a shift.' });
    }

    console.error('portal/classes create: bot returned failure', { status: botRes.status, data });
    return res.status(502).json({ success: false, error: 'Could not save the class. Please try again.' });
  } catch (error) {
    if (error.code === 'not_configured') {
      console.error('portal/classes create: MAIN_BOT_URL or INTERNAL_API_KEY not configured');
      return res.status(503).json({ success: false, error: 'Classes are temporarily unavailable.' });
    }
    console.error('portal/classes create error:', error.message);
    return res.status(502).json({ success: false, error: 'Could not save the class. Please try again.' });
  }
});


/**
 * GET  /api/portal/classes/:classId/students   — the roster
 * POST /api/portal/classes/:classId/students   — add a pasted register
 * DELETE /api/portal/classes/:classId/students/:studentId — take a child off it
 *
 * The roster belongs to the CLASS, so every teacher assigned to it sees and edits
 * the same children. The teacher id comes from the SESSION, never the URL, and the
 * bot re-checks that she is assigned — a class id in a path is not authorisation.
 */
router.get('/classes/:classId/students', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;
  try {
    const botRes = await callBotInternal('/api/internal/classes/students/list', {
      userId, classId: req.params.classId,
    });
    if (!botRes.data || !botRes.data.success) {
      return res.status(502).json({ success: false, error: 'Could not load the students.' });
    }
    return res.json({ success: true, students: botRes.data.students || [] });
  } catch (error) {
    if (error.code === 'not_configured') {
      return res.status(503).json({ success: false, error: 'Classes are temporarily unavailable.' });
    }
    console.error('portal/classes/:id/students error:', error.message);
    return res.status(502).json({ success: false, error: 'Could not load the students.' });
  }
});

router.post('/classes/:classId/students', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;
  const { rawText } = req.body || {};

  try {
    const botRes = await callBotInternal('/api/internal/classes/students/add', {
      userId, classId: req.params.classId, rawText,
    });
    const data = botRes.data || {};

    if (botRes.status === 201 && data.success) {
      return res.status(201).json({
        success: true,
        added: data.added,
        duplicates: data.duplicates,
        dropped: data.dropped,
      });
    }
    if (data.error === 'no_names') {
      return res.status(400).json({ success: false, error: 'Add at least one name, one per line.' });
    }
    if (data.error === 'not_assigned') {
      return res.status(403).json({ success: false, error: 'You are not assigned to this class.' });
    }
    // A part-way failure names what landed, so she re-pastes the rest rather than
    // the whole register.
    if (typeof data.added === 'number' && data.added > 0) {
      return res.status(502).json({
        success: false,
        error: `Only ${data.added} could be added. Please check the rest and try again.`,
        added: data.added,
      });
    }
    console.error('portal/classes/:id/students add failed', { status: botRes.status, data });
    return res.status(502).json({ success: false, error: 'Could not add the students. Please try again.' });
  } catch (error) {
    if (error.code === 'not_configured') {
      return res.status(503).json({ success: false, error: 'Classes are temporarily unavailable.' });
    }
    console.error('portal/classes/:id/students add error:', error.message);
    return res.status(502).json({ success: false, error: 'Could not add the students. Please try again.' });
  }
});

router.delete('/classes/:classId/students/:studentId', requirePortalAuth, async (req, res) => {
  const userId = req.session.portalUserId;
  try {
    const botRes = await callBotInternal('/api/internal/classes/students/remove', {
      userId, classId: req.params.classId, studentId: req.params.studentId,
    });
    const data = botRes.data || {};
    if (data.success) return res.json({ success: true, removed: Boolean(data.removed) });
    if (data.error === 'not_assigned') {
      return res.status(403).json({ success: false, error: 'You are not assigned to this class.' });
    }
    return res.status(502).json({ success: false, error: 'Could not remove the student. Please try again.' });
  } catch (error) {
    if (error.code === 'not_configured') {
      return res.status(503).json({ success: false, error: 'Classes are temporarily unavailable.' });
    }
    console.error('portal/classes/:id/students remove error:', error.message);
    return res.status(502).json({ success: false, error: 'Could not remove the student. Please try again.' });
  }
});

/**
 * GET  /api/portal/training/level/:id/certificate   — is it claimable, and is one held?
 * POST /api/portal/training/level/:id/certificate   — claim it.
 *
 * The "Receive Certificate" row at the end of the course list.
 *
 * A teacher on a per-module-assessed level (I-SAPS) never sits a LEVEL exam, so
 * nothing on the page ever told her the level was finished or handed her the
 * certificate she had earned. The row is that affordance: locked until every
 * module is done, and on tap it either says what is still outstanding or mints
 * the certificate.
 *
 * The DECISION is the bot's shared guard: on a level with
 * per-module exams, every active one passed (operator, 2026-09-23); otherwise
 * the vendor's own rule. This route adds no rule of
 * its own; it reports what the guard already holds and asks it to issue.
 * Idempotent: the guard refuses a second certificate per (user, level), so a
 * double tap cannot mint two.
 */
/**
 * bd-vej4h — the teacher's score sheet for a level with per-module exams, or
 * null for any other level. Best effort: a failed lookup shows no sheet rather
 * than breaking the certificate card. The arithmetic is the bot's pure
 * isaps-score-sheet.rules; this only gathers the rows.
 */
async function _isapsScoreSheet(userId, levelId) {
  try {
    const { data: quizzes } = await supabase
      .from('training_grand_quizzes').select('id, source_quiz_id, is_active')
      .eq('level_id', levelId).eq('is_active', true);
    const exams = (quizzes || []).filter(q => Number(q.source_quiz_id) > 900);
    if (exams.length === 0) return null;

    const { data: courses } = await supabase
      .from('training_courses').select('id, title, order_index')
      .eq('level_id', levelId).eq('is_active', true);
    const courseIds = (courses || []).map(c => c.id);
    const { data: units } = courseIds.length
      ? await supabase.from('training_modules').select('id, course_id, title, order_index')
        .in('course_id', courseIds).eq('is_active', true)
      : { data: [] };
    const unitIds = (units || []).map(u => u.id);
    const { data: unitAttempts } = unitIds.length
      ? await supabase.from('training_assessment_attempts')
        .select('training_module_id, score, total_questions, status')
        .eq('user_id', userId).eq('quiz_kind', 'training_module').in('training_module_id', unitIds)
      : { data: [] };
    const { data: examAttempts } = await supabase.from('training_assessment_attempts')
      .select('id, grand_quiz_id, is_passed, score, total_questions, status')
      .eq('user_id', userId).eq('quiz_kind', 'grand').in('grand_quiz_id', exams.map(e => e.id));
    const attemptIds = (examAttempts || []).map(a => a.id);
    const { data: examAnswers } = attemptIds.length
      ? await supabase.from('training_assessment_answers')
        .select('attempt_id, question_index, is_correct, answer_score').in('attempt_id', attemptIds)
      : { data: [] };
    const { data: lvl } = await supabase
      .from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();
    const { data: vendor } = lvl?.vendor_id
      ? await supabase.from('training_vendors').select('capstone_points_per_question').eq('id', lvl.vendor_id).maybeSingle()
      : { data: null };
    const crqMax = Number(vendor?.capstone_points_per_question) > 0 ? Number(vendor.capstone_points_per_question) : 10;

    // bd-hxm7a — the written mark stays hidden while results are held.
    const { crqResultsHeld } = require('../../bot/shared/services/training/isaps-crq-hold.rules');
    const crqHeld = await crqResultsHeld(supabase);
    return buildIsapsScoreSheet({
      crqHeld,
      courses: courses || [], units: units || [], exams,
      unitAttempts: (unitAttempts || []).filter(a => a.status !== 'in_progress'),
      examAttempts: examAttempts || [], examAnswers: examAnswers || [], crqMax,
    });
  } catch (err) {
    console.error('isaps score sheet failed:', err?.message);
    return null;
  }
}

async function _levelCertificateState(userId, levelId) {
  // Held already? Then the answer is the certificate, whatever the gates say.
  const { data: held } = await supabase
    .from('training_certificates')
    .select('certificate_code, issued_at')
    .eq('user_id', userId).eq('level_id', levelId)
    .limit(1);
  if (Array.isArray(held) && held.length > 0) {
    return {
      state: 'issued', certificate: held[0], units_total: 0, units_done: 0,
      scores: await _isapsScoreSheet(userId, levelId),
    };
  }

  // Otherwise: how much of the level is actually finished? Counted here rather
  // than trusted from the client, because this is what the copy must explain.
  const { data: courses } = await supabase
    .from('training_courses').select('id').eq('level_id', levelId).eq('is_active', true);
  const courseIds = (courses || []).map(c => c.id);
  const { data: units } = courseIds.length
    ? await supabase.from('training_modules').select('id')
      .in('course_id', courseIds).eq('is_active', true)
    : { data: [] };
  const unitIds = (units || []).map(u => u.id);
  const { data: done } = unitIds.length
    ? await supabase.from('teacher_training_progress').select('module_id')
      .eq('user_id', userId).in('module_id', unitIds)
    : { data: [] };
  const doneIds = new Set((done || []).map(d => d.module_id));

  // And the per-module exams, which are the other half of the guard's test.
  const { data: quizzes } = await supabase
    .from('training_grand_quizzes')
    .select('id, source_quiz_id, is_active')
    .eq('level_id', levelId).eq('is_active', true);
  const perModule = (quizzes || []).filter(q => Number(q.source_quiz_id) > 900);
  const { data: passed } = perModule.length
    ? await supabase.from('training_assessment_attempts')
      .select('grand_quiz_id, is_passed')
      .eq('user_id', userId).eq('quiz_kind', 'grand')
    : { data: [] };
  const passedIds = new Set((passed || []).filter(a => a.is_passed === true).map(a => a.grand_quiz_id));
  const examsDone = perModule.filter(q => passedIds.has(q.id)).length;

  // Operator, 2026-09-23: on a per-module-assessed level the certificate is
  // decided by the module exams ALONE — every active one passed. This replaces
  // the weighted I-SAPS composite as the deciding rule, so the row no longer
  // asks the bot for it: `exams_done / exams_total` is the whole answer, and
  // the bot's guard (certify-level) still makes the final call on tap.
  const grade = null;

  return {
    state: 'locked',
    certificate: null,
    units_total: unitIds.length,
    units_done: unitIds.filter(id => doneIds.has(id)).length,
    exams_total: perModule.length,
    exams_done: examsDone,
    // bd-vej4h — the teacher's score sheet (I-SAPS); null on other levels.
    scores: perModule.length ? await _isapsScoreSheet(userId, levelId) : null,
    // null on a level this model does not describe, or when the bot could not
    // be reached — the row then falls back to the counts and says nothing it
    // cannot stand behind.
    grade,
  };
}

router.get('/training/level/:id/certificate', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) {
      return res.status(400).json({ success: false, error: 'Invalid level id' });
    }
    return res.json({ success: true, ...(await _levelCertificateState(userId, levelId)) });
  } catch (error) {
    console.error('training/level/:id/certificate GET error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load the certificate state' });
  }
});

router.post('/training/level/:id/certificate', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) {
      return res.status(400).json({ success: false, error: 'Invalid level id' });
    }

    const before = await _levelCertificateState(userId, levelId);
    if (before.state === 'issued') {
      return res.json({ success: true, issued: true, certificate: before.certificate });
    }

    // The programme that SCOPES THIS LEVEL, not just any active one.
    //
    // This was `.limit(1).maybeSingle()` over every active assignment. A
    // teacher on three programmes (Primary, Middle, I-SAPS pilot — a real
    // sandbox account) got an arbitrary row, so the certificate was stamped
    // with a programme that does not contain the level, or with null when the
    // pick missed. `training_certificates.program_id` is NOT NULL, so a null
    // made the insert fail outright.
    //
    // NOTE the shape: this reads MANY rows on purpose and never calls
    // .maybeSingle(). bd-qd1p3's guard exists because a single-row read of
    // this table breaks for the 787 production teachers who hold two active
    // assignments — the same class of bug being fixed here. Reading the list
    // is the correct answer, not a bounded single.
    // The level's vendor first, so the assignments read below is the LAST
    // statement in its own block — bd-qd1p3's guard scans a 900-character
    // window after any read of this table for a single-row terminator, and a
    // .maybeSingle() belonging to a different table inside that window reads
    // as an offender. Ordering it this way keeps the guard meaningful instead
    // of widening its exemption list.
    const { data: certLevel } = await supabase
      .from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();

    let scopeRows = [];
    if (certLevel?.vendor_id) {
      const sc = await supabase
        .from('training_program_scopes').select('program_id, level_ids')
        .eq('vendor_id', certLevel.vendor_id);
      scopeRows = sc.data || [];
    }

    // MANY rows on purpose, and never .maybeSingle(): 787 production teachers
    // hold two active assignments, which is the very bug bd-qd1p3 records.
    const assignmentRows = await supabase
      .from('teacher_training_assignments').select('program_id')
      .eq('user_id', userId).eq('is_active', true);

    const programIds = [...new Set((assignmentRows.data || []).map(a => a.program_id).filter(Boolean))];
    // A scope with no level_ids covers its whole vendor.
    const match = scopeRows.find(
      sc => programIds.includes(sc.program_id)
        && (!sc.level_ids || sc.level_ids.length === 0 || sc.level_ids.includes(levelId)),
    );
    // Fall back to the only assignment when there IS only one; an arbitrary
    // pick among several is what broke this.
    const programId = match?.program_id
      || (programIds.length === 1 ? programIds[0] : null);

    const cert = await TrainingRules.certifyLevel({ userId, levelId, programId });
    if (cert.issued) {
      return res.json({ success: true, issued: true, certificate: cert });
    }
    // The guard refused. Say WHAT is outstanding rather than "not yet".
    return res.json({
      success: true,
      issued: false,
      reason: 'incomplete',
      units_total: before.units_total,
      units_done: before.units_done,
      exams_total: before.exams_total,
      exams_done: before.exams_done,
    });
  } catch (error) {
    console.error('training/level/:id/certificate POST error:', error);
    return res.status(500).json({ success: false, error: 'Could not issue the certificate' });
  }
});

router.get('/training/certificates', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const certificatesClient = require('../services/certificates.service');

    const certificates = await certificatesClient.listCertificates(userId);

    res.json({
      success: true,
      certificates: (certificates || []).map((c) => ({
        ...c,
        download_url: `/api/portal/training/certificates/${encodeURIComponent(c.certificate_code)}/download`,
      })),
    });
  } catch (error) {
    console.error('training/certificates error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load certificates' });
  }
});

/**
 * GET /api/portal/training/certificates/:code/download[?view=1]
 *
 * Fetch-or-mint one certificate, then 302 to a short-lived signed R2 URL.
 *
 * Why a redirect rather than handing the signed URL out in the list: the URL
 * is a bearer token for the file, and issuing one per rendered row would mint
 * credentials for certificates nobody ever clicks. This way the session is
 * re-checked at the moment of the download.
 *
 * The bot distinguishes "no such certificate for this user" (404) from "we
 * could not produce the file" (502), and so does this route — collapsing both
 * into one status would hide a rendering outage behind a not-found.
 *
 * `?view=1` (bd-2676) asks for an INLINE url — the PDF renders instead of
 * downloading. ONE route with a flag rather than two routes: the auth check,
 * the ownership filter, the mint and the 404/502 split are identical, and
 * duplicating them is how two paths drift into disagreeing about who may read
 * a file. Absent the flag the behaviour is unchanged (attachment), so every
 * existing link keeps saving the file.
 */
router.get('/training/certificates/:code/download', requirePortalAuth, async (req, res) => {
  const code = req.params && req.params.code;
  if (!code) return res.status(400).json({ success: false, error: 'certificate code is required' });

  // Any truthy `view` means inline. Deliberately not parsing '0'/'false' —
  // nothing generates those, and the only producer is our own View button.
  const disposition = (req.query && req.query.view) ? 'inline' : 'attachment';

  try {
    const userId = req.session.portalUserId;
    const certificatesClient = require('../services/certificates.service');

    const result = await certificatesClient.getCertificatePdf(userId, code, disposition);

    if (result && result.notFound) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }
    if (!result || !result.download_url) {
      // The certificate exists; its PDF could not be produced. Say so — the
      // list is unaffected and the teacher can retry.
      return res.status(502).json({
        success: false,
        error: 'Your certificate PDF could not be prepared. Please try again in a moment.',
      });
    }
    // bd-4ryvw — `?format=json` hands the signed link back instead of redirecting,
    // so the portal saves the file itself. A 302 inside the app's WebView goes to
    // R2's host, which is not the app's own, and Capacitor opens it in Chrome.
    if (req.query && req.query.format === 'json') {
      return res.json({ success: true, url: result.download_url, filename: `NIETE-certificate-${code}.pdf` });
    }
    return res.redirect(302, result.download_url);
  } catch (error) {
    console.error('training/certificates download error:', error.message);
    return res.status(502).json({
      success: false,
      error: 'Your certificate PDF could not be prepared. Please try again in a moment.',
    });
  }
});

/**
 * GET /api/portal/training/levels
 * Returns the 4 training levels with per-level module counts, completion %,
 * AND lockdown state (mirrors WhatsApp Flow). A level is `locked` until the
 * teacher passes the previous level's grand quiz.
 */
router.get('/training/levels', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    // vendor_id is joined so the frontend's Vendor filter (bd-2031 vendor
    // grouping) can hide levels that don't belong to the selected vendor
    // without a second round-trip. training_vendors.key is the stable
    // identifier — the ID column is a UUID and is not useful to the client.
    const { data: levels, error: le } = await supabase
      .from('training_levels')
      .select('id, name, order_index, cpd_level, vendor_id, training_vendors!inner(key, unlock_logic)')
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (le) throw le;

    // bd-2237 — honour the teacher's program scopes (WA parity). A NULL
    // level_ids scope covers the whole vendor; a level is visible only when
    // some active assignment's scope allows it. No assignment → nothing.
    const visibleLevels = await _filterLevelsByScopes(userId, levels || []);

    const stateMap = await _computeLevelStates(userId, visibleLevels);

    const enriched = visibleLevels.map(l => {
      const s = stateMap.get(l.id) || {};
      return {
        id: l.id, name: l.name, order_index: l.order_index, cpd_level: l.cpd_level,
        vendor_key: l.training_vendors ? l.training_vendors.key : null,
        // bd-2235 — the client labels chain vendors "Level N · name" (0-based,
        // app parity) and all_modules vendors by plain name.
        unlock_logic: (l.training_vendors && l.training_vendors.unlock_logic) || 'chain',
        state: s.state || 'not_started',
        module_count: s.module_count || 0,
        completed_count: s.completed_count || 0,
        courses_total: s.courses_total || 0,
        courses_completed: s.courses_completed || 0,
        passed_at: s.passed_at,
        cooldown_until: s.cooldown_until,
        previous_level_order: s.previous_level_order,
      };
    });
    res.json({ success: true, levels: enriched });
  } catch (error) {
    console.error('training/levels error:', error);
    res.status(500).json({ success: false, error: 'Failed to load levels' });
  }
});

/**
 * GET /api/portal/training/level/:id/capstone — bd-2233
 *
 * The teacher's most recent Beacon House capstone ("Grand Quiz") attempt for
 * the level, with each answer's text, LLM score (0-5) and feedback line.
 * 200 with { attempt: null } when the teacher hasn't attempted it — the SPA
 * hides the panel on that. Grading internals (prompts, pass math) stay
 * server-side; only display fields are returned — plus `pass_mark_pct`, the
 * bar the bot grades capstones against, so the card states it instead of
 * carrying its own copy (bd-2489).
 */
router.get('/training/level/:id/capstone', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) return res.status(400).json({ success: false, error: 'Invalid level id' });

    const { data: attempts } = await supabase
      .from('training_assessment_attempts')
      .select('id, status, is_passed, score, total_score, completed_at')
      .eq('user_id', userId)
      .eq('level_id', levelId)
      .eq('quiz_kind', 'capstone')
      .order('completed_at', { ascending: false });
    const attempt = (attempts || []).find(a => a.status !== 'abandoned') || null;
    if (!attempt) return res.json({ success: true, attempt: null, answers: [] });

    const { data: answers } = await supabase
      .from('training_assessment_answers')
      .select('question_index, question_id, answer_text, answer_score, feedback_text')
      .eq('attempt_id', attempt.id)
      .order('question_index', { ascending: true });
    const qIds = (answers || []).map(a => a.question_id).filter(Boolean);
    let qText = new Map();
    if (qIds.length) {
      const { data: qs } = await supabase
        .from('training_questions').select('id, question_text').in('id', qIds);
      qText = new Map((qs || []).map(q => [q.id, q.question_text]));
    }
    // bd-2489 — the SPA hardcoded "Below the 70% pass mark". 70 is this bot
    // constant, so the copy was right by coincidence and would have gone stale
    // silently. Send the bar the capstone is ACTUALLY graded against.
    const { CAPSTONE_PASS_PCT } = require('../../bot/shared/services/training/capstone-delivery.service');

    return res.json({
      success: true,
      pass_mark_pct: Math.round(CAPSTONE_PASS_PCT * 100),
      attempt: {
        id: attempt.id,
        status: attempt.status,
        is_passed: attempt.is_passed,
        score: attempt.score,
        total_score: attempt.total_score,
        completed_at: attempt.completed_at,
      },
      answers: (answers || []).map(a => ({
        question_index: a.question_index,
        question_text: qText.get(a.question_id) || '',
        answer_text: a.answer_text || '',
        answer_score: a.answer_score,
        feedback_text: a.feedback_text || '',
      })),
    });
  } catch (error) {
    console.error('training/level/:id/capstone error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load capstone' });
  }
});

/**
 * GET /api/portal/training/level/:id/capstone/questions
 * → { success, questions: [{ id, question_text, order_index }], min_answer_chars,
 *     points_per_question, pass_mark_pct }
 *
 * bd-2673 — the capstone PAPER, for taking in the portal.
 *
 * A capstone question has no options: the answer is free text scored 0-5 by an
 * LLM against the same rubric WhatsApp uses. Rendering one through the MCQ path
 * is what produced bd-2490's dead Submit button, so this is a separate endpoint
 * from /grand-quiz/questions rather than a flag on it.
 *
 * `min_answer_chars` is sent rather than hardcoded in the SPA for the same
 * reason `pass_mark_pct` is (bd-2489): a number duplicated in the client is
 * correct by coincidence until the day it isn't.
 */
router.get('/training/level/:id/capstone/questions', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) return res.status(400).json({ success: false, error: 'Invalid level id' });

    // The bot owns eligibility — locked level, already passed, cooldown,
    // incomplete modules. Fails closed.
    const gate = await TrainingRules.checkExamGateByLevel(userId, levelId);
    if (!gate.ok) {
      return res.status(gate.status === 503 ? 503 : 403).json({
        success: false,
        code: gate.reason || 'not_eligible',
        error: gate.message || 'This exam is not available yet.',
      });
    }

    const { data: quiz } = await supabase
      .from('training_grand_quizzes')
      .select('id')
      .eq('level_id', levelId)
      .eq('quiz_type', 'capstone')
      .maybeSingle();
    if (!quiz) return res.status(404).json({ success: false, error: 'This level has no written exam' });

    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, question_text, order_index')
      .eq('grand_quiz_id', quiz.id)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;

    const {
      CAPSTONE_PASS_PCT, MIN_ANSWER_CHARS, POINTS_PER_QUESTION,
    } = require('../../bot/shared/services/training/capstone-delivery.service');

    return res.json({
      success: true,
      questions: (questions || []).map(q => ({
        id: q.id,
        question_text: q.question_text || '',
        order_index: q.order_index,
      })),
      min_answer_chars: MIN_ANSWER_CHARS,
      points_per_question: POINTS_PER_QUESTION,
      pass_mark_pct: Math.round(CAPSTONE_PASS_PCT * 100),
    });
  } catch (error) {
    console.error('training/level/:id/capstone/questions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load the written exam' });
  }
});

/**
 * POST /api/portal/training/level/:id/capstone/attempts
 * Body { answers: [{ question_id, answer_text }] }
 * → { success, attempt, certificate }
 *
 * bd-2673 — submit a written capstone from the portal.
 *
 * Every rule here belongs to the bot: eligibility (checkExamGateByLevel), the
 * per-answer rubric (scoreAnswer — the same LLM prompt WhatsApp grades with),
 * and the pass decision including bd-2478's refusal to score a short answer set
 * (decideCapstonePass). This route sequences them and writes rows.
 *
 * The length floor is enforced HERE as well as in the textarea, because a
 * client-side counter is advice and this is the rule.
 */
router.post('/training/level/:id/capstone/attempts', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) return res.status(400).json({ success: false, error: 'Invalid level id' });

    const answers = (req.body || {}).answers;
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ success: false, error: 'answers[] is required' });
    }

    const gate = await TrainingRules.checkExamGateByLevel(userId, levelId);
    if (!gate.ok) {
      return res.status(gate.status === 503 ? 503 : 403).json({
        success: false,
        code: gate.reason || 'not_eligible',
        error: gate.message || 'This exam is not available yet.',
      });
    }

    const { data: quiz } = await supabase
      .from('training_grand_quizzes')
      .select('id')
      .eq('level_id', levelId)
      .eq('quiz_type', 'capstone')
      .maybeSingle();
    if (!quiz) return res.status(404).json({ success: false, error: 'This level has no written exam' });

    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, question_text, order_index')
      .eq('grand_quiz_id', quiz.id)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;
    const qList = questions || [];
    if (qList.length === 0) return res.status(404).json({ success: false, error: 'This exam has no questions' });

    if (answers.length !== qList.length) {
      return res.status(400).json({
        success: false,
        error: `This exam has ${qList.length} questions — please answer all of them.`,
      });
    }

    const Capstone = require('../../bot/shared/services/training/capstone-delivery.service');

    // Map submitted answers onto the canonical paper. question_index follows the
    // canonical position, matching what the WhatsApp writer records.
    const byId = new Map(qList.map((q, pos) => [q.id, { q, pos }]));
    const pending = [];
    for (const a of answers) {
      const hit = byId.get(a && a.question_id);
      if (!hit) {
        return res.status(400).json({ success: false, error: 'One or more answers reference a question not on this exam' });
      }
      if (pending.some(p => p.questionId === hit.q.id)) {
        return res.status(400).json({ success: false, error: 'Duplicate answers for the same question' });
      }
      const text = String((a && a.answer_text) || '').trim();
      if (!Capstone.meetsAnswerFloor(text)) {
        return res.status(400).json({
          success: false,
          code: 'answer_too_short',
          error: `Each answer needs at least ${Capstone.MIN_ANSWER_CHARS} characters. Question ${hit.pos + 1} is shorter than that.`,
          question_id: hit.q.id,
          min_answer_chars: Capstone.MIN_ANSWER_CHARS,
        });
      }
      pending.push({ questionId: hit.q.id, questionIndex: hit.pos, question: hit.q, answerText: text });
    }
    pending.sort((x, y) => x.questionIndex - y.questionIndex);

    const { data: assignment } = await supabase
      .from('teacher_training_assignments')
      .select('program_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!assignment) {
      return res.status(400).json({ success: false, error: 'No active training program assignment' });
    }

    // Score each answer with the bot's rubric. Sequential rather than parallel:
    // these are LLM calls and a written paper is ~8 of them, so a burst risks a
    // provider rate-limit mid-paper — which would look to the teacher like a
    // partial failure of work they cannot resubmit.
    const scored = [];
    for (const p of pending) {
      const { score, feedback } = await Capstone.scoreAnswer(p.question, p.answerText);
      scored.push({ ...p, score, feedback });
    }

    const totalScore = qList.length * Capstone.POINTS_PER_QUESTION;
    const verdict = Capstone.decideCapstonePass({
      answerScores: scored.map(s => s.score),
      totalQuestions: qList.length,
      totalScore,
    });
    if (!verdict.ok) {
      // bd-2478 — cannot score fairly, so nothing is recorded as a result.
      console.error('capstone submit — refusing to score', { levelId, reason: verdict.reason });
      return res.status(503).json({
        success: false,
        error: 'We could not score this exam fairly. Nothing has been recorded — please try again.',
      });
    }

    const completedAt = new Date().toISOString();
    const { data: attempt, error: aErr } = await supabase
      .from('training_assessment_attempts')
      .insert({
        user_id: userId,
        program_id: assignment.program_id,
        quiz_kind: 'capstone',
        grand_quiz_id: quiz.id,
        level_id: levelId,
        current_question_index: qList.length,
        total_questions: qList.length,
        total_score: totalScore,
        status: verdict.is_passed ? 'passed' : 'failed',
        score: verdict.score,
        is_passed: verdict.is_passed,
        completed_at: completedAt,
        last_activity_at: completedAt,
        started_at: completedAt,
      })
      .select('id')
      .single();
    if (aErr) throw aErr;

    const { error: ansErr } = await supabase.from('training_assessment_answers').insert(
      scored.map(s => ({
        attempt_id: attempt.id,
        question_index: s.questionIndex,
        question_id: s.questionId,
        answer_text: s.answerText,
        answer_score: s.score,
        feedback_text: s.feedback,
        answered_at: completedAt,
      }))
    );
    if (ansErr) throw ansErr;

    // Certificate on pass — same shared, idempotent service the grand quiz and
    // WhatsApp both use.
    let certificate = null;
    if (verdict.is_passed) {
      // Through the bot's GUARD, not the raw issuer.
      //
      // This called issueCertificate directly the moment the attempt passed,
      // which skips every completeness check: the portal's copy of the WhatsApp bug,
      // where one pass minted a certificate without asking whether the units
      // were finished or the per-module exams passed. The decision belongs to
      // the bot so that WhatsApp and the portal cannot disagree about who is
      // certified. Denies (issues nothing) if the rules API is unreachable —
      // the graded attempt above is already written either way.
      const cert = await TrainingRules.certifyLevel({
        userId,
        levelId,
        attemptId: attempt.id,
        programId: assignment.program_id,
      });
      certificate = cert.issued ? {
        certificate_code: cert.certificate_code,
        teacher_name: cert.teacher_name,
        level_name: cert.level_name,
        issued_at: cert.issued_at,
      } : null;
    }

    try {
      const { logEvent } = require('../../bot/shared/utils/structured-logger');
      logEvent('training_capstone_completed', {
        user_uuid: userId,
        level_row_id: levelId,
        attempt_uuid: attempt.id,
        raw_score: verdict.score,
        total_score: totalScore,
        is_passed: verdict.is_passed,
        surface: 'portal',
      });
    } catch (_) { /* observability must never fail a submit */ }

    return res.json({
      success: true,
      attempt: {
        id: attempt.id,
        status: verdict.is_passed ? 'passed' : 'failed',
        score: verdict.score,
        total_score: totalScore,
        pass_bar: verdict.pass_bar,
        pass_mark_pct: verdict.pass_pct,
        is_passed: verdict.is_passed,
        completed_at: completedAt,
      },
      answers: scored.map(s => ({
        question_index: s.questionIndex,
        question_text: s.question.question_text || '',
        answer_text: s.answerText,
        answer_score: s.score,
        feedback_text: s.feedback,
      })),
      certificate,
    });
  } catch (error) {
    console.error('training/level/:id/capstone/attempts error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit the written exam' });
  }
});

/**
 * Level-lockdown guard — reject requests for a level the teacher hasn't
 * unlocked yet. Same rule as the WhatsApp Flow. Returns 403 with the
 * previous-level number in the payload so the client can render a friendly
 * "Pass Level N first" message.
 */
/**
 * Resolve a training media URL into something the browser can actually load.
 *
 * Two hosting shapes exist in training_modules:
 *   - R2-hosted assets (private bucket) → need a presigned URL
 *   - externally-hosted public assets (e.g. the source content vendor's
 *     public object store) → pass through unchanged; presigning them against
 *     our R2 bucket fails validation and would return null, which is exactly
 *     the bug this helper fixes (non-R2 video/audio silently rendered nothing).
 *
 * Returns null for empty/non-http values (e.g. a local path row).
 *
 * `options` is forwarded to the presigner, which defaults to
 * `inline` + a Content-Type inferred from the key so migrated videos/PDFs
 * render in the browser instead of downloading. Pass
 * `{ disposition: 'attachment', filename }` to presign the SAME object as an
 * explicit download. The overrides are signed — they cannot be bolted onto a
 * URL this function already returned (403 SignatureDoesNotMatch).
 * Externally-hosted public URLs are passed through as-is, so a download
 * control over one of those must fall back to the browser's own behaviour.
 */
async function _resolveMediaUrl(url, expiresIn = 3600, options) {
  if (!url) return null;
  if (isValidR2Url(url)) return generatePresignedUrl(url, expiresIn, options);
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

/** True when a module's source_media_url points at a PDF document. */
function _isPdfSourceUrl(url) {
  return !!url && /\.pdf(\?|$)/i.test(url);
}

/**
 * bd-2480 — the level gate, answered by the bot.
 *
 * Was a local re-derivation on top of _computeLevelStates, carrying its own
 * phrasing of the refusal. Now a thin adapter: the bot decides, and the only
 * work left here is renaming `message` to the `error` key every call site
 * already reads.
 *
 * Fails CLOSED. TrainingRules denies on any transport or config failure, so an
 * unreachable bot locks the level rather than opening it.
 */
async function _assertLevelUnlocked(userId, levelId) {
  const gate = await TrainingRules.checkLevelUnlocked(userId, levelId);
  if (gate.ok) return { ok: true };
  return {
    ok: false,
    status: gate.status || 403,
    error: gate.message,
    previous_level_order: gate.previous_level_order ?? null,
  };
}

/**
 * bd-2481 — the module-order gate, which the portal has never had.
 *
 * The bot enforces "exactly one unpassed module is open at a time"
 * (bd-2448, announced as shipped). The portal gated only on the LEVEL, so a
 * teacher could open any module in any order and skip everything before it.
 *
 * Same adapter shape as _assertLevelUnlocked, and the same fail-closed
 * guarantee.
 */
async function _assertModuleUnlocked(userId, moduleId) {
  const gate = await TrainingRules.checkModuleUnlocked(userId, moduleId);
  if (gate.ok) return { ok: true };
  return { ok: false, status: gate.status || 403, error: gate.message };
}

/**
 * GET /api/portal/training/courses?level_id=1
 * Returns courses in a level, with per-course completion counts.
 * Rejects with 403 if the level is locked.
 */
router.get('/training/courses', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.query.level_id, 10);
    if (!Number.isFinite(levelId)) return res.status(400).json({ success: false, error: 'level_id required' });

    const gate = await _assertLevelUnlocked(userId, levelId);
    if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });

    const { data: courses, error: ce } = await supabase
      .from('training_courses')
      .select('id, title, course_type, order_index')
      .eq('is_active', true)
      .eq('level_id', levelId)
      .order('order_index', { ascending: true });
    if (ce) throw ce;

    // Roll up module counts + completion per course
    const courseIds = (courses || []).map(c => c.id);
    if (courseIds.length === 0) return res.json({ success: true, courses: [] });

    const { data: modules, error: me } = await supabase
      .from('training_modules')
      .select('id, course_id')
      .eq('is_active', true)
      .in('course_id', courseIds);
    if (me) throw me;

    const moduleIdsByCourse = new Map();
    for (const m of modules || []) {
      if (!moduleIdsByCourse.has(m.course_id)) moduleIdsByCourse.set(m.course_id, []);
      moduleIdsByCourse.get(m.course_id).push(m.id);
    }
    const allModuleIds = (modules || []).map(m => m.id);
    let completedSet = new Set();
    if (allModuleIds.length && userId) {
      const { data: progress } = await supabase
        .from('teacher_training_progress')
        .select('module_id')
        .eq('user_id', userId)
        .in('module_id', allModuleIds)
        .not('completed_at', 'is', null);
      completedSet = new Set((progress || []).map(p => p.module_id));
    }

    const enriched = (courses || []).map(c => {
      const mIds = moduleIdsByCourse.get(c.id) || [];
      return {
        id: c.id, title: c.title, course_type: c.course_type, order_index: c.order_index,
        module_count: mIds.length,
        completed_count: mIds.filter(id => completedSet.has(id)).length,
      };
    });
    res.json({ success: true, courses: enriched });
  } catch (error) {
    console.error('training/courses error:', error);
    res.status(500).json({ success: false, error: 'Failed to load courses' });
  }
});

/**
 * GET /api/portal/training/modules?course_id=UUID
 * Returns modules in a course with per-module completion status for the teacher.
 */
router.get('/training/modules', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const courseId = String(req.query.course_id || '');
    if (!courseId) return res.status(400).json({ success: false, error: 'course_id required' });

    // Resolve course → level and gate on lockdown
    const { data: courseRow } = await supabase
      .from('training_courses').select('level_id, title').eq('id', courseId).maybeSingle();
    if (!courseRow) return res.status(404).json({ success: false, error: 'Course not found' });
    const gate = await _assertLevelUnlocked(userId, courseRow.level_id);
    if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });

    const { data: modules, error: me } = await supabase
      .from('training_modules')
      .select('id, title, order_index, duration_seconds, video_url, audio_url, source_media_url')
      .eq('is_active', true)
      .eq('course_id', courseId)
      .order('order_index', { ascending: true });
    if (me) throw me;

    const moduleIds = (modules || []).map(m => m.id);
    let completedMap = new Map();
    if (moduleIds.length && userId) {
      const { data: progress } = await supabase
        .from('teacher_training_progress')
        .select('module_id, completed_at')
        .eq('user_id', userId)
        .in('module_id', moduleIds)
        .not('completed_at', 'is', null);
      for (const p of progress || []) {
        // Keep the earliest completion timestamp for each module (INSERT-only table)
        const prev = completedMap.get(p.module_id);
        if (!prev || new Date(p.completed_at) < new Date(prev)) {
          completedMap.set(p.module_id, p.completed_at);
        }
      }
    }

    // Does each unit have a formative assessment of its own?
    //
    // The I-SAPS list interleaves "Unit 301 / Unit 301 — Assessment", and the
    // assessment row must NOT render for a unit that has no questions: two of
    // the level's 54 units (302, 303) have none, and a blank row for them
    // would promise work that does not exist. The detail endpoint already
    // reports this per unit; the LIST needs it too, in one query.
    const qMap = new Map();
    if (moduleIds.length) {
      const { data: qRows } = await supabase
        .from('training_questions')
        .select('training_module_id')
        .in('training_module_id', moduleIds)
        .eq('is_active', true);
      for (const r of qRows || []) qMap.set(r.training_module_id, true);
    }

    // bd-vej4h — display only; the open gate refuses a locked unit anyway. Best
    // effort like the exam and readings below: a lookup failure renders the
    // list without locks, never a broken page.
    let unitLockMap = {};
    try {
      if (userId) unitLockMap = (await TrainingRules.unitLocks(userId, parseInt(courseId, 10))) || {};
    } catch (_) { unitLockMap = {}; }
    const enriched = (modules || []).map(m => ({
      id: m.id, title: m.title, order_index: m.order_index,
      duration_seconds: m.duration_seconds,
      has_video: !!m.video_url,
      has_audio: !!m.audio_url,
      has_pdf: _isPdfSourceUrl(m.source_media_url),
      has_questions: qMap.has(m.id),
      completed_at: completedMap.get(m.id) || null,
      // bd-vej4h — the bot's lock for this unit, so a locked unit LOOKS locked.
      lock: unitLockMap[m.id] || null,
    }));
    // The module's own summative exam, alongside its units.
    //
    // Operator decision: an unpassed module exam BLOCKS the next module, the
    // same way WhatsApp gates it. The UI cannot render that lock without the
    // state, and the portal must not compute it locally — so the verdict comes
    // from the bot, once per course rather than once per unit.
    //
    // Best effort: a rules-API hiccup must not stop a teacher seeing her
    // units. `exam: null` renders as "no exam here", which is also the honest
    // answer for every vendor that has none.
    let exam = null;
    try {
      const g = await TrainingRules.moduleExamGate(userId, parseInt(courseId, 10));
      if (g && (g.ok || g.body)) {
        exam = {
          available: g.ok === true,
          body: g.body || '',
          caption: g.caption || '',
          cta: g.cta || '',
          module_no: g.module_no ?? null,
        };
      }
    } catch (_) { /* leave exam null — the units still render */ }

    // I-SAPS recommended reading for this module (operator, 2026-09-23).
    // Optional material — gates nothing. Best effort like the exam: a failed
    // lookup renders as "no reading list", never as a broken module page.
    let readings = null;
    try {
      const { data: lvl } = await supabase
        .from('training_levels').select('order_index, vendor_id').eq('id', courseRow.level_id).maybeSingle();
      if (lvl?.vendor_id) {
        const { data: vendor } = await supabase
          .from('training_vendors').select('name').eq('id', lvl.vendor_id).maybeSingle();
        readings = readingsForCourse({
          vendorName: vendor?.name,
          levelOrderIndex: lvl.order_index,
          courseTitle: courseRow.title,
        });
      }
    } catch (_) { /* leave readings null — the units still render */ }

    res.json({ success: true, modules: enriched, exam, readings });
  } catch (error) {
    console.error('training/modules error:', error);
    res.status(500).json({ success: false, error: 'Failed to load modules' });
  }
});

/**
 * GET /api/portal/training/module/:id
 * Returns a single module's full detail (content_html + presigned media URLs).
 */
router.get('/training/module/:id', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = req.params.id;

    const { data: m, error } = await supabase
      .from('training_modules')
      .select('id, title, content_html, video_url, audio_url, source_media_url, duration_seconds, order_index, course_id')
      .eq('id', moduleId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!m) return res.status(404).json({ success: false, error: 'Module not found' });

    // Chapter context — look up course + level so the frontend can show a breadcrumb
    const { data: course } = await supabase
      .from('training_courses')
      .select('id, title, level_id')
      .eq('id', m.course_id).maybeSingle();
    let level = null;
    if (course) {
      const { data: l } = await supabase.from('training_levels')
        .select('id, name').eq('id', course.level_id).maybeSingle();
      level = l;

      // Gate on lockdown — same rule as the /courses + /modules endpoints
      const gate = await _assertLevelUnlocked(userId, course.level_id);
      if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });
    }
    // bd-2481 — module ORDER, not just level lock. Unconditional: the bot
    // denies an unknown or course-less module, closing the orphan hole too.
    const modGate = await _assertModuleUnlocked(userId, moduleId);
    if (!modGate.ok) return res.status(modGate.status).json({ success: false, error: modGate.error });

    // Progress
    let completedAt = null;
    if (userId) {
      const { data: progress } = await supabase
        .from('teacher_training_progress')
        .select('completed_at')
        .eq('user_id', userId)
        .eq('module_id', moduleId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: true })
        .limit(1);
      if (progress && progress[0]) completedAt = progress[0].completed_at;
    }

    // Resolve media URLs. video_url/audio_url are R2-hosted for some vendors
    // and public external URLs for others — _resolveMediaUrl presigns the
    // former and passes the latter through. PDF modules carry their document
    // in source_media_url (video_url/audio_url NULL) — surface it as pdf_url
    // so the portal can render an open/download control (the WhatsApp side
    // delivers the same URL as a document).
    const pdfSource = _isPdfSourceUrl(m.source_media_url) ? m.source_media_url : null;
    const [videoUrl, audioUrl, pdfUrl] = await Promise.all([
      _resolveMediaUrl(m.video_url, 3600),
      _resolveMediaUrl(m.audio_url, 3600),
      _resolveMediaUrl(pdfSource, 3600),
    ]);

    // Whether this module has an active quiz — the frontend uses this to
    // decide between "complete via quiz" (quiz submit marks progress) and
    // the explicit "Mark complete" control for quiz-less modules. Existence
    // probe (limit 1) rather than a count — we only need the boolean.
    const { data: activeQuestions } = await supabase
      .from('training_questions')
      .select('id')
      .eq('training_module_id', moduleId)
      .eq('is_active', true)
      .limit(1);

    res.json({
      success: true,
      module: {
        id: m.id,
        title: m.title,
        content_html: m.content_html || '',
        video_url: videoUrl,
        audio_url: audioUrl,
        pdf_url: pdfUrl,
        has_questions: (activeQuestions || []).length > 0,
        duration_seconds: m.duration_seconds,
        order_index: m.order_index,
        completed_at: completedAt,
        course: course ? { id: course.id, title: course.title } : null,
        level: level,
      },
    });
  } catch (error) {
    console.error('training/module/:id error:', error);
    res.status(500).json({ success: false, error: 'Failed to load module' });
  }
});

/**
 * GET /api/portal/training/module/:id/attempts
 * Returns the authenticated teacher's per-module training-quiz attempts for a
 * single module. Attempts are written by the WhatsApp side after every
 * training-module quiz (training_assessment_attempts rows with
 * quiz_kind='training_module', training_module_id=<the module>).
 *
 * The portal shows these as a "Quiz Score" surface on the Module list so
 * teachers can see how they did on completed modules. Grand-quiz (level-exam)
 * attempts are intentionally excluded — those have their own certification
 * surface at the level cascade.
 *
 * Access control: scoped to the caller only. requirePortalAuth resolves
 * req.session.portalUserId; the query filters by that user_id.
 *
 * Response shape:
 *   { success: true, attempts: [
 *       { id, completed_at, score, max_score, quiz_kind }, ...
 *     ] }
 * Chronological (ascending completed_at). Empty array when the teacher has
 * no attempts on the module yet.
 */
router.get('/training/module/:id/attempts', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }

    const { data: attempts, error } = await supabase
      .from('training_assessment_attempts')
      .select('id, completed_at, score, total_score, quiz_kind')
      .eq('user_id', userId)
      .eq('training_module_id', moduleId)
      .eq('quiz_kind', 'training_module')
      .order('completed_at', { ascending: true });
    if (error) throw error;

    const rows = (attempts || []).map(a => ({
      id: a.id,
      completed_at: a.completed_at,
      score: a.score,
      max_score: a.total_score,
      quiz_kind: a.quiz_kind,
    }));
    res.json({ success: true, attempts: rows });
  } catch (error) {
    console.error('training/module/:id/attempts error:', error);
    res.status(500).json({ success: false, error: 'Failed to load module attempts' });
  }
});

/**
 * GET /api/portal/training/module/:id/questions
 *
 * Returns the active quiz questions for a module so the portal can render the
 * quiz-taking form. Mirrors the WhatsApp-side question fetch
 * (bot/shared/services/training/quiz-delivery.service.js — same table, same
 * is_active filter, same order_index ascending ordering) so both surfaces show
 * the identical question set in the identical order.
 *
 * SECURITY: `correct_option` is deliberately NOT selected — grading happens
 * exclusively server-side in the POST /quiz-attempts sibling endpoint. The
 * client must never receive the answer key.
 *
 * Options normalisation: the `options` JSONB column holds either an array of
 * strings or an array of `{ text }` objects (both shapes exist in seeded
 * data). We normalise to plain strings here so the client renders one shape.
 *
 * Contract:
 *   Path   :id — BIGINT module id
 *   Auth   requirePortalAuth (401 on session miss)
 *   Errors 400 (bad id), 403 (level locked), 404 (module not found), 500 on DB error
 *   Ok     { success: true, questions: [{ id, question_text, options: [string], order_index }] }
 *          `questions: []` when the module has no active questions — the
 *          frontend uses that to hide the "Take Quiz" button entirely.
 */
/* ------------------------------------------------------------------------- *
 * bd-2673 — assessments now run HERE as well as on WhatsApp.
 *
 * WHAT USED TO BE HERE
 * --------------------
 * `ASSESSMENTS_ON_WHATSAPP_ONLY` and `_whatsappOnly(res)`, which answered 409
 * on the four question/submit routes. bd-2490 put them there for two reasons,
 * and both are now addressed:
 *
 *   1. A capstone paper is free text and the portal rendered every question as
 *      radios, so a Beacon House teacher got eight questions, no inputs and a
 *      dead Submit. → The portal now has a real written-exam path:
 *      GET/POST /training/level/:id/capstone/{questions,attempts}, with the
 *      length floor enforced server-side and the rubric taken from the bot.
 *
 *   2. Every assessment rule this surface owned had drifted from the bot's and
 *      been fixed separately — the pass bar (bd-2483), the progress write
 *      (bd-2450), the eligibility proxy (bd-2447). → There is no longer an
 *      assessment rule in this file to drift. Marking, both pass verdicts, the
 *      capstone rubric and every gate come from the bot;
 *      tests/portal/no-local-grading-in-portal-routes.test.js fails the build if
 *      one reappears here.
 *
 * That block's own removal note said to delete it "once the portal can
 * genuinely run both quiz kinds (bd-2488)" — this is that change.
 *
 * WHAT STILL HOLDS
 * ----------------
 * THE API IS THE GATE, NOT THE BUTTON. #77 shipped the mirror image: a "Locked"
 * label with no server-side check, which started the exam anyway when tapped. A
 * session cookie and curl must hit the same wall the UI does — so each of these
 * routes still calls the bot's gate FIRST, before touching a paper, and a
 * gate that cannot reach the bot denies.
 * ------------------------------------------------------------------------- */

/*
 * bd-2673 — the multi-answer helpers that used to live here are gone.
 *
 * They were `_isMultiAnswerKey` and `_normalizeAnswerSet`, and their docblock
 * claimed they "mirror bot/shared/services/training/quiz-delivery". They did,
 * right up until they wouldn't have. The rule now lives in exactly one place
 * (bot/shared/services/training/paper-marking.service.js): `isMultiKey` is
 * imported at the top of this file for the radios-vs-checkboxes flag, and the
 * marking itself goes over the internal API via TrainingRules.markPaper.
 *
 * tests/portal/no-local-grading-in-portal-routes.test.js fails the build if a
 * marking or pass-bar rule reappears in this file.
 */

router.get('/training/module/:id/questions', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }

    // 1. Module must exist and be active (same rule as GET /training/module/:id)
    const { data: mod, error: modErr } = await supabase
      .from('training_modules')
      .select('id, course_id, is_active')
      .eq('id', moduleId)
      .eq('is_active', true)
      .maybeSingle();
    if (modErr) throw modErr;
    if (!mod) return res.status(404).json({ success: false, error: 'Module not found' });

    // 2. Lockdown gate — same rule as every other training endpoint.
    if (mod.course_id) {
      const { data: course } = await supabase
        .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
      if (course) {
        const gate = await _assertLevelUnlocked(userId, course.level_id);
        if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });
      }
      // bd-2481 — the module-ORDER gate, outside the `if (course)` above on
      // purpose. The bot denies an unknown module or one with no course, so
      // running it unconditionally also closes the orphan-module hole the
      // level gate leaves open.
      const modGate = await _assertModuleUnlocked(userId, moduleId);
      if (!modGate.ok) return res.status(modGate.status).json({ success: false, error: modGate.error });
    }

    // 3. Active questions, canonical order — the exact set the POST endpoint
    //    will grade against (answer count must match this list's length).
    //    correct_option is fetched ONLY to compute the multi flag server-side
    //    and is never included in the response.
    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, question_text, options, order_index, correct_option')
      .eq('training_module_id', moduleId)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;

    const rows = (questions || []).map(q => ({
      id: q.id,
      question_text: q.question_text || '',
      options: (Array.isArray(q.options) ? q.options : []).map(o =>
        typeof o === 'string' ? o : (o && typeof o === 'object' && typeof o.text === 'string' ? o.text : String(o ?? ''))
      ),
      order_index: q.order_index,
      // bd-2138 — msq questions carry a comma-joined answer set; the client
      // renders checkboxes instead of radios and submits the selected set.
      //
      // bd-2673 — sourced from the bot's paper-marking module rather than a
      // local copy. This looks like presentation, but it is the SAME rule that
      // decides grading: if the two ever disagree, a multi question renders as
      // radios and the teacher cannot submit an answer that could be marked
      // correct. One definition, both uses.
      multi: isMultiKey(q.correct_option),
    }));
    res.json({ success: true, questions: rows });
  } catch (error) {
    console.error('training/module/:id/questions error:', error);
    res.status(500).json({ success: false, error: 'Failed to load module questions' });
  }
});

/**
 * POST /api/portal/training/module/:id/quiz-attempts
 *
 * Submit a full per-module training-quiz attempt from the portal. Server-side
 * grades every answer, persists to `training_assessment_attempts` +
 * `training_assessment_answers`, and upserts `teacher_training_progress` so the
 * module also counts as complete. The persisted row shape matches the
 * WhatsApp-side writer (`bot/shared/services/training/quiz-delivery.service.js`
 * `gradeAttempt` for `quiz_kind='training_module'`) — both surfaces produce
 * compatible rows, so a teacher can start on either and resume/read on the
 * other with no drift.
 *
 * Contract:
 *   Path   :id — BIGINT module id
 *   Body   { answers: [{ question_id, chosen_option }, ...] } — one entry per
 *          active question on the module, order-agnostic (matched by id).
 *   Auth   requirePortalAuth (401 on session miss).
 *   Errors 400 (bad id / missing answers / count mismatch), 403 (level locked),
 *          404 (module not found), 500 on DB error.
 *   Ok     { success: true, attempt: { id, score, max_score, is_passed,
 *                                       completed_at } }
 *
 * Grading semantics — mirrored from `quiz-delivery.service.js`:
 *   - `quiz_kind = 'training_module'`
 *   - `total_score = total_questions` (one point per question)
 *   - `status = 'passed'` always (training-module quizzes are non-blocking;
 *     the enum-level status closes the attempt regardless of correctness)
 *   - `is_passed = (score === total_questions)` — the pedagogical "did they get
 *     a perfect score" signal, orthogonal to the enum status
 *   - `current_question_index = total_questions` (attempt is fully consumed)
 *   - `program_id` comes from the teacher's active `teacher_training_assignments`
 *   - `level_id` derived from the module's course (best-effort, nullable per
 *     the schema's kind-target CHECK constraint)
 *
 * Idempotency: if there's already an in-progress attempt on this module for the
 * teacher (e.g. WhatsApp started one and the teacher switched to portal), we
 * do NOT block or duplicate — the new attempt row is still written; the stale
 * in-progress row is left alone (a nightly abandon sweep or the WhatsApp side
 * will close it). This is the least-surprising behaviour for the "seamless
 * switching" promise.
 */
router.post('/training/module/:id/quiz-attempts', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }

    const answers = req.body && Array.isArray(req.body.answers) ? req.body.answers : null;
    if (!answers) {
      return res.status(400).json({ success: false, error: 'Body must include an answers array' });
    }

    // 1. Load module (also confirms it exists + gives us course_id for lockdown)
    const { data: mod, error: modErr } = await supabase
      .from('training_modules')
      .select('id, course_id, is_active')
      .eq('id', moduleId)
      .maybeSingle();
    if (modErr) throw modErr;
    if (!mod) return res.status(404).json({ success: false, error: 'Module not found' });

    // 2. Lockdown gate — same rule as every other training endpoint. Only run
    //    if we can derive a level (an orphan module without a course would skip
    //    the gate; that's acceptable — the frontend never surfaces such rows).
    let levelId = null;
    if (mod.course_id) {
      const { data: course } = await supabase
        .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
      if (course) {
        levelId = course.level_id;
        const gate = await _assertLevelUnlocked(userId, levelId);
        if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });
      }
    }
    // bd-2481 — module ORDER, not just level lock. Unconditional, so the
    // orphan-module case the comment above accepts is denied rather than
    // waved through: submitting a quiz for a module you cannot open is the
    // one place where skipping ahead also writes progress.
    const modGate = await _assertModuleUnlocked(userId, moduleId);
    if (!modGate.ok) return res.status(modGate.status).json({ success: false, error: modGate.error });

    // 3. Load active questions for the module, ordered — the canonical list
    //    the answer set must exhaustively cover.
    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, correct_option, order_index')
      .eq('training_module_id', moduleId)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;
    const qList = questions || [];
    if (qList.length === 0) {
      return res.status(400).json({ success: false, error: 'This module has no active questions' });
    }
    if (answers.length !== qList.length) {
      return res.status(400).json({
        success: false,
        error: `Answer count mismatch: expected ${qList.length}, got ${answers.length}`,
      });
    }

    // 4. Program assignment — required by the attempts table (NOT NULL).
    const { data: assignment } = await supabase
      .from('teacher_training_assignments')
      .select('program_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!assignment) {
      return res.status(400).json({ success: false, error: 'No active training program assignment' });
    }

    // 5. Mark the paper — the BOT decides which answers are correct.
    //
    //    bd-2673 — this used to be a local copy of the comparator (single by
    //    trimmed string equality, multi by normalised set equality per bd-2138),
    //    with a sibling copy in the grand-quiz route below. Both agreed with
    //    quiz-delivery.service.js by coincidence, and the comment here claimed
    //    "identical comparator to the WhatsApp writer" — the same claim the four
    //    rules in training-rules.service.js's header were making as they drifted.
    //
    //    Throws rather than defaulting if the bot cannot be reached: a marking
    //    result has no safe default in either direction, so the write is
    //    abandoned and the teacher retries with nothing recorded.
    let marked;
    try {
      marked = await TrainingRules.markPaper(qList, answers);
    } catch (markErr) {
      console.error('training/module/:id/quiz-attempts — marking unavailable, nothing written', {
        moduleId, error: markErr?.message,
      });
      return res.status(503).json({
        success: false,
        error: 'We could not mark this quiz just now. Please try again in a moment.',
      });
    }
    if (marked.has_unknown_question) {
      return res.status(400).json({ success: false, error: 'One or more answers reference a question not on this module' });
    }
    const graded = marked.graded;
    const totalQuestions = marked.total_questions;
    const score = marked.score;
    // bd-2483 — the PASS decision belongs to the bot. This was
    // `score === totalQuestions`, which is only correct for vendors whose
    // module bar happens to be 100 (NIETE). Beacon House and Oxbridge pass at
    // 70, so their teachers were being failed on work that passed on WhatsApp.
    //
    // Throws rather than defaulting if the bot cannot be reached: a grading
    // verdict has no safe default in either direction, so the write is
    // abandoned and the teacher retries with nothing recorded.
    let verdict;
    try {
      verdict = await TrainingRules.getModuleQuizVerdict(moduleId, score, totalQuestions);
    } catch (gradeErr) {
      console.error('training/module/:id/quiz-attempts — grading unavailable, nothing written', {
        moduleId, error: gradeErr?.message,
      });
      return res.status(503).json({
        success: false,
        error: 'We could not mark this quiz just now. Please try again in a moment.',
      });
    }
    const isPassed = verdict.is_passed;
    const completedAt = new Date().toISOString();

    // 6. Insert attempt row — shape parity with quiz-delivery.service.js
    //    gradeAttempt() for KIND_TRAINING_MODULE.
    const { data: attempt, error: aErr } = await supabase
      .from('training_assessment_attempts')
      .insert({
        user_id: userId,
        program_id: assignment.program_id,
        quiz_kind: 'training_module',
        training_module_id: moduleId,
        level_id: levelId,
        current_question_index: totalQuestions,
        total_questions: totalQuestions,
        total_score: totalQuestions,
        // bd-2450 — this was hardcoded 'passed' ("attempt closed"), which made a
        // failed check indistinguishable from a passed one in the data. The bot
        // has always recorded the real outcome; now so does the portal.
        status: verdict.status,
        score,
        is_passed: isPassed,
        completed_at: completedAt,
        last_activity_at: completedAt,
        started_at: completedAt,            // submit-in-one-shot; the portal never had a partial
      })
      .select('id')
      .single();
    if (aErr) throw aErr;

    // 7. Bulk-insert the per-question rows (one row per graded answer).
    const answerRows = graded.map(g => ({
      attempt_id: attempt.id,
      question_index: g.question_index,
      question_id: g.question_id,
      chosen_option: g.chosen_option,
      is_correct: g.is_correct,
      answered_at: completedAt,
    }));
    // Bulk insert — real Supabase accepts an array on a single .insert().
    // (The mock harness in tests/training/portal-quiz-submit.test.js records
    // every row via its insert() capture, so this preserves the shape assertions.)
    const { error: ansErr } = await supabase.from('training_assessment_answers').insert(answerRows);
    if (ansErr) throw ansErr;

    // 8. Progress row — ONLY on a pass. bd-2450.
    //
    //    This used to run unconditionally, so submitting a quiz marked the
    //    module complete whether or not the teacher passed it. That is not a
    //    display bug: the bot treats ANY teacher_training_progress row as
    //    "module passed" (teacher-training-endpoint.js, doneModuleIds has no
    //    status filter), so portal-written failures counted toward level
    //    completion on WhatsApp, unlocked the level exam, and could certify a
    //    level off work that was never passed.
    //
    //    Matches the bot: gradeAttempt writes the progress row inside its
    //    isPassed branch. Unique (user_id, module_id) keeps it idempotent.
    if (isPassed) {
      await supabase
        .from('teacher_training_progress')
        .upsert(
          { user_id: userId, module_id: moduleId, completed_at: completedAt },
          { onConflict: 'user_id,module_id' }
        );
    }

    // 8b. The level certificate, if this pass finished the level.
    //
    // No portal route certified a per-module-assessed level at all.
    // Certification lived only in the capstone and grand-quiz routes, both
    // LEVEL-scoped, so an I-SAPS teacher who finished every unit and every
    // module exam through the portal was certified by nothing — the same hole
    // was already fixed on WhatsApp, one surface over.
    //
    // The bot's guard decides. It is cheap to ask and refuses fast when the
    // level is unfinished, and it is idempotent per (user, level), so calling
    // it on every pass cannot mint a duplicate.
    //
    // Deliberately NOT allowed to affect this response's success: the graded
    // attempt, its answers and the progress row are already committed. A
    // certificate that fails to issue here is issued by the next pass or by
    // the WhatsApp path; a submission lost to a certificate error would
    // destroy real work.
    let certificate = null;
    if (isPassed) {
      try {
        const cert = await TrainingRules.certifyLevel({
          userId,
          levelId,
          moduleId,
          attemptId: attempt.id,
          programId: assignment.program_id,
        });
        if (cert.issued) {
          certificate = {
            certificate_code: cert.certificate_code,
            teacher_name: cert.teacher_name,
            level_name: cert.level_name,
            issued_at: cert.issued_at,
          };
        }
      } catch (_) { /* never let certification fail a graded submission */ }
    }

    // 9. Semantic event — same name/shape as WhatsApp side for observability
    //    parity. Payload keys deliberately avoid tripping the column-scanner
    //    heuristic (see quiz-delivery.service.js gradeAttempt).
    try {
      // structured-logger lives in the bot tree; guarded require so the
      // portal module still loads in test environments that don't ship it.
      const { logEvent } = require('../../bot/shared/utils/structured-logger');
      logEvent('training_quiz_completed', {
        user_uuid: userId,
        attempt_uuid: attempt.id,
        module_row_id: moduleId,
        raw_score: score,
        total_qs: totalQuestions,
        is_passed: isPassed,
        pct_required: verdict.pass_pct,
        surface: 'portal',
      });
    } catch (_) { /* logger not available — fine, this is best-effort telemetry */ }

    return res.json({
      success: true,
      attempt: {
        id: attempt.id,
        score,
        max_score: totalQuestions,
        is_passed: isPassed,
        pass_pct: verdict.pass_pct,
        achieved_pct: verdict.achieved_pct,
        completed_at: completedAt,
      },
      // null unless this pass completed the level.
      certificate,
    });
  } catch (error) {
    console.error('training/module/:id/quiz-attempts POST error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit quiz attempt' });
  }
});

/* ------------------------------------------------------------------------- *
 * bd-klecr.6 — the module quiz ONE QUESTION AT A TIME, with a verdict after
 * each answer (operator, 2026-10-06).
 *
 *   POST /training/module/:id/quiz-attempts/start
 *   POST /training/module/:id/quiz-attempts/:attemptId/answer
 *   POST /training/module/:id/quiz-attempts/:attemptId/finish
 *
 * The all-at-once POST /quiz-attempts above stays for the screens that still
 * use it. These three write the SAME rows the WhatsApp quiz writes, in the same
 * order WhatsApp writes them (quiz-delivery.service.js: startModuleQuiz →
 * handleQuizButton → gradeAttempt):
 *
 *   start   an in_progress training_assessment_attempts row, its paper the
 *           bot's served paper for THAT attempt id (servePaper — deterministic
 *           on the id), so WhatsApp resuming the attempt asks the same
 *           questions in the same order and option order. An open attempt on
 *           this module is RESUMED, as WhatsApp's start does, which is also
 *           what a page reload is.
 *   answer  one training_assessment_answers row the moment she checks; the
 *           attempt's current_question_index moves on. The bot marks it
 *           (markPaper). FINAL: a second answer to the same question in the
 *           same attempt is refused with the stored verdict (operator,
 *           2026-10-06: no trial-and-error by reloading). Right / wrong only:
 *           the key never leaves this file, as on WhatsApp (bd-2523).
 *   finish  the attempt closed with the bot's mark and verdict, progress on a
 *           pass (bd-2450), the certificate guard (bd-60145). Run by the LAST
 *           answer itself, so a result is saved even if she never taps Submit;
 *           calling it again returns the stored result and writes nothing.
 * ------------------------------------------------------------------------- */

const crypto = require('crypto');

const _optionText = (o) => (typeof o === 'string' ? o : (o && typeof o === 'object' && typeof o.text === 'string' ? o.text : String(o ?? '')));

/** Gates + the facts every step needs. Returns { error: [status, body] } or { mod, levelId, assignment }. */
async function _moduleQuizContext(userId, moduleId) {
  const { data: mod, error: modErr } = await supabase
    .from('training_modules').select('id, course_id, is_active').eq('id', moduleId).maybeSingle();
  if (modErr) throw modErr;
  if (!mod) return { error: [404, { success: false, error: 'Module not found' }] };
  let levelId = null;
  if (mod.course_id) {
    const { data: course } = await supabase
      .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
    if (course) {
      levelId = course.level_id;
      const gate = await _assertLevelUnlocked(userId, levelId);
      if (!gate.ok) return { error: [gate.status, { success: false, error: gate.error, previous_level_order: gate.previous_level_order }] };
    }
  }
  const modGate = await _assertModuleUnlocked(userId, moduleId);
  if (!modGate.ok) return { error: [modGate.status, { success: false, error: modGate.error }] };
  return { mod, levelId };
}

/**
 * The paper this attempt is served, in order: [{ q, display_order }]. The bot
 * chooses (servePaper); this only loads the bank and the vendor's serving
 * settings it chooses from — the same columns quiz-delivery's
 * getServingConfigByLevel reads. THROWS if the bot cannot be asked: serving a
 * different paper than WhatsApp would is worse than not serving one.
 */
/**
 * The vendor's serving settings for a level — the columns quiz-delivery's
 * getServingConfigByLevel reads, handed to the bot as-is (servePaper decides).
 * null when the level has no vendor: the bot then serves everything, unshuffled.
 */
async function _vendorServingSettings(levelId) {
  if (!levelId) return null;
  const { data: level } = await supabase.from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();
  if (!level || !level.vendor_id) return null;
  const { data: v } = await supabase
    .from('training_vendors')
    .select('key, module_quiz_strategy, exam_question_cap, shuffle_options')
    .eq('id', level.vendor_id)
    .maybeSingle();
  return v || null;
}

/**
 * bd-klecr.7 — a level exam's paper for an attempt: [{ q, display_order }], in
 * served order. The same draw as WhatsApp's startGrandQuiz
 * (selectServedQuestions with isModuleQuiz=false, seeded on the attempt id):
 * NIETE's exam_question_cap of 20 picks a random 20 of the bank, a new 20 for
 * every new attempt, in bank order, options shuffled. A vendor with no cap
 * gets the whole bank. THROWS when the bot cannot be asked.
 */
async function _servedExamPaper(quizId, levelId, attemptId) {
  const { data: bank, error } = await supabase
    .from('training_questions')
    .select('id, question_text, question_urdu, options, correct_option, order_index, bloom_level')
    .eq('grand_quiz_id', quizId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  if (error) throw error;
  const list = bank || [];
  if (list.length === 0) return [];
  const vendor = await _vendorServingSettings(levelId);
  const served = await TrainingRules.servePaper(list, { attemptId, isModuleQuiz: false, vendor });
  const byId = new Map(list.map((q) => [String(q.id), q]));
  return served.questions
    .map((s) => ({ q: byId.get(String(s.id)), display_order: Array.isArray(s.display_order) ? s.display_order : [] }))
    .filter((s) => s.q);
}

async function _servedModulePaper(moduleId, levelId, attemptId) {
  const { data: bank, error } = await supabase
    .from('training_questions')
    .select('id, question_text, options, correct_option, order_index, bloom_level')
    .eq('training_module_id', moduleId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  if (error) throw error;
  const list = bank || [];
  if (list.length === 0) return [];

  const vendor = await _vendorServingSettings(levelId);
  const served = await TrainingRules.servePaper(list, { attemptId, isModuleQuiz: true, vendor });
  const byId = new Map(list.map((q) => [String(q.id), q]));
  return served.questions
    .map((s) => ({ q: byId.get(String(s.id)), display_order: Array.isArray(s.display_order) ? s.display_order : [] }))
    .filter((s) => s.q);
}

/** Her attempt on this module, or null. Never another teacher's. */
async function _ownModuleAttempt(userId, moduleId, attemptId) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, quiz_kind, training_module_id, level_id, program_id, status, current_question_index, total_questions, score, is_passed, completed_at')
    .eq('id', attemptId)
    .maybeSingle();
  if (!attempt || attempt.user_id !== userId || attempt.quiz_kind !== 'training_module'
    || Number(attempt.training_module_id) !== Number(moduleId)) return null;
  return attempt;
}

async function _attemptAnswers(attemptId) {
  const { data, error } = await supabase
    .from('training_assessment_answers')
    .select('question_index, question_id, chosen_option, is_correct')
    .eq('attempt_id', attemptId)
    .order('question_index', { ascending: true });
  if (error) throw error;
  return data || [];
}

const _resultsOf = (rows) => rows.map((r) => ({ question_id: r.question_id, question_index: r.question_index, is_correct: Boolean(r.is_correct) }));

/**
 * Close the attempt and save its result. Idempotent: an attempt already closed
 * (by an earlier call, or by WhatsApp) returns what is stored. THROWS when the
 * bot cannot mark or decide — nothing is closed, and the caller says "try again".
 */
async function _finishModuleQuizAttempt(userId, moduleId, attempt, paper) {
  const rows = await _attemptAnswers(attempt.id);
  const total = attempt.total_questions;

  if (attempt.status !== 'in_progress') {
    return {
      status: 200,
      body: {
        success: true,
        attempt: { id: attempt.id, score: attempt.score, max_score: total, is_passed: attempt.is_passed === true, completed_at: attempt.completed_at },
        results: _resultsOf(rows),
        certificate: null,
      },
    };
  }
  if (rows.length < total) {
    return { status: 409, body: { success: false, error: 'Answer every question first', answered: rows.length, total_questions: total } };
  }

  // The bot marks the whole paper from what was saved, the same call the
  // all-at-once submit makes; the per-answer verdicts it gave are not re-used
  // as a score here, so the two can never disagree with the bot.
  const marked = await TrainingRules.markPaper(
    paper.map((p) => ({ id: p.q.id, correct_option: p.q.correct_option, order_index: p.q.order_index })),
    rows.map((r) => ({ question_id: r.question_id, chosen_option: r.chosen_option })),
  );
  const verdict = await TrainingRules.getModuleQuizVerdict(moduleId, marked.score, marked.total_questions);
  const completedAt = new Date().toISOString();

  // Conditional on still being open: if a parallel finish (the last answer's,
  // and her Submit) got there first, this one closes nothing and reads back.
  const { data: closed, error: closeErr } = await supabase
    .from('training_assessment_attempts')
    .update({
      status: verdict.status,
      score: marked.score,
      is_passed: verdict.is_passed,
      current_question_index: total,
      completed_at: completedAt,
      last_activity_at: completedAt,
    })
    .eq('id', attempt.id)
    .eq('status', 'in_progress')
    .select('id');
  if (closeErr) throw closeErr;
  if (!closed || closed.length === 0) {
    const again = await _ownModuleAttempt(userId, moduleId, attempt.id);
    return _finishModuleQuizAttempt(userId, moduleId, again, paper);
  }

  let certificate = null;
  if (verdict.is_passed) {
    await supabase
      .from('teacher_training_progress')
      .upsert({ user_id: userId, module_id: moduleId, completed_at: completedAt }, { onConflict: 'user_id,module_id' });
    try {
      const cert = await TrainingRules.certifyLevel({
        userId, levelId: attempt.level_id, moduleId, attemptId: attempt.id, programId: attempt.program_id,
      });
      if (cert.issued) {
        certificate = { certificate_code: cert.certificate_code, teacher_name: cert.teacher_name, level_name: cert.level_name, issued_at: cert.issued_at };
      }
    } catch (_) { /* never let certification fail a graded attempt */ }
  }

  try {
    const { logEvent } = require('../../bot/shared/utils/structured-logger');
    logEvent('training_quiz_completed', {
      user_uuid: userId, attempt_uuid: attempt.id, module_row_id: moduleId,
      raw_score: marked.score, total_qs: marked.total_questions, is_passed: verdict.is_passed,
      pct_required: verdict.pass_pct, surface: 'portal', mode: 'per_question',
    });
  } catch (_) { /* best-effort telemetry */ }

  return {
    status: 200,
    body: {
      success: true,
      attempt: {
        id: attempt.id, score: marked.score, max_score: marked.total_questions, is_passed: verdict.is_passed,
        pass_pct: verdict.pass_pct, achieved_pct: verdict.achieved_pct, completed_at: completedAt,
      },
      results: _resultsOf(rows),
      certificate,
    },
  };
}

router.post('/training/module/:id/quiz-attempts/start', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) return res.status(400).json({ success: false, error: 'Invalid module id' });

    const ctx = await _moduleQuizContext(userId, moduleId);
    if (ctx.error) return res.status(ctx.error[0]).json(ctx.error[1]);

    // Resume an open attempt on this module, as WhatsApp's start does — which
    // is also what a page reload lands on.
    const { data: latest } = await supabase
      .from('training_assessment_attempts')
      .select('id, status')
      .eq('user_id', userId)
      .eq('training_module_id', moduleId)
      .eq('quiz_kind', 'training_module')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const open = latest && latest.status === 'in_progress' ? await _ownModuleAttempt(userId, moduleId, latest.id) : null;
    const attemptId = open ? open.id : crypto.randomUUID();

    let paper;
    try {
      paper = await _servedModulePaper(moduleId, ctx.levelId, attemptId);
    } catch (serveErr) {
      console.error('quiz-attempts/start — serving unavailable, nothing written', { moduleId, error: serveErr?.message });
      return res.status(503).json({ success: false, error: 'We could not load this quiz just now. Please try again in a moment.' });
    }
    if (paper.length === 0) return res.status(400).json({ success: false, error: 'This module has no active questions' });

    let attempt = open;
    if (!attempt) {
      const { data: assignment } = await supabase
        .from('teacher_training_assignments')
        .select('program_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!assignment) return res.status(400).json({ success: false, error: 'No active training program assignment' });
      const now = new Date().toISOString();
      // Shape parity with quiz-delivery.service.js startModuleQuiz.
      const { data: made, error: insErr } = await supabase
        .from('training_assessment_attempts')
        .insert({
          id: attemptId,
          user_id: userId,
          program_id: assignment.program_id,
          quiz_kind: 'training_module',
          training_module_id: moduleId,
          level_id: ctx.levelId,
          current_question_index: 0,
          total_questions: paper.length,
          total_score: paper.length,
          status: 'in_progress',
          started_at: now,
          last_activity_at: now,
        })
        .select('id')
        .single();
      if (insErr || !made) throw insErr || new Error('attempt insert returned nothing');
      attempt = { id: attemptId, current_question_index: 0, total_questions: paper.length };
      try {
        const { logEvent } = require('../../bot/shared/utils/structured-logger');
        logEvent('training_quiz_started', { user_uuid: userId, attempt_uuid: attemptId, module_row_id: moduleId, total_qs: paper.length, surface: 'portal' });
      } catch (_) { /* best-effort telemetry */ }
    }

    const done = await _attemptAnswers(attempt.id);
    return res.json({
      success: true,
      attempt: { id: attempt.id, total_questions: attempt.total_questions, current_index: done.length },
      // Options in the served order, each carrying its canonical 1-based value —
      // the value the bot marks against. The key itself is never sent.
      questions: paper.map(({ q, display_order }) => {
        const opts = Array.isArray(q.options) ? q.options : [];
        const order = display_order.length ? display_order : opts.map((_, i) => i + 1);
        return {
          id: q.id,
          question_text: q.question_text || '',
          multi: isMultiKey(q.correct_option),
          options: order.map((i) => ({ value: String(i), text: _optionText(opts[i - 1]) })),
        };
      }),
      answered: done.map((r) => ({ question_id: r.question_id, chosen_option: r.chosen_option, is_correct: Boolean(r.is_correct) })),
    });
  } catch (error) {
    console.error('quiz-attempts/start error:', error);
    return res.status(500).json({ success: false, error: 'Failed to start the quiz' });
  }
});

router.post('/training/module/:id/quiz-attempts/:attemptId/answer', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) return res.status(400).json({ success: false, error: 'Invalid module id' });
    const questionId = req.body ? req.body.question_id : null;
    const chosen = req.body && req.body.chosen_option != null ? String(req.body.chosen_option).trim() : '';
    if (questionId == null || !chosen) return res.status(400).json({ success: false, error: 'Pick an answer first' });

    const attempt = await _ownModuleAttempt(userId, moduleId, req.params.attemptId);
    if (!attempt) return res.status(404).json({ success: false, error: 'Quiz not found' });

    let paper;
    try {
      paper = await _servedModulePaper(moduleId, attempt.level_id, attempt.id);
    } catch (serveErr) {
      console.error('quiz-attempts/answer — serving unavailable, nothing written', { moduleId, error: serveErr?.message });
      return res.status(503).json({ success: false, error: 'We could not check this answer just now. Please try again in a moment.' });
    }
    const index = paper.findIndex((p) => String(p.q.id) === String(questionId));
    if (index < 0) return res.status(400).json({ success: false, error: 'That question is not on this quiz' });

    // A checked answer is final. Reported with what she chose and its verdict,
    // so a reloaded page shows the same locked state.
    const stored = (await _attemptAnswers(attempt.id)).find((r) => r.question_index === index);
    if (stored) {
      return res.status(409).json({
        success: false, error: 'Already answered', already_answered: true,
        chosen_option: stored.chosen_option, is_correct: Boolean(stored.is_correct),
      });
    }
    if (attempt.status !== 'in_progress') return res.status(409).json({ success: false, error: 'This quiz is already finished' });
    if (index !== attempt.current_question_index) {
      return res.status(409).json({ success: false, error: 'Answer the questions in order', current_index: attempt.current_question_index });
    }

    const { q } = paper[index];
    let marked;
    try {
      marked = await TrainingRules.markPaper(
        [{ id: q.id, correct_option: q.correct_option, order_index: q.order_index }],
        [{ question_id: q.id, chosen_option: chosen }],
      );
    } catch (markErr) {
      console.error('quiz-attempts/answer — marking unavailable, nothing written', { moduleId, error: markErr?.message });
      return res.status(503).json({ success: false, error: 'We could not check this answer just now. Please try again in a moment.' });
    }
    const g = marked.graded[0];
    if (!g) return res.status(400).json({ success: false, error: 'That question is not on this quiz' });

    const now = new Date().toISOString();
    const { error: ansErr } = await supabase.from('training_assessment_answers').insert({
      attempt_id: attempt.id,
      question_index: index,
      question_id: q.id,
      chosen_option: g.chosen_option != null ? String(g.chosen_option) : chosen,
      is_correct: Boolean(g.is_correct),
      answered_at: now,
    });
    if (ansErr) {
      if (ansErr.code === '23505') {
        // A double tap raced this one in; its answer stands.
        const raced = (await _attemptAnswers(attempt.id)).find((r) => r.question_index === index);
        return res.status(409).json({
          success: false, error: 'Already answered', already_answered: true,
          chosen_option: raced ? raced.chosen_option : null, is_correct: raced ? Boolean(raced.is_correct) : null,
        });
      }
      throw ansErr;
    }
    const { error: moveErr } = await supabase
      .from('training_assessment_attempts')
      .update({ current_question_index: index + 1, last_activity_at: now })
      .eq('id', attempt.id)
      .eq('status', 'in_progress');
    if (moveErr) throw moveErr;

    // The last answer saves the result there and then.
    let result = null;
    if (index + 1 >= attempt.total_questions) {
      try {
        const fresh = await _ownModuleAttempt(userId, moduleId, attempt.id);
        const out = await _finishModuleQuizAttempt(userId, moduleId, fresh, paper);
        if (out.status === 200) result = out.body;
      } catch (finErr) {
        // The answer is saved; Submit (finish) closes the attempt once the bot answers.
        console.error('quiz-attempts/answer — could not close the attempt yet', { moduleId, error: finErr?.message });
      }
    }

    return res.json({
      success: true,
      question_id: q.id,
      is_correct: Boolean(g.is_correct),
      answered: index + 1,
      total_questions: attempt.total_questions,
      result,
    });
  } catch (error) {
    console.error('quiz-attempts/answer error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save the answer' });
  }
});

router.post('/training/module/:id/quiz-attempts/:attemptId/finish', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) return res.status(400).json({ success: false, error: 'Invalid module id' });
    const attempt = await _ownModuleAttempt(userId, moduleId, req.params.attemptId);
    if (!attempt) return res.status(404).json({ success: false, error: 'Quiz not found' });

    let out;
    try {
      const paper = await _servedModulePaper(moduleId, attempt.level_id, attempt.id);
      out = await _finishModuleQuizAttempt(userId, moduleId, attempt, paper);
    } catch (finErr) {
      console.error('quiz-attempts/finish — marking unavailable, nothing closed', { moduleId, error: finErr?.message });
      return res.status(503).json({ success: false, error: 'We could not mark this quiz just now. Please try again in a moment.' });
    }
    return res.status(out.status).json(out.body);
  } catch (error) {
    console.error('quiz-attempts/finish error:', error);
    return res.status(500).json({ success: false, error: 'Failed to finish the quiz' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Grand quiz (level exam) + certificate — portal quiz-parity phase 3.
// The WhatsApp reference implementation is
// bot/shared/services/training/quiz-delivery.service.js (grading, cooldown,
// certificate) and bot/shared/routes/teacher-training-endpoint.js
// loadGrandQuizState (eligibility). The portal MUST keep identical semantics:
//   - eligibility: every active course in the level has ≥1 completed module
//   - pass bar: training_vendors.passing_pct (NIETE 80%, Beacon House 70%)
//   - fail: status='failed' + 24h cooldown_until; no cooldown on pass
//   - certificate: issued via the bot's shared certificate service on pass
// ────────────────────────────────────────────────────────────────────────────

// Parity constant — mirrors COOLDOWN_HOURS in quiz-delivery.service.js.
const GRAND_QUIZ_COOLDOWN_HOURS = 24;

/**
 * Load the teacher's grand-quiz gate for a level. Query-for-query mirror of
 * the WhatsApp Flow's loadGrandQuizState(): passed/cooldown checks filter
 * attempts to quiz_kind='grand', because per-module attempts also carry a
 * level_id and is_passed=true on a perfect score, which would wrongly report
 * the LEVEL as passed and block the real exam.
 *
 * bd-2391: the Flow backport this once flagged is done — both surfaces now
 * filter by kind here AND in the levels list above.
 *
 * Returns { quiz, passed, passedAttempt, cooldownUntil, allCoursesStarted,
 *           coursesTotal, coursesStarted, questionCount }.
 */
async function _loadGrandQuizGate(userId, levelId) {
  // bd-2483 — the DECISION comes from the bot. This used to re-derive it, and
  // its copy carried three faults the bot had already fixed:
  //   - quiz_type='grand_quiz' excluded capstones, so every Beacon House level
  //     reported no_quiz;
  //   - quiz_kind='grand' excluded capstone attempts, so a capstone pass never
  //     counted (bd-2485);
  //   - eligibility used the ">=1 module per course" proxy bd-2447 replaced.
  //
  // The bot's refusal reasons map 1:1 onto the states this portal renders, so
  // nothing is interpreted here — only relabelled.
  const gate = await TrainingRules.checkExamGateByLevel(userId, levelId);
  const level = gate.level || null;

  // questionCount is data, not a decision: how many questions the paper has.
  // Resolved by LEVEL and by exam TYPE so a capstone counts too.
  let questionCount = 0;
  let examKind = null;
  const quizId = level && level.grand_quiz_id ? level.grand_quiz_id : null;
  if (quizId) {
    const [{ data: qs }, { data: quizRow }] = await Promise.all([
      supabase.from('training_questions').select('id')
        .eq('grand_quiz_id', quizId).eq('is_active', true),
      // bd-2490 — the exam's KIND, read from the exam row rather than inferred
      // from the vendor. What the portal can render depends on whether the
      // paper is multiple choice or free text, not on whose programme it is.
      supabase.from('training_grand_quizzes').select('quiz_type').eq('id', quizId).maybeSingle(),
    ]);
    questionCount = (qs || []).length;
    examKind = (quizRow && quizRow.quiz_type) || null;
    // bd-klecr.7 — the card quotes the PAPER, not the bank: a capped vendor
    // (NIETE, 20) sits 20 of a 45–72 bank. Capstones are never capped.
    if (examKind !== 'capstone') {
      const vendor = await _vendorServingSettings(levelId);
      const cap = vendor ? Number(vendor.exam_question_cap) : NaN;
      if (Number.isFinite(cap) && cap > 0) questionCount = Math.min(questionCount, cap);
    }
  }

  return {
    // `reason` is the bot's verdict and the only thing _grandQuizState reads.
    ok: gate.ok === true,
    reason: gate.reason || null,
    message: gate.message || null,
    unavailable: gate.unavailable === true,
    passPct: typeof gate.pass_pct === 'number' ? gate.pass_pct : null,
    examKind,
    quiz: quizId ? { id: quizId, level_id: levelId } : null,
    passed: gate.reason === 'already_passed',
    passedAttempt: level && level.passed_at ? { completed_at: level.passed_at } : null,
    cooldownUntil: (level && level.cooldown_until) || null,
    allCoursesStarted: gate.ok === true || gate.reason === 'already_passed' || gate.reason === 'cooldown',
    coursesTotal: level ? level.courses_total : 0,
    coursesStarted: level ? level.courses_completed : 0,
    questionCount,
  };
}

/**
 * Reduce a gate to the single state string the frontend renders on.
 *
 * bd-2483 — a relabelling, not a decision. The bot already answered; this maps
 * its `reason` onto the vocabulary the portal's UI was built against, so the
 * frontend needs no change. Ordering is not a priority list any more, because
 * the bot returns exactly one reason.
 */
const _EXAM_REASON_TO_STATE = {
  no_exam: 'no_quiz',
  not_in_program: 'no_quiz',
  bad_level: 'no_quiz',
  already_passed: 'passed',
  cooldown: 'cooldown',
  incomplete: 'courses_incomplete',
  level_locked: 'courses_incomplete',
};

function _grandQuizState(gate) {
  // A paper with no questions is not sittable whatever the gate says. The bot
  // resolves the exam ROW; an active row with zero active questions is a
  // content fault, and 'no_quiz' is what the UI already renders for it.
  if (!gate.quiz || gate.questionCount === 0) return 'no_quiz';
  // bd-2673 — an eligible teacher can now sit the exam here, so this reports
  // 'ready' again. The interim 'whatsapp_only' state (bd-2490) is gone along
  // with the route-level refusal it described.
  //
  // Still display only: each route re-asks the bot's gate before handing over a
  // paper, so eligibility never depends on this line being right.
  if (gate.ok) return 'ready';
  // Could not reach the bot. Never render 'ready' off a failure — the caller
  // surfaces gate.message, and 'courses_incomplete' is the safe closed state
  // the UI already knows how to show.
  if (gate.unavailable) return 'courses_incomplete';
  return _EXAM_REASON_TO_STATE[gate.reason] || 'courses_incomplete';
}

/**
 * GET /api/portal/training/level/:id/grand-quiz
 *
 * Grand-quiz (level exam) status for the authenticated teacher on one level.
 * Drives the "Take Level Exam" entry point on the Training page.
 *
 * Response:
 *   { success: true, grand_quiz: {
 *       state: 'no_quiz'|'passed'|'cooldown'|'courses_incomplete'|'whatsapp_only'|'ready',
 *       question_count,
 *       pass_mark_pct: the VENDOR's bar (null if the bot could not supply it),
 *       cooldown_hours: 24 for an MCQ grand quiz, 0 for a capstone,
 *       cooldown_until: ISO|null,
 *       courses_total, courses_started,
 *       passed_at: ISO|null,
 *       certificate: { certificate_code, teacher_name, level_name, issued_at } | null
 *   } }
 *
 * 403 (with previous_level_order) when the level itself is chain-locked —
 * same _assertLevelUnlocked gate as every other training endpoint.
 */
router.get('/training/level/:id/grand-quiz', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) {
      return res.status(400).json({ success: false, error: 'Invalid level id' });
    }

    const lock = await _assertLevelUnlocked(userId, levelId);
    if (!lock.ok) return res.status(lock.status).json({ success: false, error: lock.error, previous_level_order: lock.previous_level_order });

    const gate = await _loadGrandQuizGate(userId, levelId);
    const state = _grandQuizState(gate);

    // Attach the certificate when passed (newest first if re-issues ever exist).
    let certificate = null;
    if (state === 'passed') {
      const { data: certs } = await supabase
        .from('training_certificates')
        .select('certificate_code, teacher_name_snapshot, level_name_snapshot, issued_at')
        .eq('user_id', userId)
        .eq('level_id', levelId)
        .order('issued_at', { ascending: false })
        .limit(1);
      const c = (certs || [])[0];
      if (c) {
        certificate = {
          certificate_code: c.certificate_code,
          teacher_name: c.teacher_name_snapshot,
          level_name: c.level_name_snapshot,
          issued_at: c.issued_at,
        };
      }
    }

    return res.json({
      success: true,
      grand_quiz: {
        state,
        exam_kind: gate.examKind,
        question_count: gate.questionCount,
        // bd-2393 — was hardcoded 100. The bar is the vendor's.
        pass_mark_pct: gate.passPct,
        // bd-2475 — was GRAND_QUIZ_COOLDOWN_HOURS unconditionally. A capstone
        // has no cooldown: capstone-delivery.service grades an attempt without
        // ever writing `cooldown_until`, so there is no window to serve out and
        // nothing for a retry gate to read. Advertising 24h there is the API
        // inventing a rule the grader does not implement — and it is a rule the
        // teacher would obey, waiting a day for nothing.
        cooldown_hours: gate.examKind === 'capstone' ? 0 : GRAND_QUIZ_COOLDOWN_HOURS,
        cooldown_until: gate.cooldownUntil,
        courses_total: gate.coursesTotal,
        courses_started: gate.coursesStarted,
        passed_at: gate.passedAttempt ? gate.passedAttempt.completed_at : null,
        certificate,
      },
    });
  } catch (error) {
    console.error('training/level/:id/grand-quiz error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load grand quiz status' });
  }
});

/**
 * GET /api/portal/training/level/:id/grand-quiz/questions
 *
 * The exam paper — active questions for the level's grand quiz, in the same
 * canonical order the WhatsApp side asks them (order_index ascending).
 * `correct_option` is NEVER returned; grading is server-side only.
 *
 * 403 unless the teacher is currently eligible to sit the exam (state 'ready'
 * — the same gate the submit endpoint enforces, so the UI can't fetch a paper
 * it can't submit).
 */
router.get('/training/level/:id/grand-quiz/questions', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) {
      return res.status(400).json({ success: false, error: 'Invalid level id' });
    }

    const lock = await _assertLevelUnlocked(userId, levelId);
    if (!lock.ok) return res.status(lock.status).json({ success: false, error: lock.error, previous_level_order: lock.previous_level_order });

    const gate = await _loadGrandQuizGate(userId, levelId);
    if (gate.unavailable) {
      return res.status(503).json({ success: false, code: 'unavailable', error: gate.message });
    }
    const state = _grandQuizState(gate);
    if (state !== 'ready') {
      return res.status(state === 'no_quiz' ? 404 : 403).json({
        success: false,
        code: state,
        error: state === 'no_quiz' ? 'No grand quiz configured for this level'
          : state === 'passed' ? 'You already passed this level exam'
          : state === 'cooldown' ? 'Exam locked after a recent failed attempt'
          : 'Complete all courses in this level to unlock the exam',
        cooldown_until: gate.cooldownUntil,
      });
    }

    // bd-klecr.7 — the paper is an ATTEMPT's, as on WhatsApp: resume her open
    // attempt on this exam (a reload, or one started on WhatsApp), else open
    // one now, sized to the served paper. The attempt id seeds the draw, so the
    // submit marks exactly these questions.
    const { data: latest } = await supabase
      .from('training_assessment_attempts')
      .select('id, user_id, status')
      .eq('user_id', userId)
      .eq('grand_quiz_id', gate.quiz.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const open = latest && latest.status === 'in_progress' && latest.user_id === userId ? latest : null;
    const attemptId = open ? open.id : crypto.randomUUID();

    let paper;
    try {
      paper = await _servedExamPaper(gate.quiz.id, levelId, attemptId);
    } catch (serveErr) {
      console.error('grand-quiz/questions — serving unavailable, nothing written', { levelId, error: serveErr?.message });
      return res.status(503).json({ success: false, code: 'unavailable', error: 'We could not load this exam just now. Please try again in a moment.' });
    }
    if (paper.length === 0) {
      return res.status(404).json({ success: false, code: 'no_quiz', error: 'This level has no active exam questions' });
    }

    if (!open) {
      const { data: assignment } = await supabase
        .from('teacher_training_assignments')
        .select('program_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!assignment) return res.status(400).json({ success: false, error: 'No active training program assignment' });
      const now = new Date().toISOString();
      // Shape parity with quiz-delivery.service.js startGrandQuiz.
      const { error: insErr } = await supabase
        .from('training_assessment_attempts')
        .insert({
          id: attemptId,
          user_id: userId,
          program_id: assignment.program_id,
          quiz_kind: 'grand',
          grand_quiz_id: gate.quiz.id,
          level_id: levelId,
          current_question_index: 0,
          total_questions: paper.length,
          total_score: paper.length,
          status: 'in_progress',
          started_at: now,
          last_activity_at: now,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
    }

    return res.json({
      success: true,
      attempt_id: attemptId,
      questions: paper.map(({ q, display_order: order }) => {
        const opts = Array.isArray(q.options) ? q.options : [];
        const shown = order.length ? order : opts.map((_, i) => i + 1);
        return {
          id: q.id,
          question_text: q.question_text,
          question_urdu: q.question_urdu || null,
          // In the served order; option_values[i] is the canonical 1-based value
          // of options[i] — what the submit sends, whatever order is shown.
          options: shown.map((i) => opts[i - 1]),
          option_values: shown.map(String),
          order_index: q.order_index,
        };
      }),
      question_count: paper.length,
    });
  } catch (error) {
    console.error('training/level/:id/grand-quiz/questions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load exam questions' });
  }
});

/**
 * POST /api/portal/training/level/:id/grand-quiz/attempts
 *
 * Submit a full grand-quiz (level exam) attempt from the portal. Server-side
 * grades every answer and persists to the SAME tables with the SAME semantics
 * as the WhatsApp writer (quiz-delivery.service.js, quiz_kind='grand'):
 *
 *   - `quiz_kind='grand'`, `grand_quiz_id`, `level_id`, `program_id`
 *   - `total_score = total_questions` (one point per question)
 *   - pass bar: `training_vendors.passing_pct` (NIETE 80%, Beacon House 70%)
 *   - pass  → `status='passed'`,  `cooldown_until = null`, certificate issued
 *   - fail  → `status='failed'`,  `cooldown_until = now + 24h`
 *   - answers: one row per question with the canonical 0-based
 *     `question_index` (position in order_index-sorted list — matches the
 *     WhatsApp Q-by-Q writer)
 *   - abandonment never triggers cooldown: the portal submits one-shot, so an
 *     abandoned portal form simply never writes an attempt. (On WhatsApp an
 *     abandoned attempt stays 'in_progress' and is resumed on the next
 *     start — the 'abandoned' enum state exists in the schema but no sweep
 *     writes it yet. Neither surface ever sets cooldown without a graded
 *     fail.)
 *
 * Gate order: 400 bad input → 403/404 level locked → 404 no quiz →
 * 409 already passed → 403 cooldown (code:'cooldown') →
 * 403 courses incomplete (code:'courses_incomplete') → 400 answer mismatch.
 *
 * Body:  { answers: [{ question_id, chosen_option }, ...] } — one entry per
 *        active question; `chosen_option` is the 1-based option index as a
 *        string ('1'..'10'), identical to the WhatsApp button payload.
 * Ok:    { success: true, attempt: { id, score, max_score, is_passed, status,
 *          cooldown_until, completed_at }, certificate: {...}|null }
 */
router.post('/training/level/:id/grand-quiz/attempts', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const levelId = parseInt(req.params.id, 10);
    if (!Number.isFinite(levelId)) {
      return res.status(400).json({ success: false, error: 'Invalid level id' });
    }

    const answers = req.body && Array.isArray(req.body.answers) ? req.body.answers : null;
    if (!answers) {
      return res.status(400).json({ success: false, error: 'Body must include an answers array' });
    }

    // 0. Enrolment, checked BEFORE the lock gate on purpose.
    //
    // bd-2469 — the bot's catalogue is program-scoped, so an unenrolled
    // teacher's level simply is not in it and the gate answers a generic
    // "Level not found" (404). True, but useless: "you are not enrolled on a
    // training program" and "that level does not exist" are different problems
    // with different fixes, and the caller can only act on the first if we say
    // it. Running the specific check first keeps the 400 contract the frontend
    // already branches on; the gate below would deny anyway.
    // .limit(1) is load-bearing: a teacher who picked two bands holds two
    // active assignments, and PostgREST answers an unbounded .maybeSingle()
    // with PGRST116 and data:null. Only `data` is read here, so without the
    // bound that null reads as "not enrolled" and she is refused her own exam.
    // 787 teachers on production hold two. The same read 70 lines down, and
    // the two in the capstone and module-quiz handlers, already carry it.
    const { data: enrolment } = await supabase
      .from('teacher_training_assignments')
      .select('program_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!enrolment) {
      return res.status(400).json({ success: false, error: 'No active training program assignment' });
    }

    // 1. Level chain-lock gate — same rule as every other training endpoint.
    const lock = await _assertLevelUnlocked(userId, levelId);
    if (!lock.ok) return res.status(lock.status).json({ success: false, error: lock.error, previous_level_order: lock.previous_level_order });

    // 2. Grand-quiz gate — quiz exists, not passed, no cooldown, all courses
    //    started (the WhatsApp eligibility rule, checked server-side so a
    //    hand-crafted request can't skip the level's coursework).
    const gate = await _loadGrandQuizGate(userId, levelId);
    // Checked BEFORE !gate.quiz. When the bot is unreachable there is no level
    // and therefore no quiz id, so this would otherwise answer "No grand quiz
    // configured for this level" — the exact misleading message bd-2476 fixed,
    // reachable again through a transport failure. Say what is actually wrong.
    if (gate.unavailable) {
      return res.status(503).json({ success: false, code: 'unavailable', error: gate.message });
    }
    if (!gate.quiz) {
      return res.status(404).json({ success: false, code: 'no_quiz', error: 'No grand quiz configured for this level' });
    }
    if (gate.passed) {
      return res.status(409).json({ success: false, code: 'already_passed', error: 'You already passed this level exam' });
    }
    if (gate.cooldownUntil) {
      return res.status(403).json({
        success: false,
        code: 'cooldown',
        error: 'Exam locked after a recent failed attempt',
        cooldown_until: gate.cooldownUntil,
      });
    }
    if (!gate.allCoursesStarted) {
      return res.status(403).json({
        success: false,
        code: 'courses_incomplete',
        error: 'Complete all courses in this level to unlock the exam',
        courses_total: gate.coursesTotal,
        courses_started: gate.coursesStarted,
      });
    }

    // 3. The attempt's paper (bd-klecr.7). GET …/questions opened the attempt
    //    and served its paper; this marks exactly that paper. The page sends
    //    the attempt id; without one, her open attempt on this exam is used.
    let openAttempt = null;
    {
      const wanted = req.body && req.body.attempt_id ? String(req.body.attempt_id) : null;
      let q = supabase
        .from('training_assessment_attempts')
        .select('id, user_id, quiz_kind, grand_quiz_id, status, started_at')
        .eq('user_id', userId)
        .eq('grand_quiz_id', gate.quiz.id)
        .eq('status', 'in_progress');
      if (wanted) q = q.eq('id', wanted);
      const { data: openRows } = await q.order('started_at', { ascending: false }).limit(1);
      // Re-checked here as well as filtered above: only HER attempt that is still OPEN is closed.
      openAttempt = (openRows || []).find((r) => r.status === 'in_progress' && r.user_id === userId) || null;
    }
    // No open attempt (a page that posts without opening the exam first): the
    // paper is drawn for a new attempt id here, and the attempt is written in
    // one go below — the old one-shot behaviour, still bound by the vendor's
    // serving rule (a capped NIETE paper is 20, so the whole bank is refused).
    const paperAttemptId = openAttempt ? openAttempt.id : crypto.randomUUID();
    let paper;
    try {
      paper = await _servedExamPaper(gate.quiz.id, levelId, paperAttemptId);
    } catch (serveErr) {
      console.error('grand-quiz/attempts — serving unavailable, nothing written', { levelId, error: serveErr?.message });
      return res.status(503).json({ success: false, error: 'We could not mark this exam just now. Please try again in a moment.' });
    }
    const qList = paper.map(({ q }) => ({ id: q.id, correct_option: q.correct_option, order_index: q.order_index }));
    if (qList.length === 0) {
      return res.status(404).json({ success: false, code: 'no_quiz', error: 'This level has no active exam questions' });
    }
    if (answers.length !== qList.length) {
      return res.status(400).json({
        success: false,
        error: `Answer count mismatch: expected ${qList.length}, got ${answers.length}`,
      });
    }

    // 4. Program assignment — NOT NULL on the attempts table (matches the
    //    WhatsApp enrollment requirement in startGrandQuiz).
    const { data: assignment } = await supabase
      .from('teacher_training_assignments')
      .select('program_id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!assignment) {
      return res.status(400).json({ success: false, error: 'No active training program assignment' });
    }

    // 5. Mark the paper — the BOT decides which answers are correct.
    //    bd-2673 — see the module-quiz route above; this was the second copy.
    let marked;
    try {
      marked = await TrainingRules.markPaper(qList, answers);
    } catch (markErr) {
      console.error('training/level/:id/grand-quiz/attempts — marking unavailable, nothing written', {
        levelId, error: markErr?.message,
      });
      return res.status(503).json({
        success: false,
        error: 'We could not mark this exam just now. Please try again in a moment.',
      });
    }
    if (marked.has_unknown_question) {
      return res.status(400).json({ success: false, error: 'One or more answers reference a question not on this exam' });
    }
    if (marked.has_duplicate_answer || marked.graded.length !== qList.length) {
      return res.status(400).json({ success: false, error: 'Duplicate answers for the same question' });
    }

    const graded = marked.graded;
    const totalQuestions = marked.total_questions;
    const score = marked.score;

    // 5b. The PASS decision — also the bot's.
    //
    //     bd-2673 — this used to read training_vendors.passing_pct here and do
    //     the percentage arithmetic locally, with a hardcoded 100 fallback. That
    //     is a second implementation of the pass rule: bd-2393 had already been
    //     fixed once on this exact line, and bd-2483 fixed the module-quiz twin.
    //     The vendor bar now comes back with the verdict, so there is nothing
    //     left here to drift.
    //
    //     Throws rather than defaulting, for the same reason as marking above.
    let examVerdict;
    try {
      examVerdict = await TrainingRules.getExamVerdict(levelId, score, totalQuestions);
    } catch (gradeErr) {
      console.error('training/level/:id/grand-quiz/attempts — grading unavailable, nothing written', {
        levelId, error: gradeErr?.message,
      });
      return res.status(503).json({
        success: false,
        error: 'We could not mark this exam just now. Please try again in a moment.',
      });
    }
    const examPassPct = examVerdict.pass_pct;
    const isPassed = examVerdict.is_passed;
    const completedAt = new Date().toISOString();
    const cooldownUntil = isPassed
      ? null
      : new Date(Date.now() + GRAND_QUIZ_COOLDOWN_HOURS * 3_600_000).toISOString();

    // 6. Close the attempt the paper was served for — shape parity with
    //    quiz-delivery.service.js gradeAttempt's grand branch. Conditional on
    //    still being open, so a parallel submit cannot close it twice.
    const closing = {
      current_question_index: totalQuestions,
      total_questions: totalQuestions,
      total_score: totalQuestions,
      status: isPassed ? 'passed' : 'failed',
      score,
      is_passed: isPassed,
      completed_at: completedAt,
      last_activity_at: completedAt,
      cooldown_until: cooldownUntil,
    };
    if (openAttempt) {
      const { data: closedRows, error: aErr } = await supabase
        .from('training_assessment_attempts')
        .update(closing)
        .eq('id', openAttempt.id)
        .eq('status', 'in_progress')
        .select('id');
      if (aErr) throw aErr;
      if (!closedRows || closedRows.length === 0) {
        return res.status(409).json({ success: false, code: 'already_submitted', error: 'This exam was already submitted' });
      }
    } else {
      const { error: aErr } = await supabase
        .from('training_assessment_attempts')
        .insert({
          id: paperAttemptId,
          user_id: userId,
          program_id: assignment.program_id,
          quiz_kind: 'grand',
          grand_quiz_id: gate.quiz.id,
          level_id: levelId,
          started_at: completedAt,          // one-shot: no partial state
          ...closing,
        })
        .select('id')
        .single();
      if (aErr) throw aErr;
    }
    const attempt = { id: paperAttemptId };

    // 7. Per-question answer rows — upserted, because an attempt started on
    //    WhatsApp already holds the answers she gave there; her final answers
    //    from this page replace them, one row per question either way.
    const answerRows = graded.map(g => ({
      attempt_id: attempt.id,
      question_index: g.question_index,
      question_id: g.question_id,
      chosen_option: g.chosen_option,
      is_correct: g.is_correct,
      answered_at: completedAt,
    }));
    const { error: ansErr } = await supabase
      .from('training_assessment_answers')
      .upsert(answerRows, { onConflict: 'attempt_id,question_index' });
    if (ansErr) throw ansErr;

    // 8. Certificate on pass — the bot's shared issuance service (idempotent
    //    per attempt; PDF rendering stays a separate concern). Lazy require:
    //    the service lives in the bot tree and must not load at router mount.
    let certificate = null;
    if (isPassed) {
      // Through the bot's GUARD, not the raw issuer.
      //
      // This called issueCertificate directly the moment the attempt passed,
      // which skips every completeness check: the portal's copy of the WhatsApp bug,
      // where one pass minted a certificate without asking whether the units
      // were finished or the per-module exams passed. The decision belongs to
      // the bot so that WhatsApp and the portal cannot disagree about who is
      // certified. Denies (issues nothing) if the rules API is unreachable —
      // the graded attempt above is already written either way.
      const cert = await TrainingRules.certifyLevel({
        userId,
        levelId,
        attemptId: attempt.id,
        programId: assignment.program_id,
      });
      certificate = cert.issued ? {
        certificate_code: cert.certificate_code,
        teacher_name: cert.teacher_name,
        level_name: cert.level_name,
        issued_at: cert.issued_at,
      } : null;
    }

    // 9. Semantic event — observability parity with the module-quiz endpoint.
    try {
      const { logEvent } = require('../../bot/shared/utils/structured-logger');
      const grandCompletedPayload = {
        user_uuid: userId,
        attempt_uuid: attempt.id,
        level_row_id: levelId,
        raw_score: score,
        total_qs: totalQuestions,
        did_pass: isPassed,
        surface: 'portal',
      };
      logEvent('grand_quiz_completed', grandCompletedPayload);
    } catch (_) { /* logger not available — best-effort telemetry */ }

    return res.json({
      success: true,
      attempt: {
        id: attempt.id,
        score,
        max_score: totalQuestions,
        is_passed: isPassed,
        status: isPassed ? 'passed' : 'failed',
        cooldown_until: cooldownUntil,
        completed_at: completedAt,
      },
      certificate,
    });
  } catch (error) {
    console.error('training/level/:id/grand-quiz/attempts POST error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit exam attempt' });
  }
});

/**
 * POST /api/portal/training/module/:id/complete
 *
 * Mark a QUIZ-LESS training module complete from the portal. Modules with an
 * active quiz get their completion from quiz submission (POST
 * /training/module/:id/quiz-attempts upserts progress) — this endpoint exists
 * only for the modules that have zero active training_questions and therefore
 * had no completion path on the portal at all. Writes the same
 * teacher_training_progress row shape the WhatsApp side and the quiz-submit
 * endpoint write: { user_id, module_id, completed_at }.
 *
 * Contract:
 *   Path   :id — BIGINT module id
 *   Auth   requirePortalAuth (401 on session miss).
 *   Errors 400 (bad id), 403 (level locked), 404 (module not found),
 *          409 (module HAS an active quiz — complete it via the quiz instead),
 *          500 on DB error.
 *   Ok     { success: true, completed_at, already_completed }
 *
 * Idempotent: if a progress row already exists for (user_id, module_id) the
 * endpoint returns the EXISTING completed_at (earliest completion wins,
 * matching the read-side rule in GET /training/modules) and writes nothing.
 * The write itself upserts on the (user_id, module_id) unique constraint so a
 * concurrent double-click cannot 500 on a duplicate either.
 */
/**
 * GET /api/portal/training/module/:id/exam
 *
 * May this teacher sit this module's summative exam?
 *
 * The portal had no concept of a module exam: `source_quiz_id` appeared
 * nowhere in this file, so an I-SAPS teacher could finish all 54 units here
 * and never reach a summative assessment. `:id` is the COURSE (a "module" in
 * I-SAPS terms), matching how the exam is keyed.
 *
 * The verdict comes from the bot, so this screen and WhatsApp cannot disagree
 * about whether the exam is open.
 */
router.get('/training/module/:id/exam', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const courseId = parseInt(req.params.id, 10);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }
    const gate = await TrainingRules.moduleExamGate(userId, courseId);
    return res.json({ success: true, exam: gate });
  } catch (error) {
    console.error('training/module/:id/exam GET error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load the module exam' });
  }
});

/**
 * GET /api/portal/training/module/:id/exam/questions
 *
 * Opens (or resumes) the attempt and returns the served paper:
 * 2 scenario MCQs + 1 written answer, seeded on the attempt id so a page
 * reload re-derives the SAME three questions rather than drawing fresh ones.
 *
 * Answer keys never cross this boundary — the bot strips them.
 */
router.get('/training/module/:id/exam/questions', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const courseId = parseInt(req.params.id, 10);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }
    const { data: assignment } = await supabase
      .from('teacher_training_assignments').select('program_id')
      .eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();

    const paper = await TrainingRules.startModuleExam(userId, courseId, assignment?.program_id || null);
    if (!paper.ok) {
      return res.status(409).json({ success: false, error: 'This exam is not available yet.', reason: paper.reason });
    }
    return res.json({
      success: true,
      attempt_id: paper.attempt_id,
      module_title: paper.module_title,
      total_questions: paper.total_questions,
      questions: paper.questions,
    });
  } catch (error) {
    console.error('training/module/:id/exam/questions GET error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load the exam paper' });
  }
});

/**
 * POST /api/portal/training/module/:id/exam/attempts
 * Body { attempt_id, answers:[{question_id, chosen_option?, answer_text?}] }
 *
 * Submit the paper.
 *
 * Marking happens in the bot, with the same grader WhatsApp uses, so identical
 * words earn an identical score whichever surface a teacher used.
 *
 * THE WRITTEN ANSWER IS MARKED IN THE BACKGROUND (operator decision): the
 * answers are committed and this returns `crq_pending: true` immediately, with
 * the rubric score landing when the model replies. A ~10s LLM call must never
 * be the reason a teacher's typed answer is lost.
 */
/**
 * PUT /api/portal/training/module/:id/exam/draft
 * Body { attempt_id, question_id, question_index, chosen_option?, answer_text? }
 *   -> { success, saved }
 *
 * Autosave one answer mid-paper.
 *
 * Answers used to live in React state until Submit, so a closed tab, a phone
 * call or a backgrounded app lost the whole paper — including an
 * ~1,800-character written answer. One-question-per-page made that worse
 * rather than better, because a teacher can no longer see what she would lose.
 *
 * ALWAYS 200. A failed autosave is reported as `saved: false` and never as an
 * error status: the answer is still on her screen, and an error toast
 * mid-exam over work that is not actually lost is worse than the silence.
 */
router.put('/training/module/:id/exam/draft', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const b = req.body || {};
    if (!b.attempt_id || b.question_id === undefined || b.question_index === undefined) {
      return res.status(400).json({ success: false, error: 'attempt_id, question_id and question_index are required' });
    }
    const saved = await TrainingRules.saveModuleExamDraft(userId, b.attempt_id, {
      questionId: b.question_id,
      questionIndex: b.question_index,
      chosenOption: b.chosen_option ?? null,
      answerText: b.answer_text ?? null,
    });
    return res.json({ success: true, saved });
  } catch (error) {
    console.error('training/module/:id/exam/draft error:', error?.message);
    return res.json({ success: true, saved: false });
  }
});

/**
 * GET /api/portal/training/module/:id/exam/draft?attempt_id=…
 *   -> { success, answers[] }
 *
 * What the teacher has already answered, so resuming an attempt shows their
 * own work instead of a blank paper.
 */
router.get('/training/module/:id/exam/draft', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const attemptId = req.query.attempt_id;
    if (!attemptId) return res.status(400).json({ success: false, error: 'attempt_id is required' });
    const answers = await TrainingRules.loadModuleExamDraft(userId, String(attemptId));
    return res.json({ success: true, answers });
  } catch (error) {
    console.error('training/module/:id/exam/draft GET error:', error?.message);
    return res.json({ success: true, answers: [] });
  }
});

/**
 * GET /api/portal/training/module/:id/exam/attempts -> { success, attempts[] }
 *
 * bd-2exhl — her submitted sittings of this module's exam, newest first, so the
 * exam page can say what happened to each (being graded / not passed / passed)
 * and let her read back what she submitted.
 */
router.get('/training/module/:id/exam/attempts', requirePortalAuth, async (req, res) => {
  const courseId = parseInt(req.params.id, 10);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ success: false, error: 'Invalid module id' });
  }
  const attempts = await TrainingRules.moduleExamAttempts(req.session.portalUserId, courseId);
  return res.json({ success: true, attempts });
});

router.post('/training/module/:id/exam/attempts', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const { attempt_id: attemptId, answers } = req.body || {};
    if (!attemptId) {
      return res.status(400).json({ success: false, error: 'attempt_id is required' });
    }
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ success: false, error: 'answers[] is required' });
    }
    const result = await TrainingRules.submitModuleExam(userId, attemptId, answers);
    return res.json({ success: true, ...result });
  } catch (error) {
    // The rules client THROWS when marking cannot be trusted; abandoning the
    // write is correct, because recording an unmarked pass invents progress
    // and an unmarked fail destroys real work.
    console.error('training/module/:id/exam/attempts POST error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit the exam' });
  }
});

router.post('/training/module/:id/complete', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const moduleId = parseInt(req.params.id, 10);
    if (!Number.isFinite(moduleId)) {
      return res.status(400).json({ success: false, error: 'Invalid module id' });
    }

    // 1. Load module (existence + course_id for the lockdown gate)
    const { data: mod, error: modErr } = await supabase
      .from('training_modules')
      .select('id, course_id, is_active')
      .eq('id', moduleId)
      .eq('is_active', true)
      .maybeSingle();
    if (modErr) throw modErr;
    if (!mod) return res.status(404).json({ success: false, error: 'Module not found' });

    // 2. Lockdown gate — same rule as every other training endpoint.
    if (mod.course_id) {
      const { data: course } = await supabase
        .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
      if (course) {
        const gate = await _assertLevelUnlocked(userId, course.level_id);
        if (!gate.ok) return res.status(gate.status).json({ success: false, error: gate.error, previous_level_order: gate.previous_level_order });
      }
      // bd-2481 — the module-ORDER gate, outside the `if (course)` above on
      // purpose. The bot denies an unknown module or one with no course, so
      // running it unconditionally also closes the orphan-module hole the
      // level gate leaves open.
      const modGate = await _assertModuleUnlocked(userId, moduleId);
      if (!modGate.ok) return res.status(modGate.status).json({ success: false, error: modGate.error });
    }

    // 3. Quiz-less check — modules WITH active questions must complete via
    //    quiz submission, never via this shortcut. Existence probe (limit 1).
    const { data: activeQuestions, error: qErr } = await supabase
      .from('training_questions')
      .select('id')
      .eq('training_module_id', moduleId)
      .eq('is_active', true)
      .limit(1);
    if (qErr) throw qErr;
    if ((activeQuestions || []).length > 0) {
      return res.status(409).json({
        success: false,
        error: 'This module has a quiz — completion is recorded when you submit it.',
      });
    }

    // 4. Idempotency — if the teacher already completed this module (on either
    //    surface), return the existing timestamp untouched. Earliest wins.
    const { data: existing } = await supabase
      .from('teacher_training_progress')
      .select('completed_at')
      .eq('user_id', userId)
      .eq('module_id', moduleId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: true })
      .limit(1);
    if (existing && existing[0]) {
      return res.json({ success: true, completed_at: existing[0].completed_at, already_completed: true });
    }

    // 5. Write the progress row — same shape as the quiz-submit endpoint and
    //    the WhatsApp content-delivery writer. Upsert on the (user_id,
    //    module_id) unique constraint keeps a concurrent double-submit safe.
    const completedAt = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('teacher_training_progress')
      .upsert(
        { user_id: userId, module_id: moduleId, completed_at: completedAt },
        { onConflict: 'user_id,module_id' }
      );
    if (upErr) throw upErr;

    // 6. Semantic event — best-effort telemetry, mirrors the quiz-submit style.
    try {
      const { logEvent } = require('../../bot/shared/utils/structured-logger');
      logEvent('training_module_marked_complete', {
        user_uuid: userId,
        module_row_id: moduleId,
        surface: 'portal',
      });
    } catch (_) { /* logger not available — fine */ }

    return res.json({ success: true, completed_at: completedAt, already_completed: false });
  } catch (error) {
    console.error('training/module/:id/complete POST error:', error);
    return res.status(500).json({ success: false, error: 'Failed to mark module complete' });
  }
});

/**
 * GET /api/portal/coaching-sessions
 * Get all coaching sessions for authenticated user
 */
router.get('/coaching-sessions', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // bd-5rz1v — SLICES of analysis_data, not the column: it averages ~30 KB a
    // row (62 KB max, sandbox 2026-10-02) and the list now asks for up to 100
    // rows, while all it reads is the scores block (~190 B) and three labels.
    // 100 × 30 KB = 3 MB per page load, against ~40 KB. getOverall reads only
    // `.scores`, so it is given exactly that.
    // Named, so tests/setup/column-completeness (which reads `.select('…')`
    // literals) does not run on past a joined-string select into the code below.
    const listColumns = 'id, created_at, audio_duration_seconds, status, scores:analysis_data->scores, '
      + 'framework:analysis_data->>framework, topic:analysis_data->>topic, subject:analysis_data->>subject, '
      + 'observation_type, observer_user_id, sent_at:analysis_data->teacher_delivery->>sent_at, '
      + 'send_requested_at:analysis_data->teacher_delivery->>send_requested_at';
    const { data: coachingSessions, error, count } = await supabase
      .from('coaching_sessions')
      .select(listColumns, { count: 'exact' })
      .eq('user_id', userId)
      .not('analysis_data', 'is', null)
      // Her own lessons once completed; a coach's observation once the coach
      // has sent it to her (even before she opens the WhatsApp invite, and
      // even while the coach's debrief is still open) — never a draft.
      .or(TeacherObservation.LISTED_FOR_TEACHER_OR)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const observers = await TeacherObservation.observerNames(supabase, coachingSessions);

    // Format sessions with summary data
    // NOTE: Transform 'created_at' to 'date' and 'audio_duration_seconds' to 'duration'
    // NOTE: Actual score path is analysis_data.scores.overall_marks (not overall_score.points)
    const formattedSessions = (coachingSessions || []).map(session => ({
      id: session.id,
      date: session.created_at,
      session_date: session.created_at, // Portal expects 'session_date'
      duration: session.audio_duration_seconds,
      // getOverall (coaching-frameworks.service) already normalises every
      // framework's score shape and is what the leader dashboard uses — the
      // coaching routes simply never called it. It reads overall_percentage,
      // which is the key that exists: `scores.percentage` appears in 0 of 500
      // sampled production sessions, so this card has always shown 0%.
      // It also drops the `|| 118` max, which is wrong for every FICO session
      // (the denominator is computed per subject: 42 / 44 / 38).
      ...(({ points, maxPoints, percentage }) => ({
        overallScore: points,
        maxScore: maxPoints,
        percentage,
      }))(getOverall({ scores: session.scores })),
      // The framework she was actually scored on, so the card can say so
      // instead of implying one.
      framework: session.framework || null,
      // bd-5rz1v — what the lesson was about, as its analysis found it, so the
      // Coaching list can name and filter lessons. null when not found.
      topic: session.topic || null,
      subject: session.subject || null,
      // Who observed her and when, for a coach's observation; null for her own lessons.
      observation: TeacherObservation.isObservation(session)
        ? {
          observerName: observers[session.observer_user_id] || null,
          observedAt: session.created_at,
          sentAt: session.sent_at || session.send_requested_at || null,
        }
        : null,
    }));

    res.json({
      success: true,
      sessions: formattedSessions,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Coaching sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load coaching sessions'
    });
  }
});

/**
 * GET /api/portal/coaching-session/:id
 * Get detailed coaching session analysis
 * IMPORTANT: Frontend expects analysisData with specific structure:
 * - overall_score: { points, max_points, percentage }
 * - goal_scores: [{ goal, points, max_points, percentage }]
 * - criterion_scores: [{ criterion, points, max_points, percentage }]
 * - strengths, growth_opportunities, recommendations: arrays of strings
 */
router.get('/coaching-session/:id', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const sessionId = req.params.id;

    const { data: session, error } = await supabase
      .from('coaching_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId) // Security: ensure user owns this session
      .single();

    // A coach's observation that has not been sent to her is not hers yet — the
    // same answer as a session that does not exist.
    if (error || !session || !TeacherObservation.teacherMaySee(session)) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Transform analysis_data structure to match frontend expectations
    // getOverall normalises every framework's score shape (see
    // coaching-frameworks.service) and is already what the leader dashboard
    // uses. It reads overall_percentage — the key that exists — where this
    // route read `scores.percentage`, absent from all 500 sampled production
    // sessions, so every percentage printed here was the `|| 0`. It also drops
    // the `|| 118` max, wrong for every FICO session.
    const { points: overallMarks, maxPoints: maxMarks, percentage } =
      getOverall(session.analysis_data);

    // The score breakdown comes from the BOT, which dispatches five frameworks
    // through the same adapter that renders her WhatsApp report image. This
    // file used to assemble six OECD goal bars from scores.goal1_total…
    // goal5_total; every NIETE region is FICO and a FICO session carries none
    // of those keys, so five bars rendered zero under labels her framework has
    // never used — silently, because each read carried a `|| 0`.
    //
    // A failure here is a 5xx, not an empty breakdown: drawing zeros is the
    // exact failure this change removes.
    const breakdown = await CoachingBreakdown.breakdown(
      session.analysis_data,
      session.voice_debrief_language || session.transcript_language || 'en',
    );

    // Extract narrative arrays from analysis_data
    const strengthsArray = session.analysis_data?.strengths?.map(s =>
      typeof s === 'string' ? s : s.title || s.analysis || 'Strength identified'
    ) || [];

    const growthArray = session.analysis_data?.growth_opportunities?.map(g =>
      typeof g === 'string' ? g : g.area || g.rationale || 'Growth area identified'
    ) || [];

    const recommendationsArray = session.analysis_data?.recommendations || [];

    // Every artifact is presigned, through the same helper the training and
    // video endpoints already use. Coaching is the one that never got it: the
    // raw private-bucket URLs it returned answer HTTP 400, so the download
    // button has been broken for every teacher.
    //
    // TWO recordings, named for what they are. The player titled "Session
    // Recording" was being fed voice_debrief_url — the COACH talking. Her own
    // lesson is in audio_url, present on 100% of sessions, and has never once
    // been served to her.
    const [lessonAudioUrl, debriefAudioUrl, reportUrl, lessonPlanUrl] = await Promise.all([
      _resolveMediaUrl(session.audio_url),
      _resolveMediaUrl(session.voice_debrief_url),
      _resolveMediaUrl(session.report_pdf_url),
      _resolveMediaUrl(session.lesson_plan_url),
    ]);

    // Her classroom photos, if she sent any (49% of sessions do).
    const photoUrls = (await Promise.all(
      (Array.isArray(session.classroom_photos) ? session.classroom_photos : [])
        .map((ph) => _resolveMediaUrl(typeof ph === 'string' ? ph : (ph && (ph.url || ph.r2_url)))),
    )).filter(Boolean);

    // Her reflective Q&A — the questions Rumi asked and HER OWN answers, which
    // she has never been able to re-read. Read-only here: answering stays on
    // WhatsApp, and the UI says so rather than implying the page is inert.
    const reflection = ((session.conversation_state || {}).questions || [])
      .filter((q) => q && (q.question || q.answer))
      .map((q) => ({
        question: q.question || null,
        answer: q.answer || null,
        language: q.language || null,
        asked_at: q.asked_at || null,
        answered_at: q.answered_at || null,
      }));

    // A coach's observation: the report as WhatsApp delivered it to her — the
    // image, its caption, the companion text — and who observed her, and when.
    // The coach's debrief (observer_debrief) is hers alone and never served.
    let observation = null;
    if (TeacherObservation.isObservation(session)) {
      const delivery = (session.analysis_data && session.analysis_data.teacher_delivery) || {};
      const names = await TeacherObservation.observerNames(supabase, [session]);
      const reportImageUrl = delivery.report_key && process.env.R2_ENDPOINT && process.env.R2_BUCKET_NAME
        ? await _resolveMediaUrl(`${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${delivery.report_key}`)
        : null;
      observation = {
        observerName: names[session.observer_user_id] || null,
        observedAt: session.created_at,
        sentAt: delivery.sent_at || delivery.send_requested_at || null,
        reportImageUrl,
        caption: delivery.caption || null,
        companionText: delivery.companion_text || null,
      };
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        date: session.created_at,
        session_date: session.created_at, // Portal expects 'session_date'
        duration: session.audio_duration_seconds,
        status: session.status,
        observation,
        // bd-5rz1v — the lesson page's title line; null when not found.
        topic: session.analysis_data?.topic || null,
        subject: session.analysis_data?.subject || null,

        // ── what she recorded ──────────────────────────────────────────────
        lessonAudioUrl,                       // HER lesson
        debriefAudioUrl,                      // the coach's spoken feedback
        // Kept so an older bundle mid-deploy does not lose its player. It now
        // points at HER lesson, which is what the label always claimed.
        audioUrl: lessonAudioUrl,
        transcript: session.transcript_text,
        transcriptLanguage: session.transcript_language || null,

        // ── the artifacts ──────────────────────────────────────────────────
        // `reportUrl` + `reportFormat`, because the column is named
        // report_pdf_url and holds a .png on 897 of 914 stored reports. The
        // button should say what the file is.
        reportUrl,
        reportFormat: /\.pdf(\?|$)/i.test(String(session.report_pdf_url || '')) ? 'pdf' : 'png',
        reportPdfUrl: reportUrl,              // legacy key, same signed value
        lessonPlanUrl,
        hasLessonPlan: !!session.has_lesson_plan,
        photoUrls,

        // bd-fmf24g.10: the report's written part (headline, moments, strength, horizon, the per-section
        // "why" lines) as the bot stored it when it rendered her report; null on a session that has none.
        reportNarrative: narrativeView(session.analysis_data),

        // ── how she was scored ─────────────────────────────────────────────
        overallScore: overallMarks,
        maxScore: maxMarks,
        percentage,
        // The framework-correct breakdown, straight from the bot. Domains are
        // strongest-first with their indicators and evidence quotes attached;
        // null means not scored yet, never "scored zero".
        breakdown,

        // ── her own words ──────────────────────────────────────────────────
        reflection,
        prioritizedAction: session.prioritized_action || null,

        analysisData: {
          overall_score: {
            points: overallMarks,
            max_points: maxMarks,
            percentage
          },
          executive_summary: session.analysis_data?.executive_summary || null,
          strengths: strengthsArray,
          growth_opportunities: growthArray,
          recommendations: recommendationsArray,
          notable_moments: session.analysis_data?.notable_moments || [],
          // `{ status: 'lp_absent' }` when she attached no plan — an honest
          // answer, not a gap. 'ok' on 56% of sessions.
          lp_fidelity: session.analysis_data?.lp_fidelity || null,
          photo_analysis: session.analysis_data?.photo_analysis || null
        }
      }
    });
  } catch (error) {
    console.error('Coaching session detail error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load session details'
    });
  }
});

/* ------------------------------------------------------------------------- *
 * bd-lfzoz — teacher self-observation from the portal.
 *
 * She uploads a classroom recording (and, optionally, her lesson plan and up to
 * three classroom photos) straight to R2, starts the analysis, watches it
 * progress, and answers her reflective question here instead of on WhatsApp.
 *
 * These routes hold NO coaching logic. Every write goes to the bot over the
 * internal API (services/portal-coaching.client.js) because the pipeline's
 * code cannot load in this service; the one read is a plain row read.
 *
 * IDENTITY: the user is ALWAYS req.session.portalUserId. A userId in the body
 * is ignored, never forwarded.
 * ------------------------------------------------------------------------- */

const PortalCoachingClient = require('../services/portal-coaching.client');
// Zero module-scope requires beyond `crypto` — safe for this service to load
// (the paper-marking precedent above). One definition of "is this a portal
// session", shared with the bot, rather than a copied regex.
const { isPortalSession, SHORT_RECORDING_SECONDS } = require('../../bot/shared/services/coaching/portal-coaching.service');

// The pipeline's statuses, collapsed to the handful of stages the page shows.
const PORTAL_COACHING_STAGE = {
  initiated: 'queued', confirmed: 'queued', pending: 'queued',
  transcribing: 'transcribing', transcription_complete: 'transcribing',
  awaiting_photo: 'analysing', awaiting_classroom_photo: 'analysing', awaiting_lesson_plan: 'analysing',
  analyzing: 'analysing', analysis_started: 'analysing', analysis_complete: 'analysing',
  conducting_conversation: 'reflection',
  generating_report: 'report',
  completed: 'done',
  failed: 'stopped', cancelled: 'stopped', abandoned: 'stopped',
};

/**
 * bd-3bvfj — the feature ships dark. Off for this user (no app_settings row, a
 * pilot list without her, or a failed read) → 404, the same answer as a route
 * that does not exist, and the bot is never called. Hiding the button alone
 * would leave the API open to anyone who knew the path.
 */
async function requireSelfObservation(req, res, next) {
  const on = await isFlagEnabledForUser(supabase, PORTAL_SELF_OBSERVATION_KEY, req.session && req.session.portalUserId);
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

/** Relay the bot's answer; a throw (unreachable / 5xx) is a 502, never success. */
async function relayToBot(res, label, call) {
  try {
    const { httpStatus, body } = await call();
    return res.status(httpStatus).json(body);
  } catch (error) {
    console.error(`Portal coaching ${label} failed:`, error.message);
    return res.status(502).json({ success: false, error: 'Could not reach the coaching service. Please try again.' });
  }
}

/**
 * POST /api/portal/coaching-upload/presign
 * Body { filename, sizeBytes, kind? }  kind: 'audio' | 'lesson_plan' | 'photo'
 * → { uploadUrl, key, contentType, expiresIn, maxBytes }. The browser PUTs the
 *   file to uploadUrl with exactly that Content-Type.
 */
router.post('/coaching-upload/presign', requirePortalAuth, requireSelfObservation, (req, res) => {
  const { filename, sizeBytes, kind } = req.body || {};
  return relayToBot(res, 'presign', () => PortalCoachingClient.presignUpload({
    userId: req.session.portalUserId, filename, sizeBytes, kind,
  }));
});

/**
 * bd-5rz1v — the fields of a library lesson-plan pick the bot reads, and no
 * others. The bot validates the shape; this only keeps anything else (a
 * `userId`, say) from riding along to it.
 */
function libraryPlanPick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const k of ['assetId', 'lessonId', 'segmentId', 'lang']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

/**
 * bd-fmf24g.9 — the class she picked in the teacher app: { grade, subject, subjectKey? } and
 * no other field. The bot validates the values (and drops a bad pick without refusing the
 * recording); this only keeps anything else from riding along.
 */
function teacherClassPick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  for (const k of ['grade', 'subject', 'subjectKey']) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

/**
 * POST /api/portal/coaching-upload/start
 * Body { key, lessonPlanKey?, lessonPlan?, photoKeys?, teacherClass? } — keys returned by /presign, uploaded.
 *   teacherClass (bd-fmf24g.9): { grade, subject, subjectKey? } — the class she picked; the bot stores it
 *   lessonPlan: a library pick — { assetId } | { lessonId } | { segmentId, lang }
 * → 200 { coachingSessionId }   409 { status:'in_progress', coachingSessionId }
 *   400 { reason: 'plan_not_found' | 'plan_not_ready' | … }
 */
router.post('/coaching-upload/start', requirePortalAuth, requireSelfObservation, (req, res) => {
  const { key, lessonPlanKey, photoKeys, lessonPlan, teacherClass } = req.body || {};
  return relayToBot(res, 'start', () => PortalCoachingClient.startSession({
    userId: req.session.portalUserId, key, lessonPlanKey, photoKeys, lessonPlan: libraryPlanPick(lessonPlan),
    teacherClass: teacherClassPick(teacherClass),
  }));
});

/**
 * GET /api/portal/coaching-upload/recent-plans  (bd-5rz1v)
 * → { plans: [{ assetId, lessonId, topic, grade, subject, chapterNumber, dayLabel, pagesLabel, downloadedAt }] }
 * The plans the WhatsApp "Recent Lesson Plans" list would offer her.
 */
router.get('/coaching-upload/recent-plans', requirePortalAuth, requireSelfObservation, (req, res) => (
  relayToBot(res, 'recent-plans', () => PortalCoachingClient.recentPlans({ userId: req.session.portalUserId }))
));

/**
 * GET /api/portal/coaching-sessions/active  (bd-5rz1v)
 * → { sessions: [{ id, createdAt, status, stage, source, needsAnswer, topic, subject }] }, OLDEST first.
 *
 * Her lessons still in the pipeline — what the Coaching list shows above the
 * finished ones, and what its "needs your answer" banner walks through, oldest
 * first. `needsAnswer` only for a PORTAL session holding an unanswered question:
 * a WhatsApp session's debrief is in her chat (the progress route's rule).
 *
 * Three days back: the pipeline finishes in minutes and a debrief auto-completes
 * after 12 hours, so anything older is stuck, and the watchdog — not this list —
 * owns stuck sessions.
 */
const ACTIVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const ENDED_STATUSES = ['completed', 'failed', 'cancelled', 'abandoned'];

router.get('/coaching-sessions/active', requirePortalAuth, requireSelfObservation, async (req, res) => {
  try {
    const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    const { data: rows, error } = await supabase
      .from('coaching_sessions')
      .select('id, status, audio_url, conversation_state, created_at, topic:analysis_data->>topic, subject:analysis_data->>subject')
      .eq('user_id', req.session.portalUserId)
      // Her own lessons only: a coach's observation in flight is the coach's.
      .or(TeacherObservation.NOT_AN_OBSERVATION_OR)
      .not('status', 'in', `(${ENDED_STATUSES.join(',')})`)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    const sessions = (rows || []).map((row) => {
      const portal = isPortalSession(row);
      const waiting = ((row.conversation_state && row.conversation_state.questions) || [])
        .some((q) => q && q.question && !q.answer);
      return {
        id: row.id,
        createdAt: row.created_at,
        status: row.status,
        stage: PORTAL_COACHING_STAGE[row.status] || 'analysing',
        source: portal ? 'portal' : 'whatsapp',
        needsAnswer: portal && row.status === 'conducting_conversation' && waiting,
        topic: row.topic || null,
        subject: row.subject || null,
      };
    });
    return res.json({ success: true, sessions });
  } catch (error) {
    console.error('Coaching active sessions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load your lessons' });
  }
});

/**
 * GET /api/portal/coaching-session/:id/progress
 * → { stage, status, reflection: {questionNumber, question} | null, ... }
 *
 * The question is shown only for a PORTAL session at conducting_conversation:
 * a WhatsApp session's debrief is happening in her chat, and answering it here
 * as well would put two answers on one question.
 */
router.get('/coaching-session/:id/progress', requirePortalAuth, requireSelfObservation, async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('coaching_sessions')
      .select('id, user_id, status, audio_url, audio_duration_seconds, has_lesson_plan, classroom_photos, conversation_state, created_at, '
        + 'observation_type, delivery_status:analysis_data->teacher_delivery->>status')
      .eq('id', req.params.id)
      .eq('user_id', req.session.portalUserId)
      .maybeSingle();
    if (error) throw error;
    // Same answer for "not hers", "does not exist" and "a coach's draft".
    if (!row || row.user_id !== req.session.portalUserId || !TeacherObservation.teacherMaySee(row, row.delivery_status)) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const portal = isPortalSession(row);
    // A coach's observation reaches her finished: once sent, it is her report.
    const stage = TeacherObservation.isObservation(row) ? 'done' : (PORTAL_COACHING_STAGE[row.status] || 'analysing');
    let reflection = null;
    if (portal && row.status === 'conducting_conversation') {
      const asked = ((row.conversation_state && row.conversation_state.questions) || [])
        .filter((q) => q && q.question && !q.answer)
        .pop();
      if (asked) reflection = { questionNumber: asked.question_number, question: asked.question };
    }
    const seconds = Number(row.audio_duration_seconds);

    return res.json({
      success: true,
      id: row.id,
      status: row.status,
      stage,
      source: portal ? 'portal' : 'whatsapp',
      reflection,
      reportReady: row.status === 'completed' || stage === 'done',
      // null until transcription has measured it (ffprobe), never a guess.
      shortRecording: Number.isFinite(seconds) && seconds > 0 ? seconds < SHORT_RECORDING_SECONDS : null,
      hasLessonPlan: !!row.has_lesson_plan,
      photoCount: Array.isArray(row.classroom_photos) ? row.classroom_photos.length : 0,
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error('Coaching progress error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load progress' });
  }
});

/**
 * POST /api/portal/coaching-session/:id/reflection
 * Body { answer } → { done, acknowledgement, reportStatus }
 */
router.post('/coaching-session/:id/reflection', requirePortalAuth, requireSelfObservation, (req, res) => {
  const { answer } = req.body || {};
  return relayToBot(res, 'reflection', () => PortalCoachingClient.submitReflection({
    userId: req.session.portalUserId, coachingSessionId: req.params.id, answer,
  }));
});

/* ------------------------------------------------------------------------- *
 * bd-5rz1v.6 — a COACH's /observe observation, run from the portal: record or
 * send the lesson, check the draft report, the talk with the teacher and her own
 * feedback, then send the teacher her report. The bot does all of it with the
 * WhatsApp path's own functions (portal-observe.service); these routes relay.
 *
 * Leader-only (requireLeaderRole), and dark behind
 * app_settings.portal_coach_observation — off for this coach → 404, the same as
 * a route that does not exist, and the bot is never called.
 *
 * IDENTITY: the coach is ALWAYS req.session.portalUserId. A userId in a body or
 * query is ignored, never forwarded.
 * ------------------------------------------------------------------------- */

async function requireCoachObservation(req, res, next) {
  // bd-o15qnr: coach v2's Take observation runs on this pipeline, so either
  // pilot flag opens it (feature-flags.isCoachObservationOn).
  const on = await isCoachObservationOn(supabase, req.session && req.session.portalUserId);
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}
const coachObserve = [requirePortalAuth, requireLeaderRole, requireCoachObservation];
const sessionCoach = (req) => req.session.portalUserId;
const asText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** POST /api/portal/leader/observe-upload/presign  Body { filename, sizeBytes, kind } — signed under the coach's own id. */
router.post('/leader/observe-upload/presign', ...coachObserve, (req, res) => {
  const { filename, sizeBytes, kind } = req.body || {};
  return relayToBot(res, 'observe-presign', () => PortalCoachingClient.presignUpload({
    userId: sessionCoach(req), filename, sizeBytes, kind,
  }));
});

/**
 * POST /api/portal/leader/observe/start
 * Body { teacherExtId, schoolExtId?, key, lessonPlanKey?, lessonPlan?, photoKeys? }
 * → 200 { coachingSessionId }   400 { reason: 'not_your_teacher' | 'plan_not_found' | … }
 */
router.post('/leader/observe/start', ...coachObserve, (req, res) => {
  const { teacherExtId, schoolExtId, key, lessonPlanKey, photoKeys, lessonPlan } = req.body || {};
  return relayToBot(res, 'observe-start', () => PortalCoachingClient.startObservation({
    userId: sessionCoach(req), teacherExtId, schoolExtId, key, lessonPlanKey, photoKeys,
    lessonPlan: libraryPlanPick(lessonPlan),
  }));
});

/** GET /api/portal/leader/observe/recent-plans?teacherExtId=&schoolExtId= — the TEACHER's recent plans. */
router.get('/leader/observe/recent-plans', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-recent-plans', () => PortalCoachingClient.observeRecentPlans({
    userId: sessionCoach(req), teacherExtId: asText(req.query.teacherExtId), schoolExtId: asText(req.query.schoolExtId),
  }))
));

/** GET /api/portal/leader/observe/active — her portal observations, newest first, each with its step. */
router.get('/leader/observe/active', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-list', () => PortalCoachingClient.listObservations({ userId: sessionCoach(req) }))
));

/** GET /api/portal/leader/observe/:id — one observation: its step, the teacher, the talk, the report. */
router.get('/leader/observe/:id', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-view', () => PortalCoachingClient.observationView({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/** GET /api/portal/leader/observe/:id/draft — the draft report's sections (the WhatsApp review form's fields). */
router.get('/leader/observe/:id/draft', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-draft', () => PortalCoachingClient.getObservationDraft({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/** POST /api/portal/leader/observe/:id/draft  Body { edits } — save her changes (the form's r_/ev_/imp_/fid_ keys). */
router.post('/leader/observe/:id/draft', ...coachObserve, (req, res) => {
  const edits = req.body && req.body.edits && typeof req.body.edits === 'object' ? req.body.edits : {};
  return relayToBot(res, 'observe-draft-save', () => PortalCoachingClient.saveObservationDraft({
    userId: sessionCoach(req), coachingSessionId: req.params.id, edits,
  }));
});

/** POST /api/portal/leader/observe/:id/talk/guide — the guide for her talk with the teacher. */
router.post('/leader/observe/:id/talk/guide', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-talk-guide', () => PortalCoachingClient.observationTalkGuide({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/** POST /api/portal/leader/observe/:id/talk  Body { key } — the talk she recorded, uploaded by /observe-upload. */
router.post('/leader/observe/:id/talk', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-talk', () => PortalCoachingClient.startObservationTalk({
    userId: sessionCoach(req), coachingSessionId: req.params.id, key: req.body && req.body.key,
  }))
));

/** POST /api/portal/leader/observe/:id/talk/retry — the same talk again, after a failure. */
router.post('/leader/observe/:id/talk/retry', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-talk-retry', () => PortalCoachingClient.retryObservationTalk({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/** POST /api/portal/leader/observe/:id/report/preview — make the teacher's report for her to check. */
router.post('/leader/observe/:id/report/preview', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-report-preview', () => PortalCoachingClient.previewObservationReport({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/** POST /api/portal/leader/observe/:id/report/send — send it to the teacher's WhatsApp. */
router.post('/leader/observe/:id/report/send', ...coachObserve, (req, res) => (
  relayToBot(res, 'observe-report-send', () => PortalCoachingClient.sendObservationReport({
    userId: sessionCoach(req), coachingSessionId: req.params.id,
  }))
));

/**
 * GET /api/portal/coaching-analytics
 * Get coaching score trends over time
 */
router.get('/coaching-analytics', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    // Get all completed coaching sessions with analysis
    const { data: sessions, error } = await supabase
      .from('coaching_sessions')
      .select('id, created_at, analysis_data')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('analysis_data', 'is', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    if (!sessions || sessions.length === 0) {
      return res.json({
        success: true,
        analytics: {
          overallScoreTrend: [],
          goalAreaBreakdown: [],
          insights: {
            totalSessions: 0,
            averageScore: 0,
            improvement: 0,
            bestGoalArea: null,
            focusArea: null
          }
        }
      });
    }

    // Build overall score trend.
    //
    // getOverall normalises every framework's score shape; this route used to
    // read `scores.percentage`, which appears in 0 of 500 sampled production
    // sessions, so the trend line has been flat at zero.
    const overallScoreTrend = sessions.map((session) => {
      const o = getOverall(session.analysis_data);
      return {
        date: session.created_at,
        score: o.points,
        percentage: o.percentage,
      };
    });

    // Domain breakdown, AVERAGED ACROSS SESSIONS.
    //
    // This used to read six OECD goal totals off the LATEST session only —
    // fields a FICO session does not have, so the chart was six zeros, and
    // "best area" / "focus area" were chosen by sorting them. Two defects at
    // once: the wrong framework, and one session presented as a trend.
    //
    // Now: ask the bot for each session's framework-correct breakdown and
    // average each domain's percentage over every session that scored it. A
    // teacher's focus area should be where she is consistently weakest, not
    // where she happened to dip last lesson.
    const perDomain = new Map();
    const breakdowns = await Promise.all(
      sessions.map((session) => CoachingBreakdown
        .breakdown(session.analysis_data, 'en')
        .catch(() => null)),
    );
    breakdowns.filter(Boolean).forEach((b) => {
      (b.groups || []).forEach((g) => {
        if (!g || typeof g.pct !== 'number') return;
        const row = perDomain.get(g.domainKey) || { name: g.name, key: g.key, pcts: [], score: 0, max: 0 };
        row.pcts.push(g.pct);
        row.score += Number(g.score) || 0;
        row.max += Number(g.max) || 0;
        perDomain.set(g.domainKey, row);
      });
    });

    const goalAreaBreakdown = [...perDomain.values()].map((row) => ({
      name: row.name,
      score: row.score,
      maxScore: row.max,
      // The mean of the per-session percentages, so one long lesson does not
      // outweigh three short ones.
      percentage: Math.round((row.pcts.reduce((a, c) => a + c, 0) / row.pcts.length) * 10) / 10,
      sessions: row.pcts.length,
    })).sort((a, b) => b.percentage - a.percentage);

    // Calculate insights
    const totalSessions = sessions.length;
    // Average the PERCENTAGE, not raw marks: FICO's denominator varies by
    // subject (42 / 44 / 38), so averaging marks compares different scales.
    const scored = overallScoreTrend.filter((s2) => typeof s2.percentage === 'number');
    const averageScore = scored.length
      ? Math.round((scored.reduce((sum, s2) => sum + s2.percentage, 0) / scored.length) * 10) / 10
      : 0;
    const firstScore = scored[0]?.percentage || 0;
    const lastScore = scored[scored.length - 1]?.percentage || 0;
    const improvement = Math.round((lastScore - firstScore) * 10) / 10;

    // Strongest and weakest, across her whole history.
    //
    // Ranked only over domains seen in a MAJORITY of her scored sessions. A
    // teacher's sessions are not always scored on the same vocabulary — 17 of
    // 172 on the corpus use a five-domain shape — so a domain that appears
    // once can top the table on a single lesson and read as "your strongest
    // area", which is a claim one data point cannot support. The chart below
    // still shows every domain with its own n.
    //
    // Null rather than a guess when nothing qualifies.
    const seenIn = (d) => d.sessions || 0;
    const ranked = goalAreaBreakdown.filter((d) => seenIn(d) * 2 >= totalSessions);
    const forRanking = ranked.length >= 2 ? ranked : goalAreaBreakdown;
    const bestGoalArea = forRanking[0]?.name || null;
    const focusArea = forRanking.length > 1
      ? forRanking[forRanking.length - 1].name
      : null;

    res.json({
      success: true,
      analytics: {
        overallScoreTrend,
        goalAreaBreakdown,
        insights: {
          totalSessions,
          averageScore: Math.round(averageScore * 10) / 10,
          improvement: Math.round(improvement * 10) / 10,
          bestGoalArea,
          focusArea
        }
      }
    });
  } catch (error) {
    console.error('Coaching analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load analytics'
    });
  }
});

// ============================================================================
// READING ASSESSMENT ENDPOINTS
// ============================================================================

/**
 * Helper function: Extract mispronunciations from pronunciation_data JSONB
 * Handles both Azure (English) and GPT-4o (Urdu/Arabic/Spanish) formats
 */
function extractMispronunciations(pronunciationData, language) {
  if (!pronunciationData) return [];

  if (language === 'en' && pronunciationData.words) {
    // Azure format for English
    return pronunciationData.words
      .filter(w => w.errorType === 'Mispronunciation')
      .map(w => ({
        word: w.word,
        expectedPhonemes: w.phonemes?.map(p => `/${p.phoneme}/`) || [],
        actualIssue: 'Mispronunciation detected',
        guidance: `Practice the correct pronunciation of "${w.word}"`
      }));
  } else if (pronunciationData.mispronounced_words) {
    // GPT-4o format for Urdu/Arabic/Spanish
    return pronunciationData.mispronounced_words.map(w => ({
      word: w.word,
      expectedPhonemes: [],
      actualIssue: w.description || 'Mispronunciation detected',
      guidance: w.guidance || 'Practice this word carefully'
    }));
  }

  return [];
}

/**
 * Helper function: Count correct answers from comprehension_answers JSONB
 */
function countCorrectAnswers(answers) {
  if (!answers || !Array.isArray(answers)) return 0;
  return answers.filter(a => a.correct === true).length;
}

/**
 * Helper function: Merge questions and answers arrays for display
 */
function mergeQuestionsAndAnswers(questions, answers) {
  if (!questions || !Array.isArray(questions)) return [];

  return questions.map((q, index) => {
    const answer = answers && answers[index] ? answers[index] : {};
    return {
      id: index + 1,
      question: q.question,
      studentAnswer: answer.transcribed_answer || answer.answer || '',
      expectedAnswer: q.expected_answer || q.acceptable_variations?.join(' / ') || '',
      isCorrect: answer.correct || false
    };
  });
}

/**
 * GET /api/portal/reading-assessments
 * Get paginated list of all reading assessments for authenticated teacher
 * Supports filters: language, grade, type (passage type)
 */
router.get('/reading-assessments', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Max 100 per page
    const offset = (page - 1) * limit;

    // Optional filters
    const languageFilter = req.query.language; // 'en', 'ur', 'ar', 'es'
    const gradeFilter = req.query.grade ? parseInt(req.query.grade) : null; // 0-5
    const typeFilter = req.query.type; // 'letters', 'words', 'sentences', 'paragraph', 'story'

    // Build query
    let query = supabase
      .from('reading_assessments')
      .select('id, student_identifier, grade_level, language, passage_type, wcpm, accuracy_percentage, comprehension_requested, comprehension_score, report_pdf_url, voice_feedback_url, created_at, completed_at', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (languageFilter) {
      query = query.eq('language', languageFilter);
    }
    if (gradeFilter !== null) {
      query = query.eq('grade_level', gradeFilter);
    }
    if (typeFilter) {
      query = query.eq('passage_type', typeFilter);
    }

    const { data: assessments, error, count } = await query;

    if (error) {
      throw error;
    }

    // Transform to frontend schema
    const transformedAssessments = (assessments || []).map(a => ({
      id: a.id,
      studentName: a.student_identifier,
      gradeLevel: a.grade_level,
      language: a.language,
      passageType: a.passage_type,
      assessmentDate: a.created_at,
      completedAt: a.completed_at,
      fluency: {
        wcpm: a.wcpm || 0,
        accuracy: a.accuracy_percentage || 0,
        comprehensionScore: a.comprehension_score || null,
        hasComprehension: a.comprehension_requested || false
      },
      hasPdfReport: !!a.report_pdf_url,
      reportPdfUrl: a.report_pdf_url,
      hasVoiceFeedback: !!a.voice_feedback_url,
      voiceFeedbackUrl: a.voice_feedback_url
    }));

    res.json({
      success: true,
      assessments: transformedAssessments,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Reading assessments list error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load reading assessments'
    });
  }
});

/**
 * GET /api/portal/reading-assessment/:id
 * Get complete details for a single reading assessment
 * Includes: fluency, pronunciation, prosody, comprehension, passage, audio, outputs
 */
router.get('/reading-assessment/:id', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const assessmentId = req.params.id;

    const { data: assessment, error } = await supabase
      .from('reading_assessments')
      .select('*')
      .eq('id', assessmentId)
      .eq('user_id', userId) // Security: ensure user owns this assessment
      .single();

    if (error || !assessment) {
      return res.status(404).json({
        success: false,
        error: 'Assessment not found'
      });
    }

    // Extract JSONB data with null safety
    const pronunciationData = assessment.pronunciation_data || {};
    const prosodyData = assessment.prosody_analysis || {};
    const errors = assessment.errors || [];
    const questions = assessment.comprehension_questions || [];
    const answers = assessment.comprehension_answers || [];

    // Build comprehensive response
    const transformedAssessment = {
      id: assessment.id,
      studentName: assessment.student_identifier,
      gradeLevel: assessment.grade_level,
      language: assessment.language,
      passageType: assessment.passage_type,
      assessmentDate: assessment.created_at,
      completedAt: assessment.completed_at,

      passage: {
        text: assessment.passage_text,
        imageUrl: assessment.passage_image_url,
        wordCount: assessment.passage_word_count
      },

      audio: {
        url: assessment.audio_url,
        duration: assessment.audio_duration_seconds,
        transcript: assessment.transcript_text
      },

      fluency: {
        wcpm: assessment.wcpm || 0,
        accuracy: assessment.accuracy_percentage || 0,
        wordsRead: assessment.words_read || 0,
        wordsCorrect: assessment.words_correct || 0,
        timeElapsed: assessment.time_elapsed_seconds || 0,
        percentileRank: assessment.percentile_rank,
        onTrack: assessment.on_track,
        benchmarkStatus: assessment.benchmark_status || 'unknown',
        errors: errors,
        selfCorrections: assessment.self_corrections_count || 0
      },

      pronunciation: {
        accuracyScore: pronunciationData.accuracyScore || null,
        fluencyScore: pronunciationData.fluencyScore || null,
        prosodyScore: pronunciationData.prosodyScore || null,
        completenessScore: pronunciationData.completenessScore || null,
        mispronunciations: extractMispronunciations(pronunciationData, assessment.language)
      },

      prosody: {
        pacing: prosodyData.pacing || null,
        expression: prosodyData.expression || null,
        fluencyLevel: prosodyData.fluency_level || null,
        hesitationCount: prosodyData.hesitations?.count || 0,
        notes: prosodyData.notes || null
      },

      comprehension: assessment.comprehension_requested ? {
        requested: true,
        score: assessment.comprehension_score || 0,
        questionsAsked: questions.length,
        questionsCorrect: countCorrectAnswers(answers),
        questions: mergeQuestionsAndAnswers(questions, answers)
      } : null,

      diagnosticSummary: assessment.diagnostic_summary,

      outputs: {
        reportPdfUrl: assessment.report_pdf_url,
        voiceFeedbackUrl: assessment.voice_feedback_url,
        voiceFeedbackDuration: assessment.voice_feedback_duration_seconds
      }
    };

    res.json({
      success: true,
      assessment: transformedAssessment
    });
  } catch (error) {
    console.error('Reading assessment detail error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load assessment details'
    });
  }
});

/**
 * GET /api/portal/reading-assessment/:id/pdf
 * Proxy endpoint to serve PDF with authentication
 * Fetches from private R2 storage and streams to browser
 */
router.get('/reading-assessment/:id/pdf', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const assessmentId = req.params.id;

    // Verify user owns this assessment
    const { data: assessment, error } = await supabase
      .from('reading_assessments')
      .select('report_pdf_url, student_identifier, created_at')
      .eq('id', assessmentId)
      .eq('user_id', userId)
      .single();

    if (error || !assessment?.report_pdf_url) {
      return res.status(404).json({
        success: false,
        error: 'PDF not found or access denied'
      });
    }

    // Extract key from R2 URL
    // URL format: https://{account_id}.r2.cloudflarestorage.com/{bucket}/{key}
    const urlParts = new URL(assessment.report_pdf_url);
    const pathParts = urlParts.pathname.split('/').filter(p => p);
    // First part is bucket name, rest is the key
    const key = pathParts.slice(1).join('/'); // Skip bucket name, get the key

    // Fetch PDF from R2 using authenticated S3 client
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });

    const response = await getR2Client().send(command);

    // Generate filename from assessment data
    const dateStr = new Date(assessment.created_at).toISOString().split('T')[0];
    const filename = `Reading_Assessment_${assessment.student_identifier}_${dateStr}.pdf`;

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream PDF to response
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    res.send(buffer);

  } catch (error) {
    console.error('PDF proxy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load PDF'
    });
  }
});

/**
 * GET /api/portal/reading-stats
 * Get summary statistics for dashboard widget
 * Returns: total assessments, averages, most recent assessment
 */
router.get('/reading-stats', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    // Get all completed assessments (we need full data for averages)
    const { data: assessments, error } = await supabase
      .from('reading_assessments')
      .select('wcpm, accuracy_percentage, student_identifier, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (error) {
      throw error;
    }

    const totalAssessments = assessments?.length || 0;

    // If no assessments, return zeros
    if (totalAssessments === 0) {
      return res.json({
        success: true,
        stats: {
          totalAssessments: 0,
          averageWcpm: 0,
          averageAccuracy: 0,
          studentsAssessed: 0,
          mostRecentAssessment: null
        }
      });
    }

    // Calculate averages
    const averageWcpm = assessments.reduce((sum, a) => sum + (a.wcpm || 0), 0) / totalAssessments;
    const averageAccuracy = assessments.reduce((sum, a) => sum + (a.accuracy_percentage || 0), 0) / totalAssessments;

    // Count unique students
    const uniqueStudents = new Set(assessments.map(a => a.student_identifier)).size;

    // Get most recent
    const sortedByDate = [...assessments].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const mostRecent = sortedByDate[0];

    res.json({
      success: true,
      stats: {
        totalAssessments,
        averageWcpm: Math.round(averageWcpm * 10) / 10,
        averageAccuracy: Math.round(averageAccuracy * 10) / 10,
        studentsAssessed: uniqueStudents,
        mostRecentAssessment: mostRecent ? {
          studentName: mostRecent.student_identifier,
          date: mostRecent.created_at,
          wcpm: mostRecent.wcpm || 0,
          accuracy: mostRecent.accuracy_percentage || 0
        } : null
      }
    });
  } catch (error) {
    console.error('Reading stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load reading stats'
    });
  }
});

/**
 * GET /api/portal/reading-analytics
 * Get historical trends over time for charts
 * Optional query param: studentName (filter by specific student)
 * Returns: WCPM trend, accuracy trend, comprehension trend
 */
router.get('/reading-analytics', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const studentNameFilter = req.query.studentName; // Optional filter

    // Build query
    let query = supabase
      .from('reading_assessments')
      .select('id, student_identifier, created_at, wcpm, accuracy_percentage, comprehension_score')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true });

    // Apply student filter if provided
    if (studentNameFilter) {
      query = query.eq('student_identifier', studentNameFilter);
    }

    const { data: assessments, error } = await query;

    if (error) {
      throw error;
    }

    // If no assessments, return empty arrays
    if (!assessments || assessments.length === 0) {
      return res.json({
        success: true,
        analytics: {
          wcpmTrend: [],
          accuracyTrend: [],
          comprehensionTrend: []
        }
      });
    }

    // Build trend arrays
    const wcpmTrend = assessments.map(a => ({
      date: a.created_at,
      wcpm: a.wcpm || 0,
      studentName: a.student_identifier
    }));

    const accuracyTrend = assessments.map(a => ({
      date: a.created_at,
      accuracy: a.accuracy_percentage || 0,
      studentName: a.student_identifier
    }));

    // Only include comprehension if score exists
    const comprehensionTrend = assessments
      .filter(a => a.comprehension_score !== null)
      .map(a => ({
        date: a.created_at,
        score: a.comprehension_score || 0,
        studentName: a.student_identifier
      }));

    res.json({
      success: true,
      analytics: {
        wcpmTrend,
        accuracyTrend,
        comprehensionTrend
      }
    });
  } catch (error) {
    console.error('Reading analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load reading analytics'
    });
  }
});

// ============================================================================
// VIDEO ENDPOINTS (Issue #7)
// ============================================================================

/**
 * GET /api/portal/videos
 * Get paginated list of all videos for authenticated user
 * Issue #20, #25: Generate presigned URLs for thumbnails and videos
 */
router.get('/videos', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { data: videos, error, count } = await supabase
      .from('video_requests')
      .select('id, topic, language, status, video_url, pdf_url, slide_urls, created_at, completed_at, generation_time_seconds', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    // Issue #20: Generate presigned URLs for thumbnails (first slide)
    const videosWithPresignedUrls = await Promise.all(
      (videos || []).map(async (video) => {
        let thumbnailUrl = null;
        if (video.slide_urls && video.slide_urls.length > 0) {
          const firstSlide = video.slide_urls[0];
          if (typeof firstSlide === 'string' && isValidR2Url(firstSlide)) {
            thumbnailUrl = await generatePresignedUrl(firstSlide, 3600);
          } else {
            thumbnailUrl = firstSlide; // Keep original if not R2 URL
          }
        }
        return {
          ...video,
          thumbnailUrl
        };
      })
    );

    res.json({
      success: true,
      videos: videosWithPresignedUrls,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Videos list error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load videos'
    });
  }
});

/**
 * GET /api/portal/video/:id
 * Get detailed video information
 * Issue #18, #20, #25, #26: Generate presigned URLs for all R2 content
 */
router.get('/video/:id', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;
    const videoId = req.params.id;

    const { data: video, error } = await supabase
      .from('video_requests')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId) // Security: ensure user owns this video
      .single();

    if (error || !video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    // Issue #25, #26: Generate presigned URL for video
    let presignedVideoUrl = null;
    if (video.video_url && isValidR2Url(video.video_url)) {
      presignedVideoUrl = await generatePresignedUrl(video.video_url, 3600);
    } else if (video.video_url) {
      // Issue #21: Log warning for invalid URLs (local paths)
      console.warn(`⚠️ Video ${videoId} has invalid video_url: ${video.video_url}`);
    }

    // Issue #18: Generate presigned URL for PDF
    let presignedPdfUrl = null;
    if (video.pdf_url && isValidR2Url(video.pdf_url)) {
      presignedPdfUrl = await generatePresignedUrl(video.pdf_url, 3600);
    }

    // Issue #20: Generate presigned URLs for all slide images
    const presignedSlideUrls = await generatePresignedUrls(video.slide_urls || [], 3600);

    // Get thumbnail from first presigned slide URL
    const thumbnailUrl = presignedSlideUrls.length > 0 ? presignedSlideUrls[0] : null;

    res.json({
      success: true,
      video: {
        id: video.id,
        topic: video.topic,
        language: video.language,
        status: video.status,
        video_url: presignedVideoUrl,
        pdf_url: presignedPdfUrl,
        slide_urls: presignedSlideUrls,
        script_data: video.script_data,
        current_step: video.current_step,
        error_message: video.error_message,
        thumbnailUrl: thumbnailUrl,
        created_at: video.created_at,
        completed_at: video.completed_at,
        generation_time_seconds: video.generation_time_seconds
      }
    });
  } catch (error) {
    console.error('Video detail error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load video details'
    });
  }
});

/**
 * GET /api/portal/config
 *
 * What this deployment currently offers, so the browser can render an
 * honest surface instead of a form that would 503 on submit. Public (no auth):
 * it exposes nothing but feature availability, and the login screen may need it.
 *
 * Availability is fail-closed and shared with the bot through one app_settings
 * row, so the portal and WhatsApp can never disagree about whether a feature is
 * live. The message ships with the flag so both surfaces read identically.
 */
/**
 * GET /me/language — what did she actually choose?
 *
 * The portal's i18n detection order was ['localStorage','navigator','htmlTag']: it
 * guessed from the BROWSER and never asked. So an Urdu-preferring teacher on an
 * English-locale phone got an English portal, permanently, while every WhatsApp
 * message arrived in Urdu.
 *
 * Clamped on the way out: a row written before the writer was hardened could still
 * hold an off-market code, and the portal has no bundle for one — it would fall
 * back to English silently rather than telling anyone.
 */
router.get('/me/language', requirePortalAuth, async (req, res) => {
  try {
    const { clampLanguage } = require('../../bot/shared/config/ux-strings');
    const { data, error } = await supabase
      .from('users')
      .select('preferred_language, language_locked')
      .eq('id', req.session.portalUserId)
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      language: clampLanguage(data?.preferred_language),
      locked: data?.language_locked === true,
    });
  } catch (error) {
    console.error('portal/me/language read error:', error.message);
    // Fail to the floor rather than 500 — the portal must still render.
    return res.json({ success: true, language: 'en', locked: false });
  }
});

/**
 * PUT /me/language — the switcher becomes a real mutator.
 *
 * It used to call i18n.changeLanguage() and nothing else: a device-local cosmetic,
 * so switching here never reached the bot and her next WhatsApp reply came back in
 * the old language.
 *
 * WRITTEN THROUGH THE ONE WRITER, deliberately. The tempting shortcut in this file
 * is a direct users.update({ preferred_language }) — this service already has a
 * supabase client. That would be a SECOND writer, which is precisely the defect
 * Phase 1 existed to remove: a direct column write sets no lock and invalidates
 * neither Redis key, so the 24-hour cache keeps serving the old language and a
 * later classroom recording can overwrite her choice.
 *
 * Locked, because choosing in the portal is as explicit as choosing in Settings.
 */
router.put('/me/language', requirePortalAuth, async (req, res) => {
  try {
    // Over the internal API, not by requiring language-cache in-process. That module
    // reaches bot/shared/config/supabase.js and its `require('dotenv')`, which the portal
    // service cannot resolve from inside bot/ (see training-bands.service.js). The route looked
    // fine and would have 500'd the first time a teacher changed her language.
    //
    // The "one writer" promise above is UNCHANGED and is in fact why this goes to the bot:
    // setUserLanguage is still the only thing that writes the column, sets the lock and
    // invalidates both Redis keys.
    const requested = (req.body && req.body.language) || '';
    const out = await TrainingBands.setLanguage(req.session.portalUserId, requested);

    // Rejected, not clamped. A clamp would silently store English when she asked for something
    // else; on an explicit choice she deserves to be told — and told what IS on offer.
    if (out.rejected) {
      return res.status(400).json({
        success: false,
        error: 'That language is not available.',
        offered: out.offered || [],
      });
    }
    if (!out.applied) {
      return res.status(500).json({ success: false, error: 'Could not save your language.' });
    }

    return res.json({ success: true, language: requested, locked: true });
  } catch (error) {
    console.error('portal/me/language write error:', error.message);
    return res.status(500).json({ success: false, error: 'Could not save your language.' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const userId = req.session && req.session.portalUserId;
    // bd-fxk3t8: the reads are independent, so they run together. One after
    // another they took 1.8–4.9 s on sandbox, and every v2 page waits on this.
    const [
      assessmentGenerator,
      assessmentEditing,
      selfObservation,
      coachObservation,
      newUi,
      coachV2,
      teacherV2,
    ] = await Promise.all([
      isAssessmentGeneratorEnabled(supabase),
      isPortalAssessmentEditingEnabled(supabase),
      // bd-3bvfj: per USER — a pilot list is answered for whoever is logged in;
      // logged out, it is off. Read from the session, never from the request.
      isFlagEnabledForUser(supabase, PORTAL_SELF_OBSERVATION_KEY, userId),
      // bd-5rz1v.6: per USER too — the coach's portal observation pilot.
      isFlagEnabledForUser(supabase, PORTAL_COACH_OBSERVATION_KEY, userId),
      // bd-5rz1v.12: the new UI, per user — designed screen by screen behind it.
      isFlagEnabledForUser(supabase, PORTAL_NEW_UI_KEY, userId),
      // bd-o15qnr: the coach app v2, per user. The portal shows it to role=coach only.
      isFlagEnabledForUser(supabase, PORTAL_COACH_V2_KEY, userId),
      // bd-fmf24g.1: the teacher app v2, per user. The portal shows it to teachers only.
      isFlagEnabledForUser(supabase, PORTAL_TEACHER_V2_KEY, userId),
    ]);
    return res.json({
      success: true,
      features: {
        assessmentGenerator,
        assessmentEditing,
        assessmentGeneratorMessage: assessmentGenerator ? null : ASSESSMENT_GENERATOR_OFF_MESSAGE,
        selfObservation,
        coachObservation,
        newUi,
        coachV2,
        teacherV2,
      },
    });
  } catch (error) {
    console.error('portal/config error:', error);
    // Fail closed here too — a broken config read must not imply "everything on".
    return res.json({
      success: true,
      features: {
        assessmentGenerator: false,
        assessmentEditing: false,
        assessmentGeneratorMessage: ASSESSMENT_GENERATOR_OFF_MESSAGE,
        selfObservation: false,
        coachObservation: false,
        newUi: false,
        coachV2: false,
        teacherV2: false,
      },
    });
  }
});

// Exported for tests only (an express Router is a function; attaching a
// property to it does not affect mounting). Keeps the media-URL contract —
// presign-vs-passthrough and the signed disposition options — testable
// without standing up the whole endpoint.
router._resolveMediaUrl = _resolveMediaUrl;

module.exports = router;
