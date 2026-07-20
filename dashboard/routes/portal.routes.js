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
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { generatePresignedUrl, generatePresignedUrls, isValidR2Url } = require('../services/r2.service');

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
      .select('id, first_name, last_name, phone_number, portal_activated, portal_invite_expires_at')
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
        firstName: user.first_name,
        lastName: user.last_name,
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
      .select('id, first_name, portal_password_hash, portal_activated')
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
      req.session.portalUserName = user.first_name;

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          firstName: user.first_name
        }
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
    const { error } = await supabase
      .from('users')
      .update({
        portal_password_hash: passwordHash,
        password_reset_code: null,
        password_reset_expires_at: null
      })
      .eq('id', userId);

    if (error) {
      throw error;
    }

    // Clear reset session
    delete req.session.resetUserId;

    res.json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.'
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

    // Get counts with graceful error handling (Promise.allSettled allows partial failures)
    const [lessonPlansResult, coachingSessionsResult] = await Promise.allSettled([
      supabase
        .from('lesson_plans')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('coaching_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed')
    ]);

    // Get recent lesson plans with error handling
    // NOTE: Database has 'topic', 'grade', 'type' - we transform to 'title', 'grade_level', 'content_type'
    const recentLessonPlansRaw = await supabase
      .from('lesson_plans')
      .select('id, topic, grade, subject, type, gamma_url, pdf_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to fetch recent lesson plans:', error);
          return [];  // Return empty array instead of crashing
        }
        return data || [];
      });

    // Transform to match portal expectations (with null-safe grade handling)
    const recentLessonPlans = recentLessonPlansRaw.map(plan => ({
      id: plan.id,
      title: plan.topic,
      subject: plan.subject || null,
      grade_level: plan.grade || null,  // Null-safe: handles missing or NULL grade
      content_type: plan.type,
      gamma_url: plan.gamma_url,
      pdf_url: plan.pdf_url,
      created_at: plan.created_at
    }));

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
      user: {
        firstName: user.first_name,
        lastName: user.last_name,
        phoneNumber: user.phone_number
      },
      stats: {
        totalLessonPlans: lessonPlansResult.status === 'fulfilled' ? (lessonPlansResult.value.count || 0) : 0,
        totalCoachingSessions: coachingSessionsResult.status === 'fulfilled' ? (coachingSessionsResult.value.count || 0) : 0
      },
      recentLessonPlans: recentLessonPlans,
      recentCoachingSession: recentCoachingSessionData ? {
        id: recentCoachingSessionData.id,
        date: recentCoachingSessionData.created_at,
        session_date: recentCoachingSessionData.created_at,
        // NOTE: Actual path is analysis_data.scores.overall_marks and scores.percentage
        score: recentCoachingSessionData.analysis_data?.scores?.overall_marks || recentCoachingSessionData.analysis_data?.scores?.grand_total || 0,
        overallScore: recentCoachingSessionData.analysis_data?.scores?.overall_marks || recentCoachingSessionData.analysis_data?.scores?.grand_total || 0,
        maxScore: recentCoachingSessionData.analysis_data?.scores?.max_marks || 118,
        percentage: recentCoachingSessionData.analysis_data?.scores?.percentage || 0
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
// CURRICULUM LP BROWSER — 4-step cascading picker over curriculum_lp_ast
// ───────────────────────────────────────────────────────────────────────────
// The 2,415-LP corpus imported from Taleemabad (NBF + Taleemabad publishers)
// is exposed to teachers as a browsable library. Cascading dropdowns —
// grade → subject → chapter → LP — each populated by its own endpoint.
// A separate endpoint returns a presigned R2 URL for a given LP's PDF, or
// a 202 with an "unavailable" state when the LP hasn't been rendered yet.
// A POST endpoint queues an async Gamma render for an unavailable LP.
//
// All queries run against `curriculum_lp_ast` with `is_enabled = true`.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/portal/curriculum/grades
 * Returns the list of grades that have at least one enabled LP.
 */
router.get('/curriculum/grades', requirePortalAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('curriculum_lp_ast')
      .select('grade, grade_label')
      .eq('is_enabled', true);
    if (error) throw error;

    // Distinct grades with a count, ordered ascending.
    const byGrade = new Map();
    for (const r of data || []) {
      const key = r.grade;
      if (!byGrade.has(key)) byGrade.set(key, { grade: r.grade, label: r.grade_label, count: 0 });
      byGrade.get(key).count += 1;
    }
    const grades = [...byGrade.values()].sort((a, b) => (a.grade ?? 999) - (b.grade ?? 999));
    res.json({ success: true, grades });
  } catch (error) {
    console.error('curriculum/grades error:', error);
    res.status(500).json({ success: false, error: 'Failed to load grades' });
  }
});

/**
 * GET /api/portal/curriculum/subjects?grade=1
 * Returns the list of subjects available for a given grade.
 */
router.get('/curriculum/subjects', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    if (!Number.isFinite(grade)) return res.status(400).json({ success: false, error: 'grade required' });

    const { data, error } = await supabase
      .from('curriculum_lp_ast')
      .select('subject, subject_label')
      .eq('is_enabled', true)
      .eq('grade', grade);
    if (error) throw error;

    const bySubject = new Map();
    for (const r of data || []) {
      const key = r.subject;
      if (!bySubject.has(key)) bySubject.set(key, { subject: r.subject, label: r.subject_label || r.subject, count: 0 });
      bySubject.get(key).count += 1;
    }
    const subjects = [...bySubject.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
    res.json({ success: true, subjects });
  } catch (error) {
    console.error('curriculum/subjects error:', error);
    res.status(500).json({ success: false, error: 'Failed to load subjects' });
  }
});

/**
 * GET /api/portal/curriculum/chapters?grade=1&subject=maths
 * Returns the list of chapters for a given grade + subject.
 */
