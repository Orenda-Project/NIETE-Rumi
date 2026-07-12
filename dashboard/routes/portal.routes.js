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
  // Remove spaces and ensure format
  return phone.replace(/\s+/g, '');
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

    // Sanitize and validate phone number
    phoneNumber = sanitizePhoneNumber(phoneNumber);
    if (!validatePhoneNumber(phoneNumber)) {
      // SECURITY: Generic error - don't reveal phone format issue
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please try again.'
      });
    }

    // Get user by phone number
    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, portal_password_hash, portal_activated')
      .eq('phone_number', phoneNumber)
      .eq('portal_activated', true)
      .single();

    // SECURITY: Generic error - don't reveal if user exists
    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please try again.'
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.portal_password_hash);

    if (!validPassword) {
      // SECURITY: Same generic error
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Please try again.'
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

    // Sanitize and validate phone number
    phoneNumber = sanitizePhoneNumber(phoneNumber);
    if (!validatePhoneNumber(phoneNumber)) {
      // SECURITY: Generic response - don't reveal invalid phone format
      return res.status(200).json({
        success: true,
        message: 'If this phone number is registered, you will receive a reset code shortly.'
      });
    }

    // Import password reset service (standalone portal version)
    const PasswordResetService = require('../services/password-reset.service');

    // Check rate limit
    const rateLimitCheck = await PasswordResetService.checkRateLimit(phoneNumber);

    if (!rateLimitCheck.allowed) {
      // SECURITY: Generic response - don't reveal rate limit status
      return res.status(200).json({
        success: true,
        message: 'If this phone number is registered, you will receive a reset code shortly.'
      });
    }

    // Send reset code
    const result = await PasswordResetService.sendResetCode(phoneNumber);

    // SECURITY: Always return success, even if user not found
    // This prevents phone number enumeration attacks
    res.json({
      success: true,
      message: 'If this phone number is registered, you will receive a reset code shortly.'
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
      .select('source_lp_uuid, lp_index, topic, publisher, chapter_title, pdf_r2_key_en, pdf_r2_key_ur, rendered_at')
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
      .select('source_lp_uuid, chapter_title, topic, publisher, pdf_r2_key_en, pdf_r2_key_ur')
      .eq('source_lp_uuid', uuid)
      .eq('is_enabled', true)
      .maybeSingle();
    if (error) throw error;
    if (!lp) return res.status(404).json({ success: false, error: 'Lesson plan not found' });

    const r2Key = lang === 'ur' ? lp.pdf_r2_key_ur : lp.pdf_r2_key_en;
    if (!r2Key) {
      // Not yet rendered — the frontend will offer to queue an async render.
      return res.status(202).json({
        success: true, available: false,
        source_lp_uuid: lp.source_lp_uuid, language: lang,
        topic: lp.topic, chapter_title: lp.chapter_title, publisher: lp.publisher,
      });
    }

    // The helper's generatePresignedUrl expects a FULL R2 URL (it validates
    // via isValidR2Url which checks for .r2.cloudflarestorage.com), but our
    // pdf_r2_key columns store BARE object keys (e.g. "lps/curriculum-ast/{uuid}.en.pdf").
    // Prepend the R2 endpoint + bucket so the helper accepts it.
    const filename = `${lp.chapter_title} — ${lp.topic} - Lesson Plan.pdf`.replace(/["<>?*|\\/]/g, '');
    const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '');
    const bucket = process.env.R2_BUCKET_NAME;
    const fullR2Url = `${endpoint}/${bucket}/${r2Key}`;
    const url = await generatePresignedUrl(fullR2Url, 3600); // 1h validity
    res.json({
      success: true, available: true,
      url, filename,
      source_lp_uuid: lp.source_lp_uuid, language: lang,
      topic: lp.topic, chapter_title: lp.chapter_title, publisher: lp.publisher,
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
 *   locked         previous level's grand quiz NOT passed (unless first level)
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
  const [{ data: courses }, { data: progressRows }, { data: attempts }] = await Promise.all([
    supabase.from('training_courses').select('id, level_id').eq('is_active', true).in('level_id', levelIds),
    supabase.from('teacher_training_progress')
      .select('module_id, training_modules!inner(course_id, is_active)')
      .eq('user_id', userId)
      .eq('training_modules.is_active', true),
    supabase.from('training_assessment_attempts')
      .select('level_id, status, is_passed, cooldown_until, completed_at')
      .eq('user_id', userId).in('level_id', levelIds),
  ]);

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
    const prevLevel = levels.find(l => l.order_index === lv.order_index - 1);
    const prevPassed = !prevLevel || !!(attempts || []).find(a => a.level_id === prevLevel.id && a.is_passed === true);
    const isFirst = !prevLevel;

    let state;
    if (!prevPassed && !isFirst) state = 'locked';
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
 * GET /api/portal/training/levels
 * Returns the 4 training levels with per-level module counts, completion %,
 * AND lockdown state (mirrors WhatsApp Flow). A level is `locked` until the
 * teacher passes the previous level's grand quiz.
 */
router.get('/training/levels', requirePortalAuth, async (req, res) => {
  try {
    const userId = req.session.portalUserId;

    const { data: levels, error: le } = await supabase
      .from('training_levels')
      .select('id, name, order_index, cpd_level')
      .eq('is_active', true)
      .order('order_index', { ascending: true });
    if (le) throw le;

    const stateMap = await _computeLevelStates(userId, levels || []);

    const enriched = (levels || []).map(l => {
      const s = stateMap.get(l.id) || {};
      return {
        id: l.id, name: l.name, order_index: l.order_index, cpd_level: l.cpd_level,
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
async function _assertLevelUnlocked(userId, levelId) {
  const { data: levels } = await supabase
    .from('training_levels').select('id, name, order_index').eq('is_active', true).order('order_index');
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
      .select('id, title, order_index, duration_seconds, video_url, audio_url')
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
      .select('id, title, content_html, video_url, audio_url, duration_seconds, order_index, course_id')
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

    // Presign media URLs — video_url and audio_url are full R2 URLs, feeding
    // directly into generatePresignedUrl which validates via isValidR2Url.
    const [videoUrl, audioUrl] = await Promise.all([
      m.video_url ? generatePresignedUrl(m.video_url, 3600) : Promise.resolve(null),
      m.audio_url ? generatePresignedUrl(m.audio_url, 3600) : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      module: {
        id: m.id,
        title: m.title,
        content_html: m.content_html || '',
        video_url: videoUrl,
        audio_url: audioUrl,
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