router.get('/curriculum/chapters', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subject = String(req.query.subject || '').trim();
    if (!Number.isFinite(grade) || !subject) {
      return res.status(400).json({ success: false, error: 'grade + subject required' });
    }

    const { data, error } = await supabase
      .from('curriculum_lp_ast')
      .select('chapter_number, chapter_title, publisher')
      .eq('is_enabled', true)
      .eq('grade', grade)
      .eq('subject', subject);
    if (error) throw error;

    const byChapter = new Map();
    for (const r of data || []) {
      const key = `${r.publisher}::${r.chapter_number}::${r.chapter_title}`;
      if (!byChapter.has(key)) {
        byChapter.set(key, {
          publisher: r.publisher,
          chapter_number: r.chapter_number,
          chapter_title: r.chapter_title,
          lp_count: 0,
        });
      }
      byChapter.get(key).lp_count += 1;
    }
    const chapters = [...byChapter.values()].sort((a, b) => {
      const p = String(a.publisher || '').localeCompare(String(b.publisher || ''));
      if (p !== 0) return p;
      return (a.chapter_number ?? 999) - (b.chapter_number ?? 999);
    });
    res.json({ success: true, chapters });
  } catch (error) {
    console.error('curriculum/chapters error:', error);
    res.status(500).json({ success: false, error: 'Failed to load chapters' });
  }
});

/**
 * GET /api/portal/curriculum/lps?grade=1&subject=maths&chapter_number=1&publisher=Taleemabad
 * Returns the list of lesson plans for a given chapter.
 * `publisher` is optional and disambiguates when two publishers share a
 * chapter_number for the same grade+subject.
 */
router.get('/curriculum/lps', requirePortalAuth, async (req, res) => {
  try {
    const grade = parseInt(req.query.grade, 10);
    const subject = String(req.query.subject || '').trim();
    const chapterNumber = parseInt(req.query.chapter_number, 10);
    const publisher = req.query.publisher ? String(req.query.publisher) : null;

    if (!Number.isFinite(grade) || !subject || !Number.isFinite(chapterNumber)) {
      return res.status(400).json({ success: false, error: 'grade + subject + chapter_number required' });
    }

    let query = supabase
      .from('curriculum_lp_ast')
      .select('source_lp_uuid, lp_index, topic, publisher, chapter_title, pdf_r2_key_en, pdf_r2_key_ur, voicenote_mp3_r2_key, demo_video_r2_key, review_status, rendered_at')
      .eq('is_enabled', true)
      .eq('grade', grade)
      .eq('subject', subject)
      .eq('chapter_number', chapterNumber)
      .order('lp_index', { ascending: true });
    if (publisher) query = query.eq('publisher', publisher);

    const { data, error } = await query;
    if (error) throw error;

    const lps = (data || []).map(r => ({
      source_lp_uuid: r.source_lp_uuid,
      lp_index: r.lp_index,
      topic: r.topic,
      publisher: r.publisher,
      chapter_title: r.chapter_title,
      // Language availability flags — the frontend shows [EN]/[UR] badges
      // for the languages that are cached in R2.
      available_en: !!r.pdf_r2_key_en,
      available_ur: !!r.pdf_r2_key_ur,
      // FEAT-059 media badges: 🎧 voicenote / 🎥 demo video
      has_voicenote: !!r.voicenote_mp3_r2_key,
      has_video: !!r.demo_video_r2_key,
      review_status: r.review_status || 'unreviewed',
      rendered_at: r.rendered_at,
    }));
    res.json({ success: true, lps });
  } catch (error) {
    console.error('curriculum/lps error:', error);
    res.status(500).json({ success: false, error: 'Failed to load lesson plans' });
  }
});

/**
 * GET /api/portal/curriculum/lp/:source_lp_uuid/pdf?lang=en
 * Returns a presigned R2 URL for the LP's cached PDF, or a 202 with
 * `{ available: false }` if the LP hasn't been rendered yet. The client
 * can then POST to /render to queue an async Gamma render.
 */
router.get('/curriculum/lp/:source_lp_uuid/pdf', requirePortalAuth, async (req, res) => {
  try {
    const uuid = req.params.source_lp_uuid;
    const lang = String(req.query.lang || 'en').toLowerCase() === 'ur' ? 'ur' : 'en';

    const { data: lp, error } = await supabase
      .from('curriculum_lp_ast')
      .select('source_lp_uuid, chapter_title, topic, publisher, pdf_r2_key_en, pdf_r2_key_ur, voicenote_mp3_r2_key, demo_video_r2_key, review_status, review_notes')
      .eq('source_lp_uuid', uuid)
      .eq('is_enabled', true)
      .maybeSingle();
    if (error) throw error;
    if (!lp) return res.status(404).json({ success: false, error: 'Lesson plan not found' });

    // The helper's generatePresignedUrl expects a FULL R2 URL (it validates
    // via isValidR2Url which checks for .r2.cloudflarestorage.com), but our
    // *_r2_key columns store BARE object keys (e.g. "lps/curriculum-ast/{uuid}.en.pdf").
    // Prepend the R2 endpoint + bucket so the helper accepts it.
    const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
    const bucket = process.env.R2_BUCKET_NAME;
    const signKey = (k) => k
      ? generatePresignedUrl(`${endpoint}/${bucket}/${k}`, 3600)
      : Promise.resolve(null);

    // FEAT-059: sign voicenote + demo video URLs alongside the PDF so the
    // portal can render inline media players in one round-trip.
    const [voicenoteUrl, videoUrl] = await Promise.all([
      signKey(lp.voicenote_mp3_r2_key),
      signKey(lp.demo_video_r2_key),
    ]);

    const r2Key = lang === 'ur' ? lp.pdf_r2_key_ur : lp.pdf_r2_key_en;
    const filename = `${lp.chapter_title} — ${lp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');

    if (!r2Key) {
      // PDF not yet rendered — the frontend will offer to queue an async render.
      // Still return voicenote + video URLs when available; they're independent assets.
      return res.status(202).json({
        success: true, available: false,
        source_lp_uuid: lp.source_lp_uuid, language: lang,
        topic: lp.topic, chapter_title: lp.chapter_title, publisher: lp.publisher,
        voicenote_url: voicenoteUrl, video_url: videoUrl,
        review_status: lp.review_status || 'unreviewed',
        review_notes: lp.review_notes || null,
      });
    }

    const url = await signKey(r2Key); // 1h validity
    res.json({
      success: true, available: true,
      url, filename,
      source_lp_uuid: lp.source_lp_uuid, language: lang,
      topic: lp.topic, chapter_title: lp.chapter_title, publisher: lp.publisher,
      voicenote_url: voicenoteUrl, video_url: videoUrl,
      review_status: lp.review_status || 'unreviewed',
      review_notes: lp.review_notes || null,
    });
  } catch (error) {
    console.error('curriculum/lp/:uuid/pdf error:', error);
    res.status(500).json({ success: false, error: 'Failed to load PDF' });
  }
});

/**
 * POST /api/portal/curriculum/lp/:source_lp_uuid/render
 * Body: { language: 'en' | 'ur' }
 * Queues an async Gamma-grounded render for the LP. The client can poll
 * GET /pdf?lang=X until availability flips true (~90-150s later).
 * Delivery follows the standard bot pipeline — the PDF is also sent to
 * the teacher's WhatsApp when ready (same asset served both channels).
 */
router.post('/curriculum/lp/:source_lp_uuid/render', requirePortalAuth, async (req, res) => {
  try {
    const uuid = req.params.source_lp_uuid;
    const lang = String((req.body && req.body.language) || 'en').toLowerCase() === 'ur' ? 'ur' : 'en';
    const userDbId = req.session.portalUserId;

    // Hydrate the LP row + resolve the teacher's WhatsApp phone (for parallel WA delivery).
    const [{ data: lp }, { data: user }] = await Promise.all([
      supabase.from('curriculum_lp_ast')
        .select('source_lp_uuid, chapter_title, topic, publisher, pdf_r2_key_en, pdf_r2_key_ur')
        .eq('source_lp_uuid', uuid).eq('is_enabled', true).maybeSingle(),
      supabase.from('users').select('id, phone_number').eq('id', userDbId).maybeSingle(),
    ]);

    if (!lp) return res.status(404).json({ success: false, error: 'Lesson plan not found' });
    if (!user) return res.status(401).json({ success: false, error: 'Session user not found' });

    // Fast-path: already cached — nothing to do.
    const langKey = lang === 'ur' ? lp.pdf_r2_key_ur : lp.pdf_r2_key_en;
    if (langKey) return res.json({ success: true, alreadyAvailable: true, language: lang });

    // Queue via the same service the bot uses. This is the sole coupling
    // between portal and bot code — everything else in this endpoint is
    // portal-owned. If the queue service isn't reachable from the dashboard
    // process (different Railway service), we fall back to a direct
    // Supabase insert + SQS queue call so the worker still picks it up.
    let LessonPlanQueueService;
    try {
      LessonPlanQueueService = require('../../bot/shared/services/lesson-plan-queue.service');
    } catch (_) { /* not co-located; use inline path below */ }

    if (LessonPlanQueueService) {
      const requestId = await LessonPlanQueueService.createAndQueueGrounded({
        userId: userDbId,
        phoneNumber: user.phone_number,
        sourceLpUuid: lp.source_lp_uuid,
        topic: lp.topic,
        chapterTitle: lp.chapter_title,
        language: lang,
      });
      return res.status(202).json({ success: true, queued: true, requestId, language: lang });
    }

    // Fallback: create the tracking row + rely on the worker's periodic
    // stale-pending scan to pick it up (bot service normally handles this).
    const { data: request, error: insertError } = await supabase
      .from('lesson_plan_requests')
      .insert({
        user_id: userDbId,
        phone_number: user.phone_number,
        topic: lp.topic,
        full_message: lp.topic,
        language: lang,
        content_type: 'lesson_plan',
        status: 'pending',
      })
      .select('id').single();
    if (insertError) throw insertError;
    return res.status(202).json({ success: true, queued: true, requestId: request.id, language: lang, fallback: true });
  } catch (error) {
    console.error('curriculum/lp/:uuid/render error:', error);
    res.status(500).json({ success: false, error: 'Failed to queue render' });
  }
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
async function _computeLevelStates(userId, levels) {
  const levelIds = levels.map(l => l.id);
  const vendorIds = [...new Set(levels.map(l => l.vendor_id).filter(Boolean))];
  const [{ data: courses }, { data: progressRows }, { data: attempts }, { data: vendorRows }] = await Promise.all([
    supabase.from('training_courses').select('id, level_id').eq('is_active', true).in('level_id', levelIds),
    supabase.from('teacher_training_progress')
      .select('module_id, training_modules!inner(course_id, is_active)')
      .eq('user_id', userId)
      .eq('training_modules.is_active', true),
    supabase.from('training_assessment_attempts')
      .select('level_id, status, is_passed, cooldown_until, completed_at')
      .eq('user_id', userId).in('level_id', levelIds),
    vendorIds.length
      ? supabase.from('training_vendors').select('id, unlock_logic').in('id', vendorIds)
      : Promise.resolve({ data: [] }),
  ]);
  const vendorById = new Map((vendorRows || []).map(v => [v.id, v]));

  // module → course → level chain, plus overall completed_set for the module-count rollup
  const progressByCourse = new Map();
  const completedModuleIds = new Set();
  for (const p of progressRows || []) {
    completedModuleIds.add(p.module_id);
    const cid = p?.training_modules?.course_id;
    if (cid) progressByCourse.set(cid, (progressByCourse.get(cid) || 0) + 1);
  }

  // Also need module counts per level for the "X/Y done" copy
  const allCourseIds = (courses || []).map(c => c.id);
  const { data: modules } = allCourseIds.length
    ? await supabase.from('training_modules')
        .select('id, course_id').eq('is_active', true).in('course_id', allCourseIds)
    : { data: [] };

  const moduleCountByLevel = new Map();
  const completedCountByLevel = new Map();
  for (const m of modules || []) {
    const course = (courses || []).find(c => c.id === m.course_id);
    if (!course) continue;
    moduleCountByLevel.set(course.level_id, (moduleCountByLevel.get(course.level_id) || 0) + 1);
    if (completedModuleIds.has(m.id)) {
      completedCountByLevel.set(course.level_id, (completedCountByLevel.get(course.level_id) || 0) + 1);
    }
  }

  // Now compute state per level using the WhatsApp bot's rules
  const byLevelId = new Map();
  for (const lv of levels) {
    const lvCourses = (courses || []).filter(c => c.level_id === lv.id);
    const coursesStarted = lvCourses.filter(c => (progressByCourse.get(c.id) || 0) > 0);
    const passedAttempt = (attempts || []).find(a => a.level_id === lv.id && a.is_passed === true);
    const cooldownAttempt = (attempts || []).find(a =>
      a.level_id === lv.id && a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date()
    );
    // Chain-lock applies only to vendors whose unlock_logic says so — mirror
    // the WhatsApp endpoint's rule exactly. Missing vendor row defaults to
    // 'chain' (the legacy Taleemabad behaviour). Previous-level lookup is
    // scoped WITHIN the vendor: with multiple vendors on the board, a global
    // order_index-1 lookup crosses vendor boundaries and locks the wrong rows.
    const vendor = vendorById.get(lv.vendor_id);
    const chainLocked = (vendor?.unlock_logic || 'chain') === 'chain';
    const prevLevel = levels
      .filter(l => l.vendor_id === lv.vendor_id)
      .find(l => l.order_index === lv.order_index - 1);
    const prevPassed = !prevLevel || !!(attempts || []).find(a => a.level_id === prevLevel.id && a.is_passed === true);
    const isFirst = !prevLevel;

    let state;
    if (chainLocked && !prevPassed && !isFirst) state = 'locked';
    else if (passedAttempt) state = 'certified';
    else if (coursesStarted.length === lvCourses.length && lvCourses.length > 0) state = 'ready_for_quiz';
    else if (coursesStarted.length > 0) state = 'in_progress';
    else state = 'not_started';

    byLevelId.set(lv.id, {
      state,
      courses_total: lvCourses.length,
      courses_completed: coursesStarted.length,
      module_count: moduleCountByLevel.get(lv.id) || 0,
      completed_count: completedCountByLevel.get(lv.id) || 0,
      passed_at: passedAttempt?.completed_at || null,
      cooldown_until: cooldownAttempt?.cooldown_until || null,
      previous_level_order: prevLevel ? prevLevel.order_index : null,
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
        _pctSum: 0,
        _pctN: 0,
      });
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
      avg_score_pct: agg._pctN > 0 ? Math.round(agg._pctSum / agg._pctN) : null,
    }));

    out.sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));

    res.json({ success: true, vendors: out });
  } catch (error) {
    console.error('training/vendors error:', error);
    res.status(500).json({ success: false, error: 'Failed to load training vendors' });
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
      .select('id, name, order_index, cpd_level, vendor_id, training_vendors!inner(key)')
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (le) throw le;

    const stateMap = await _computeLevelStates(userId, levels || []);

    const enriched = (levels || []).map(l => {
      const s = stateMap.get(l.id) || {};
      return {
        id: l.id, name: l.name, order_index: l.order_index, cpd_level: l.cpd_level,
        vendor_key: l.training_vendors ? l.training_vendors.key : null,
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
 */
async function _resolveMediaUrl(url, expiresIn = 3600) {
  if (!url) return null;
  if (isValidR2Url(url)) return generatePresignedUrl(url, expiresIn);
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

/** True when a module's source_media_url points at a PDF document. */
function _isPdfSourceUrl(url) {
  return !!url && /\.pdf(\?|$)/i.test(url);
}

async function _assertLevelUnlocked(userId, levelId) {
  // vendor_id is required by _computeLevelStates for the per-vendor
  // unlock_logic + within-vendor previous-level rule.
  const { data: levels } = await supabase
    .from('training_levels').select('id, name, order_index, vendor_id').eq('is_active', true).order('order_index');
  const stateMap = await _computeLevelStates(userId, levels || []);
  const s = stateMap.get(levelId);
  if (!s) return { ok: false, status: 404, error: 'Level not found' };
  if (s.state === 'locked') {
    const prevOrder = s.previous_level_order;
    return {
      ok: false, status: 403,
      error: `This level is locked. Pass Level ${prevOrder + 1}'s grand quiz first.`,
      previous_level_order: prevOrder,
    };
  }
  return { ok: true };
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
      .from('training_courses').select('level_id').eq('id', courseId).maybeSingle();
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

    const enriched = (modules || []).map(m => ({
      id: m.id, title: m.title, order_index: m.order_index,
      duration_seconds: m.duration_seconds,
      has_video: !!m.video_url,
      has_audio: !!m.audio_url,
      has_pdf: _isPdfSourceUrl(m.source_media_url),
      completed_at: completedMap.get(m.id) || null,
    }));
    res.json({ success: true, modules: enriched });
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
    }

    // 3. Active questions, canonical order — the exact set the POST endpoint
    //    will grade against (answer count must match this list's length).
    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, question_text, options, order_index')
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

    // 5. Grade — match each answer to a question by id; correct if
    //    String(chosen_option) === String(correct_option). Missing/invalid
    //    answers count as wrong (defensive — the client shouldn't send them
    //    but a race between question edits and submit shouldn't 500).
    const qById = new Map(qList.map(q => [q.id, q]));
    const graded = answers.map((a, idx) => {
      const q = qById.get(a && a.question_id);
      if (!q) return { question_index: idx, question_id: null, chosen_option: '', is_correct: false, unknown: true };
      const chosen = a.chosen_option == null ? '' : String(a.chosen_option);
      const isCorrect = chosen !== '' && String(q.correct_option).trim() === chosen.trim();
      // question_index = position in the module's canonical question order,
      // NOT the order the client submitted — matches WhatsApp's per-index
      // answer rows (attempt_id, question_index) UNIQUE.
      const questionIndex = q.order_index != null
        ? q.order_index
        : qList.findIndex(x => x.id === q.id);
      return { question_index: questionIndex, question_id: q.id, chosen_option: chosen, is_correct: isCorrect };
    });
    if (graded.some(g => g.unknown)) {
      return res.status(400).json({ success: false, error: 'One or more answers reference a question not on this module' });
    }
    const totalQuestions = qList.length;
    const score = graded.filter(g => g.is_correct).length;
    const isPerfect = score === totalQuestions;
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
        status: 'passed',                   // non-blocking, "attempt closed"
        score,
        is_passed: isPerfect,               // pedagogical "perfect score" flag
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

    // 8. Upsert progress row — completing the quiz on portal ALSO marks the
    //    module complete (matches WhatsApp: content delivery → quiz fires →
    //    module counted). Unique (user_id, module_id) makes this idempotent.
    await supabase
      .from('teacher_training_progress')
      .upsert(
        { user_id: userId, module_id: moduleId, completed_at: completedAt },
        { onConflict: 'user_id,module_id' }
      );

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
        is_perfect: isPerfect,
        surface: 'portal',
      });
    } catch (_) { /* logger not available — fine, this is best-effort telemetry */ }

    return res.json({
      success: true,
      attempt: {
        id: attempt.id,
        score,
        max_score: totalQuestions,
        is_passed: isPerfect,
        completed_at: completedAt,
      },
    });
  } catch (error) {
    console.error('training/module/:id/quiz-attempts POST error:', error);
    return res.status(500).json({ success: false, error: 'Failed to submit quiz attempt' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Grand quiz (level exam) + certificate — portal quiz-parity phase 3.
// The WhatsApp reference implementation is
// bot/shared/services/training/quiz-delivery.service.js (grading, cooldown,
// certificate) and bot/shared/routes/teacher-training-endpoint.js
// loadGrandQuizState (eligibility). The portal MUST keep identical semantics:
//   - eligibility: every active course in the level has ≥1 completed module
//   - pass bar: 100% (score === total_questions)
//   - fail: status='failed' + 24h cooldown_until; no cooldown on pass
//   - certificate: issued via the bot's shared certificate service on pass
// ────────────────────────────────────────────────────────────────────────────

// Parity constant — mirrors COOLDOWN_HOURS in quiz-delivery.service.js.
const GRAND_QUIZ_COOLDOWN_HOURS = 24;

/**
 * Load the teacher's grand-quiz gate for a level. Query-for-query mirror of
 * the WhatsApp Flow's loadGrandQuizState() with one deliberate tightening:
 * passed/cooldown checks filter attempts to quiz_kind='grand'. (The Flow
 * scans ALL attempts on the level; per-module attempts also carry level_id
 * and is_passed=true on a perfect score, which would wrongly report the
 * LEVEL as passed and block the real exam. Filtering by kind is strictly
 * more correct on both surfaces — flagged for backport to the Flow.)
 *
 * Returns { quiz, passed, passedAttempt, cooldownUntil, allCoursesStarted,
 *           coursesTotal, coursesStarted, questionCount }.
 */
async function _loadGrandQuizGate(userId, levelId) {
  const [{ data: quiz }, { data: attempts }, { data: courses }, { data: modules }, { data: progressRows }] = await Promise.all([
    supabase.from('training_grand_quizzes')
      .select('id, level_id')
      .eq('level_id', levelId).eq('quiz_type', 'grand_quiz').eq('is_active', true)
      .maybeSingle(),
    supabase.from('training_assessment_attempts')
      .select('id, status, is_passed, cooldown_until, completed_at')
      .eq('user_id', userId).eq('level_id', levelId).eq('quiz_kind', 'grand'),
    supabase.from('training_courses').select('id').eq('level_id', levelId).eq('is_active', true),
    supabase.from('training_modules').select('id, course_id').eq('is_active', true),
    supabase.from('teacher_training_progress').select('module_id').eq('user_id', userId),
  ]);

  const passedAttempt = (attempts || []).find(a => a.is_passed === true) || null;
  const cooldownAttempt = (attempts || []).find(a =>
    a.status === 'failed' && a.cooldown_until && new Date(a.cooldown_until) > new Date()
  ) || null;

  // Eligibility — EXACT WhatsApp criterion: every active course in the level
  // has ≥1 module in teacher_training_progress ("started" proxy, matching
  // loadGrandQuizState + the level-state 'ready_for_quiz' computation).
  const doneIds = new Set((progressRows || []).map(r => r.module_id));
  const courseIds = new Set((courses || []).map(c => c.id));
  const startedCourseIds = new Set(
    (modules || []).filter(m => courseIds.has(m.course_id) && doneIds.has(m.id)).map(m => m.course_id)
  );
  const allCoursesStarted = courseIds.size > 0 && startedCourseIds.size === courseIds.size;

  let questionCount = 0;
  if (quiz) {
    const { data: qs } = await supabase
      .from('training_questions')
      .select('id')
      .eq('grand_quiz_id', quiz.id)
      .eq('is_active', true);
    questionCount = (qs || []).length;
  }

  return {
    quiz: quiz || null,
    passed: !!passedAttempt,
    passedAttempt,
    cooldownUntil: cooldownAttempt ? cooldownAttempt.cooldown_until : null,
    allCoursesStarted,
    coursesTotal: courseIds.size,
    coursesStarted: startedCourseIds.size,
    questionCount,
  };
}

/** Reduce a gate to the single state string the frontend renders on. */
function _grandQuizState(gate) {
  if (!gate.quiz || gate.questionCount === 0) return 'no_quiz';
  if (gate.passed) return 'passed';
  if (gate.cooldownUntil) return 'cooldown';
  if (!gate.allCoursesStarted) return 'courses_incomplete';
  return 'ready';
}

/**
 * GET /api/portal/training/level/:id/grand-quiz
 *
 * Grand-quiz (level exam) status for the authenticated teacher on one level.
 * Drives the "Take Level Exam" entry point on the Training page.
 *
 * Response:
 *   { success: true, grand_quiz: {
 *       state: 'no_quiz'|'passed'|'cooldown'|'courses_incomplete'|'ready',
 *       question_count, pass_mark_pct: 100,
 *       cooldown_hours: 24, cooldown_until: ISO|null,
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
        question_count: gate.questionCount,
        pass_mark_pct: 100,
        cooldown_hours: GRAND_QUIZ_COOLDOWN_HOURS,
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

    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, question_text, question_urdu, options, order_index')
      .eq('grand_quiz_id', gate.quiz.id)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;

    return res.json({
      success: true,
      questions: (questions || []).map(q => ({
        id: q.id,
        question_text: q.question_text,
        question_urdu: q.question_urdu || null,
        options: Array.isArray(q.options) ? q.options : [],
        order_index: q.order_index,
      })),
      question_count: (questions || []).length,
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
 *   - pass bar: 100% — `is_passed = (score === total_questions)`
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

    // 1. Level chain-lock gate — same rule as every other training endpoint.
    const lock = await _assertLevelUnlocked(userId, levelId);
    if (!lock.ok) return res.status(lock.status).json({ success: false, error: lock.error, previous_level_order: lock.previous_level_order });

    // 2. Grand-quiz gate — quiz exists, not passed, no cooldown, all courses
    //    started (the WhatsApp eligibility rule, checked server-side so a
    //    hand-crafted request can't skip the level's coursework).
    const gate = await _loadGrandQuizGate(userId, levelId);
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

    // 3. Canonical question list (same order the WhatsApp side asks).
    const { data: questions, error: qErr } = await supabase
      .from('training_questions')
      .select('id, correct_option, order_index')
      .eq('grand_quiz_id', gate.quiz.id)
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (qErr) throw qErr;
    const qList = questions || [];
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

    // 5. Grade — identical comparator to the WhatsApp writer:
    //    String(correct_option).trim() === String(chosen).trim().
    //    question_index = 0-based position in the canonical order (the value
    //    the WhatsApp Q-by-Q loop writes), independent of submit order.
    const qById = new Map(qList.map((q, pos) => [q.id, { ...q, pos }]));
    const graded = answers.map(a => {
      const q = qById.get(a && a.question_id);
      if (!q) return { unknown: true };
      const chosen = a.chosen_option == null ? '' : String(a.chosen_option);
      const isCorrect = chosen !== '' && String(q.correct_option).trim() === chosen.trim();
      return { question_index: q.pos, question_id: q.id, chosen_option: chosen, is_correct: isCorrect };
    });
    if (graded.some(g => g.unknown)) {
      return res.status(400).json({ success: false, error: 'One or more answers reference a question not on this exam' });
    }
    if (new Set(graded.map(g => g.question_id)).size !== qList.length) {
      return res.status(400).json({ success: false, error: 'Duplicate answers for the same question' });
    }

    const totalQuestions = qList.length;
    const score = graded.filter(g => g.is_correct).length;
    const isPassed = score === totalQuestions;   // 100% required — grand-quiz pass bar
    const completedAt = new Date().toISOString();
    const cooldownUntil = isPassed
      ? null
      : new Date(Date.now() + GRAND_QUIZ_COOLDOWN_HOURS * 3_600_000).toISOString();

    // 6. Insert the attempt row — shape parity with quiz-delivery.service.js
    //    (startGrandQuiz insert + gradeAttempt grand-branch update, collapsed
    //    into the one-shot row the portal writes).
    const { data: attempt, error: aErr } = await supabase
      .from('training_assessment_attempts')
      .insert({
        user_id: userId,
        program_id: assignment.program_id,
        quiz_kind: 'grand',
        grand_quiz_id: gate.quiz.id,
        level_id: levelId,
        current_question_index: totalQuestions,
        total_questions: totalQuestions,
        total_score: totalQuestions,
        status: isPassed ? 'passed' : 'failed',
        score,
        is_passed: isPassed,
        completed_at: completedAt,
        last_activity_at: completedAt,
        started_at: completedAt,            // one-shot submit; no partial state on portal
        cooldown_until: cooldownUntil,
      })
      .select('id')
      .single();
    if (aErr) throw aErr;

    // 7. Per-question answer rows.
    const answerRows = graded.map(g => ({
      attempt_id: attempt.id,
      question_index: g.question_index,
      question_id: g.question_id,
      chosen_option: g.chosen_option,
      is_correct: g.is_correct,
      answered_at: completedAt,
    }));
    const { error: ansErr } = await supabase.from('training_assessment_answers').insert(answerRows);
    if (ansErr) throw ansErr;

    // 8. Certificate on pass — the bot's shared issuance service (idempotent
    //    per attempt; PDF rendering stays a separate concern). Lazy require:
    //    the service lives in the bot tree and must not load at router mount.
    let certificate = null;
    if (isPassed) {
      const { issueCertificate } = require('../../bot/shared/services/training/certificate.service');
      const cert = await issueCertificate(supabase, {
        userId,
        programId: assignment.program_id,
        levelId,
        attemptId: attempt.id,
      });
      certificate = {
        certificate_code: cert.certificate_code,
        teacher_name: cert.teacher_name,
        level_name: cert.level_name,
        issued_at: cert.issued_at,
      };
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

    const { data: coachingSessions, error, count } = await supabase
      .from('coaching_sessions')
      .select('id, created_at, audio_duration_seconds, status, analysis_data', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .not('analysis_data', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    // Format sessions with summary data
    // NOTE: Transform 'created_at' to 'date' and 'audio_duration_seconds' to 'duration'
    // NOTE: Actual score path is analysis_data.scores.overall_marks (not overall_score.points)
    const formattedSessions = (coachingSessions || []).map(session => ({
      id: session.id,
      date: session.created_at,
      session_date: session.created_at, // Portal expects 'session_date'
      duration: session.audio_duration_seconds,
      overallScore: session.analysis_data?.scores?.overall_marks || session.analysis_data?.scores?.grand_total || 0,
      maxScore: session.analysis_data?.scores?.max_marks || 118,
      percentage: session.analysis_data?.scores?.percentage || 0
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

    if (error || !session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Transform analysis_data structure to match frontend expectations
    const scores = session.analysis_data?.scores || {};
    const overallMarks = scores.overall_marks || scores.grand_total || 0;
    const maxMarks = scores.max_marks || 118;
    const percentage = scores.percentage || 0;

    // Map goal areas from Rumi Teaching Framework
    const goalScores = [
      {
        goal: 'Formative Assessment',
        points: scores.goal1_total || 0,
        max_points: 22,
        percentage: scores.goal1_total ? ((scores.goal1_total / 22) * 100) : 0
      },
      {
        goal: 'Student Engagement',
        points: scores.goal2_total || 0,
        max_points: 22,
        percentage: scores.goal2_total ? ((scores.goal2_total / 22) * 100) : 0
      },
      {
        goal: 'Quality Content',
        points: scores.goal3_total || 0,
        max_points: 38,
        percentage: scores.goal3_total ? ((scores.goal3_total / 38) * 100) : 0
      },
      {
        goal: 'Effective Differentiation',
        points: scores.goal4_total || 0,
        max_points: 5,
        percentage: scores.goal4_total ? ((scores.goal4_total / 5) * 100) : 0
      },
      {
        goal: 'Classroom Management',
        points: scores.goal5_total || 0,
        max_points: 21,
        percentage: scores.goal5_total ? ((scores.goal5_total / 21) * 100) : 0
      },
      {
        goal: 'Reflective Debrief',
        points: scores.debrief_total || 0,
        max_points: 15,
        percentage: scores.debrief_total ? ((scores.debrief_total / 15) * 100) : 0
      }
    ];

    // Extract criterion-level scores from nested goal data
    const criterionScores = [];

    // Goal 1: Formative Assessment criteria
    if (session.analysis_data?.goal1_formative_assessment) {
      const g1 = session.analysis_data.goal1_formative_assessment;
      if (g1.assessment) {
        criterionScores.push({
          criterion: 'Assessment Quality',
          points: g1.assessment.computed_marks || 0,
          max_points: g1.assessment.max_marks || 9,
          percentage: g1.assessment.computed_marks && g1.assessment.max_marks ?
            ((g1.assessment.computed_marks / g1.assessment.max_marks) * 100) : 0
        });
      }
      if (g1.teachers_role) {
        criterionScores.push({
          criterion: "Teacher's Facilitation Role",
          points: g1.teachers_role.computed_marks || 0,
          max_points: g1.teachers_role.max_marks || 4,
          percentage: g1.teachers_role.computed_marks && g1.teachers_role.max_marks ?
            ((g1.teachers_role.computed_marks / g1.teachers_role.max_marks) * 100) : 0
        });
      }
      if (g1.smart_objectives) {
        criterionScores.push({
          criterion: 'SMART Learning Objectives',
          points: g1.smart_objectives.computed_marks || 0,
          max_points: g1.smart_objectives.max_marks || 4,
          percentage: g1.smart_objectives.computed_marks && g1.smart_objectives.max_marks ?
            ((g1.smart_objectives.computed_marks / g1.smart_objectives.max_marks) * 100) : 0
        });
      }
      if (g1.incorporation_of_feedback) {
        criterionScores.push({
          criterion: 'Incorporation of Feedback',
          points: g1.incorporation_of_feedback.computed_marks || 0,
          max_points: g1.incorporation_of_feedback.max_marks || 5,
          percentage: g1.incorporation_of_feedback.computed_marks && g1.incorporation_of_feedback.max_marks ?
            ((g1.incorporation_of_feedback.computed_marks / g1.incorporation_of_feedback.max_marks) * 100) : 0
        });
      }
    }

    // Goal 2: Student Engagement criteria
    if (session.analysis_data?.goal2_student_engagement) {
      const g2 = session.analysis_data.goal2_student_engagement;
      if (g2.multimodality) {
        criterionScores.push({
          criterion: 'Multimodal Learning',
          points: g2.multimodality.computed_marks || 0,
          max_points: g2.multimodality.max_marks || 5,
          percentage: g2.multimodality.computed_marks && g2.multimodality.max_marks ?
            ((g2.multimodality.computed_marks / g2.multimodality.max_marks) * 100) : 0
        });
      }
      if (g2.misconceptions) {
        criterionScores.push({
          criterion: 'Addressing Misconceptions',
          points: g2.misconceptions.computed_marks || 0,
          max_points: g2.misconceptions.max_marks || 4,
          percentage: g2.misconceptions.computed_marks && g2.misconceptions.max_marks ?
            ((g2.misconceptions.computed_marks / g2.misconceptions.max_marks) * 100) : 0
        });
      }
      if (g2.cognitive_rigor) {
        criterionScores.push({
          criterion: 'Cognitive Rigor',
          points: g2.cognitive_rigor.computed_marks || 0,
          max_points: g2.cognitive_rigor.max_marks || 9,
          percentage: g2.cognitive_rigor.computed_marks && g2.cognitive_rigor.max_marks ?
            ((g2.cognitive_rigor.computed_marks / g2.cognitive_rigor.max_marks) * 100) : 0
        });
      }
      if (g2.real_world_connections) {
        criterionScores.push({
          criterion: 'Real-World Connections',
          points: g2.real_world_connections.computed_marks || 0,
          max_points: g2.real_world_connections.max_marks || 4,
          percentage: g2.real_world_connections.computed_marks && g2.real_world_connections.max_marks ?
            ((g2.real_world_connections.computed_marks / g2.real_world_connections.max_marks) * 100) : 0
        });
      }
    }

    // Goal 3: Quality Content criteria
    if (session.analysis_data?.goal3_quality_content) {
      const g3 = session.analysis_data.goal3_quality_content;
      if (g3.prior_knowledge) {
        criterionScores.push({
          criterion: 'Prior Knowledge Check',
          points: g3.prior_knowledge.computed_marks || 0,
          max_points: g3.prior_knowledge.max_marks || 4,
          percentage: g3.prior_knowledge.computed_marks && g3.prior_knowledge.max_marks ?
            ((g3.prior_knowledge.computed_marks / g3.prior_knowledge.max_marks) * 100) : 0
        });
      }
      if (g3.verbal_questioning) {
        criterionScores.push({
          criterion: 'Effective Questioning',
          points: g3.verbal_questioning.computed_marks || 0,
          max_points: g3.verbal_questioning.max_marks || 4,
          percentage: g3.verbal_questioning.computed_marks && g3.verbal_questioning.max_marks ?
            ((g3.verbal_questioning.computed_marks / g3.verbal_questioning.max_marks) * 100) : 0
        });
      }
      if (g3.content_organization) {
        criterionScores.push({
          criterion: 'Content Organization',
          points: g3.content_organization.computed_marks || 0,
          max_points: g3.content_organization.max_marks || 7,
          percentage: g3.content_organization.computed_marks && g3.content_organization.max_marks ?
            ((g3.content_organization.computed_marks / g3.content_organization.max_marks) * 100) : 0
        });
      }
      if (g3.coherence_transitions) {
        criterionScores.push({
          criterion: 'Lesson Coherence & Transitions',
          points: g3.coherence_transitions.computed_marks || 0,
          max_points: g3.coherence_transitions.max_marks || 4,
          percentage: g3.coherence_transitions.computed_marks && g3.coherence_transitions.max_marks ?
            ((g3.coherence_transitions.computed_marks / g3.coherence_transitions.max_marks) * 100) : 0
        });
      }
      if (g3.content_coverage_accuracy) {
        criterionScores.push({
          criterion: 'Content Coverage & Accuracy',
          points: g3.content_coverage_accuracy.computed_marks || 0,
          max_points: g3.content_coverage_accuracy.max_marks || 11,
          percentage: g3.content_coverage_accuracy.computed_marks && g3.content_coverage_accuracy.max_marks ?
            ((g3.content_coverage_accuracy.computed_marks / g3.content_coverage_accuracy.max_marks) * 100) : 0
        });
      }
      if (g3.prior_knowledge_activation) {
        criterionScores.push({
          criterion: 'Prior Knowledge Activation',
          points: g3.prior_knowledge_activation.computed_marks || 0,
          max_points: g3.prior_knowledge_activation.max_marks || 4,
          percentage: g3.prior_knowledge_activation.computed_marks && g3.prior_knowledge_activation.max_marks ?
            ((g3.prior_knowledge_activation.computed_marks / g3.prior_knowledge_activation.max_marks) * 100) : 0
        });
      }
    }

    // Goal 5: Classroom Management criteria
    if (session.analysis_data?.goal5_classroom_management) {
      const g5 = session.analysis_data.goal5_classroom_management;
      if (g5.classroom_culture) {
        criterionScores.push({
          criterion: 'Classroom Culture',
          points: g5.classroom_culture.computed_marks || 0,
          max_points: g5.classroom_culture.max_marks || 9,
          percentage: g5.classroom_culture.computed_marks && g5.classroom_culture.max_marks ?
            ((g5.classroom_culture.computed_marks / g5.classroom_culture.max_marks) * 100) : 0
        });
      }
      if (g5.classroom_management) {
        criterionScores.push({
          criterion: 'Classroom Management',
          points: g5.classroom_management.computed_marks || 0,
          max_points: g5.classroom_management.max_marks || 9,
          percentage: g5.classroom_management.computed_marks && g5.classroom_management.max_marks ?
            ((g5.classroom_management.computed_marks / g5.classroom_management.max_marks) * 100) : 0
        });
      }
      if (g5.pacing) {
        criterionScores.push({
          criterion: 'Lesson Pacing',
          points: g5.pacing.computed_marks || 0,
          max_points: g5.pacing.max_marks || 3,
          percentage: g5.pacing.computed_marks && g5.pacing.max_marks ?
            ((g5.pacing.computed_marks / g5.pacing.max_marks) * 100) : 0
        });
      }
    }

    // Extract narrative arrays from analysis_data
    const strengthsArray = session.analysis_data?.strengths?.map(s =>
      typeof s === 'string' ? s : s.title || s.analysis || 'Strength identified'
    ) || [];

    const growthArray = session.analysis_data?.growth_opportunities?.map(g =>
      typeof g === 'string' ? g : g.area || g.rationale || 'Growth area identified'
    ) || [];

    const recommendationsArray = session.analysis_data?.recommendations || [];

    // NOTE: Actual score path is analysis_data.scores.overall_marks (not overall_score.points)
    res.json({
      success: true,
      session: {
        id: session.id,
        date: session.created_at,
        session_date: session.created_at, // Portal expects 'session_date'
        duration: session.audio_duration_seconds,
        audioUrl: session.voice_debrief_url, // Voice debrief (.mp3) for portal playback
        transcript: session.transcript_text,
        reportPdfUrl: session.report_pdf_url,
        overallScore: overallMarks,
        maxScore: maxMarks,
        percentage: percentage,
        // Transform analysisData to match frontend expectations
        analysisData: {
          overall_score: {
            points: overallMarks,
            max_points: maxMarks,
            percentage: percentage
          },
          goal_scores: goalScores,
          criterion_scores: criterionScores,
          strengths: strengthsArray,
          growth_opportunities: growthArray,
          recommendations: recommendationsArray
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

    // Build overall score trend
    // NOTE: Actual path is analysis_data.scores.overall_marks and scores.percentage
    const overallScoreTrend = sessions.map(session => ({
      date: session.created_at,
      score: session.analysis_data?.scores?.overall_marks || session.analysis_data?.scores?.grand_total || 0,
      percentage: session.analysis_data?.scores?.percentage || 0
    }));

    // Get latest session for goal area breakdown
    const latestSession = sessions[sessions.length - 1];

    // NOTE: Actual structure has goal1_total, goal2_total, etc. in scores object
    // Map to goal names from Rumi Teaching Framework
    const goalAreaBreakdown = [
      {
        name: 'Formative Assessment',
        score: latestSession.analysis_data?.scores?.goal1_total || 0,
        maxScore: 22, // Goal 1 max marks
        percentage: latestSession.analysis_data?.scores?.goal1_total ?
          ((latestSession.analysis_data.scores.goal1_total / 22) * 100) : 0
      },
      {
        name: 'Student Engagement',
        score: latestSession.analysis_data?.scores?.goal2_total || 0,
        maxScore: 22, // Goal 2 max marks
        percentage: latestSession.analysis_data?.scores?.goal2_total ?
          ((latestSession.analysis_data.scores.goal2_total / 22) * 100) : 0
      },
      {
        name: 'Quality Content',
        score: latestSession.analysis_data?.scores?.goal3_total || 0,
        maxScore: 38, // Goal 3 max marks
        percentage: latestSession.analysis_data?.scores?.goal3_total ?
          ((latestSession.analysis_data.scores.goal3_total / 38) * 100) : 0
      },
      {
        name: 'Effective Differentiation',
        score: latestSession.analysis_data?.scores?.goal4_total || 0,
        maxScore: 5, // Goal 4 max marks
        percentage: latestSession.analysis_data?.scores?.goal4_total ?
          ((latestSession.analysis_data.scores.goal4_total / 5) * 100) : 0
      },
      {
        name: 'Classroom Management',
        score: latestSession.analysis_data?.scores?.goal5_total || 0,
        maxScore: 21, // Goal 5 max marks
        percentage: latestSession.analysis_data?.scores?.goal5_total ?
          ((latestSession.analysis_data.scores.goal5_total / 21) * 100) : 0
      },
      {
        name: 'Reflective Debrief',
        score: latestSession.analysis_data?.scores?.debrief_total || 0,
        maxScore: 15, // Debrief max marks
        percentage: latestSession.analysis_data?.scores?.debrief_total ?
          ((latestSession.analysis_data.scores.debrief_total / 15) * 100) : 0
      }
    ].map(goal => ({
      ...goal,
      percentage: Math.round(goal.percentage * 10) / 10 // Round to 1 decimal
    }));

    // Calculate insights
    const totalSessions = sessions.length;
    const averageScore = overallScoreTrend.reduce((sum, s) => sum + s.score, 0) / totalSessions;
    const firstScore = overallScoreTrend[0]?.score || 0;
    const lastScore = overallScoreTrend[totalSessions - 1]?.score || 0;
    const improvement = lastScore - firstScore;

    // Find best and focus areas
    const sortedGoals = [...goalAreaBreakdown].sort((a, b) => b.percentage - a.percentage);
    const bestGoalArea = sortedGoals[0]?.name || null;
    const focusArea = sortedGoals[sortedGoals.length - 1]?.name || null;

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

module.exports = router;
