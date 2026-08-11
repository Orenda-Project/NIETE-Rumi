/**
 * Registration Flow Endpoint Handler
 *
 * Handles endpoint-based WhatsApp Flow for user registration.
 * Uses data_api_version 3.0 with encrypted data exchange.
 *
 * Flow screens (split-screen + conditional org):
 *   PERSONAL_INFO → REGION_INFO (if PK) → PROFESSIONAL_INFO → SUCCESS (if org != "other")
 *   PERSONAL_INFO → REGION_INFO (if PK) → PROFESSIONAL_INFO → ORG_DETAILS → SUCCESS (if org == "other")
 *   PERSONAL_INFO → PROFESSIONAL_INFO (if not PK) → SUCCESS
 *   PERSONAL_INFO → PROFESSIONAL_INFO (if not PK) → ORG_DETAILS → SUCCESS (if org == "other")
 *
 * PERSONAL_INFO: full_name, country, language
 *   Endpoint provides: countries + languages (data-sources), init_language
 *
 * REGION_INFO: region (only for Pakistan users)
 *   Endpoint provides: regions (dropdown data-source)
 *
 * PROFESSIONAL_INFO: organization, organization_other, school_name, grade, subjects
 *   Endpoint provides: organizations, grades, subjects (dropdown data-sources)
 *
 * SUCCESS: terminal screen
 *   Endpoint provides: welcome_message, portal_message, extension_message_response
 *
 * Key patterns (learned from attendance endpoint bugs):
 * - Response format: {screen, data} ONLY - NO version field
 * - BACK must return ALL declared data fields with values
 * - Check both INIT and init for action names
 * - handlePing returns {data: {status: 'active'}}
 * - Log full JSON responses for debugging
 *
 * Updated: February 16, 2026
 */

const { logToFile } = require('../utils/logger');
const redisService = require('../services/cache/railway-redis.service');
const { getOfferedLanguages, offerDefaultLanguage } = require('../config/languages');
const { clampLanguage } = require('../config/ux-strings');
const {
  COUNTRIES_DROPDOWN,
  REGIONS_DROPDOWN,
  ORGANIZATIONS_DROPDOWN,
  GRADES_DROPDOWN,
  SUBJECTS_DROPDOWN,
  ROLES_DROPDOWN
} = require('../config/registration-data');

const REDIS_PREFIX = 'reg_flow:';
const REDIS_TTL = 3600; // 1 hour

// bd-2404 — valid role ids the registration Flow can submit. Mirrors
// ROLES_DROPDOWN and maps 1:1 to users.role; the /observe LEADER_ROLES gate
// accepts coach/principal/aeo. Any unknown/empty value → null (the downstream
// handler then leaves users.role untouched, defaulting to teacher).
const VALID_ROLE_IDS = new Set(ROLES_DROPDOWN.map(r => r.id)); // teacher, coach, principal, aeo
function normalizeRole(raw) {
  const v = String(raw || '').toLowerCase().trim();
  return VALID_ROLE_IDS.has(v) ? v : null;
}

/**
 * Build the "Your portal is ready at <host>" line for the SUCCESS screen.
 * Returns just the welcome line if PORTAL_URL is unset, so cloners running
 * without a portal don't render a broken example-host string.
 */
function _buildPortalReadyMessage() {
  const { portalUrl } = require('../config/branding');
  const portal = portalUrl();
  if (!portal) return 'Your portal will be available soon.';
  // Strip protocol for readability in the WhatsApp Flow success card.
  const host = portal.replace(/^https?:\/\//, '');
  return `Your portal is ready at ${host}`;
}

/**
 * The PERSONAL_INFO screen's data payload.
 *
 * Extracted because FOUR code paths return this screen — INIT plus three BACK
 * routes — and each previously built the payload itself. Adding the language
 * question to only the INIT copy would have left the radio group with an empty
 * data-source on every back-navigation: the exact "the twenty-fourth site will
 * differ" failure this workstream keeps removing. One builder, four callers.
 *
 * @param {string} [currentLanguage] preserve her selection across BACK, so
 *   stepping back does not silently reset the answer to the default.
 */
function personalInfoData(currentLanguage) {
  return {
    countries: COUNTRIES_DROPDOWN,
    // Ask for the language up front, on the first screen she sees. Not asking is
    // the root cause of the whole language audit: 99.6% of teachers hold a
    // language nobody ever offered them, because this flow wrote eleven fields to
    // the users row and preferred_language was not one of them.
    //
    // Titles come from the registry, each in its own script, because she has not
    // told us her language yet — an English-only label is unreadable to exactly
    // the teachers most likely to want Urdu.
    languages: getOfferedLanguages().map(({ code, settingsTitle }) => ({
      id: code,
      title: settingsTitle,
    })),
    // Pre-selected so a teacher who taps straight through still lands on the
    // language ICT actually teaches in, rather than on the schema's English.
    init_language: clampLanguage(currentLanguage || offerDefaultLanguage()),
  };
}

/**
 * Handle INIT action - return PERSONAL_INFO screen with country dropdown only
 * Region is now on a separate screen, not included in INIT
 */
async function handleRegistrationInit(userId) {
  logToFile('📝 Registration flow INIT', { userId });

  return {
    screen: 'PERSONAL_INFO',
    data: personalInfoData()
  };
}

/**
 * Handle data_exchange for registration screens
 */
async function handleRegistrationDataExchange(userId, screen, screenData, flowToken) {
  logToFile('📝 Registration flow data_exchange', {
    userId,
    screen,
    screenDataKeys: Object.keys(screenData || {}),
    screenData
  });

  if (screen === 'PERSONAL_INFO') {
    return await handlePersonalInfoSubmit(userId, screenData, flowToken);
  }

  if (screen === 'REGION_INFO') {
    return await handleRegionInfoSubmit(userId, screenData, flowToken);
  }

  if (screen === 'PROFESSIONAL_INFO') {
    return await handleProfessionalInfoSubmit(userId, screenData, flowToken);
  }

  if (screen === 'ORG_DETAILS') {
    return await handleOrgDetailsSubmit(userId, screenData, flowToken);
  }

  logToFile('⚠️ Unknown screen in registration flow', { screen });
  return createErrorResponse('Unknown screen');
}

/**
 * Handle PERSONAL_INFO screen submission
 * Split-screen routing - PK goes to REGION_INFO, others skip to PROFESSIONAL_INFO
 */
async function handlePersonalInfoSubmit(userId, screenData, flowToken) {
  const fullName = (screenData.full_name || '').trim();
  const country = screenData.country || '';

  if (!fullName) {
    return createErrorResponse('Name is required');
  }

  if (!country) {
    return createErrorResponse('Country is required');
  }

  // Clamped, not trusted. A stale published Flow version submits no language at
  // all, and a replayed payload could carry a code this deployment does not
  // serve — either way this must resolve to something offered rather than flow
  // onward as undefined and reach a write.
  const language = clampLanguage(screenData.language || offerDefaultLanguage());

  // Store partial registration data in Redis (region not collected yet)
  const regData = {
    full_name: fullName,
    country,
    region: null,
    language
  };
  await storeRegData(flowToken, regData);

  // Route based on country
  if (country === 'PK') {
    // Pakistan users → REGION_INFO screen
    const response = {
      screen: 'REGION_INFO',
      data: {
        regions: REGIONS_DROPDOWN
      }
    };

    logToFile('📤 PERSONAL_INFO → REGION_INFO (PK user)', {
      userId, country, response: JSON.stringify(response)
    });

    return response;
  }

  // Non-PK users → skip directly to PROFESSIONAL_INFO
  const response = {
    screen: 'PROFESSIONAL_INFO',
    data: {
      organizations: ORGANIZATIONS_DROPDOWN,
      grades: GRADES_DROPDOWN,
      subjects: SUBJECTS_DROPDOWN,
      roles: ROLES_DROPDOWN
    }
  };

  logToFile('📤 PERSONAL_INFO → PROFESSIONAL_INFO (non-PK, skipping region)', {
    userId, country, response: JSON.stringify(response)
  });

  return response;
}

/**
 * Handle REGION_INFO screen submission (new screen for PK users)
 * Updates Redis with selected region, navigates to PROFESSIONAL_INFO
 */
async function handleRegionInfoSubmit(userId, screenData, flowToken) {
  const region = screenData.region || null;

  // Get stored data and update with region
  const stored = await getRegData(flowToken);
  stored.region = region;
  await storeRegData(flowToken, stored);

  const response = {
    screen: 'PROFESSIONAL_INFO',
    data: {
      organizations: ORGANIZATIONS_DROPDOWN,
      grades: GRADES_DROPDOWN,
      subjects: SUBJECTS_DROPDOWN,
      roles: ROLES_DROPDOWN
    }
  };

  logToFile('📤 REGION_INFO → PROFESSIONAL_INFO', {
    userId, region, response: JSON.stringify(response)
  });

  return response;
}

/**
 * Handle PROFESSIONAL_INFO screen submission
 * Organization is mandatory. If org is "other", navigate to ORG_DETAILS.
 * Otherwise, go directly to SUCCESS.
 */
async function handleProfessionalInfoSubmit(userId, screenData, flowToken) {
  const organization = screenData.organization || '';

  // Organization is mandatory
  if (!organization) {
    return createErrorResponse('Organization is required');
  }

  const stored = await getRegData(flowToken);

  const allData = {
    ...stored,
    organization,
    school_name: (screenData.school_name || '').trim() || null,
    grade: screenData.grade || '',
    subjects: screenData.subjects || [],
    // bd-2404: the PROFESSIONAL_INFO screen serves a `roles` dropdown
    // (Teacher/Coach/Principal/AEO). The selection MUST be carried into the
    // completion payload — without it the coach's role is dropped and
    // /observe is denied (they fall into the teacher DC flow). Validate
    // against the known ids so only a real role id round-trips.
    role: normalizeRole(screenData.role)
  };

  // If org is "other", navigate to ORG_DETAILS for custom org name
  if (organization === 'other') {
    await storeRegData(flowToken, allData);

    const response = {
      screen: 'ORG_DETAILS',
      data: {}
    };

    logToFile('📤 PROFESSIONAL_INFO → ORG_DETAILS (org=other)', {
      userId, response: JSON.stringify(response)
    });

    return response;
  }

  // Non-"other" org → go directly to SUCCESS
  await deleteRegData(flowToken);

  const response = {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token: flowToken,
          full_name: allData.full_name || '',
          country: allData.country || '',
          region: allData.region || null,
          organization: allData.organization || null,
          organization_other: null,
          school_name: allData.school_name || null,
          grade: allData.grade || '',
          subjects: allData.subjects || [],
          role: allData.role || null, // bd-2404
          // Her language choice, carried to the terminal payload so the
          // completion handler can WRITE it and greet her in it.
          language: clampLanguage(allData.language || offerDefaultLanguage())
        }
      },
      welcome_message: `Welcome, ${allData.full_name || 'Teacher'}! Your registration is complete.`,
      portal_message: _buildPortalReadyMessage()
    }
  };

  logToFile('📤 PROFESSIONAL_INFO → SUCCESS', {
    userId, allData, response: JSON.stringify(response)
  });

  return response;
}

/**
 * Handle ORG_DETAILS screen submission
 * Collects custom organization name when user selected "Other".
 * Combines with stored data from Redis and returns SUCCESS.
 */
async function handleOrgDetailsSubmit(userId, screenData, flowToken) {
  const organizationOther = (screenData.organization_other || '').trim();

  // Custom org name is mandatory when "Other" is selected
  if (!organizationOther) {
    return createErrorResponse('Please enter your organization name');
  }

  const stored = await getRegData(flowToken);
  await deleteRegData(flowToken);

  const response = {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token: flowToken,
          full_name: stored.full_name || '',
          country: stored.country || '',
          region: stored.region || null,
          organization: stored.organization || 'other',
          organization_other: organizationOther,
          school_name: stored.school_name || null,
          grade: stored.grade || '',
          subjects: stored.subjects || [],
          role: stored.role || null, // bd-2404
          language: clampLanguage(stored.language || offerDefaultLanguage())
        }
      },
      welcome_message: `Welcome, ${stored.full_name || 'Teacher'}! Your registration is complete.`,
      portal_message: _buildPortalReadyMessage()
    }
  };

  logToFile('📤 ORG_DETAILS → SUCCESS', {
    userId, organizationOther, response: JSON.stringify(response)
  });

  return response;
}

/**
 * Handle BACK navigation between screens
 * Updated for split-screen routing
 * Added ORG_DETAILS → PROFESSIONAL_INFO
 */
async function handleRegistrationBack(userId, screen, flowToken) {
  logToFile('📝 Registration flow BACK', { userId, screen });

  // BACK from ORG_DETAILS → PROFESSIONAL_INFO
  if (screen === 'ORG_DETAILS') {
    return {
      screen: 'PROFESSIONAL_INFO',
      data: {
        organizations: ORGANIZATIONS_DROPDOWN,
        grades: GRADES_DROPDOWN,
        subjects: SUBJECTS_DROPDOWN,
      roles: ROLES_DROPDOWN
      }
    };
  }

  if (screen === 'REGION_INFO') {
    // REGION_INFO → back to PERSONAL_INFO. Her stored answer is re-read so that
    // stepping back does not silently reset the language she already picked.
    const stored = await getRegData(flowToken);
    return {
      screen: 'PERSONAL_INFO',
      data: personalInfoData(stored && stored.language)
    };
  }

  if (screen === 'PROFESSIONAL_INFO') {
    // Check if user is PK → go back to REGION_INFO, else → PERSONAL_INFO
    const stored = await getRegData(flowToken);

    if (stored.country === 'PK') {
      return {
        screen: 'REGION_INFO',
        data: {
          regions: REGIONS_DROPDOWN
        }
      };
    }

    // Non-PK user → back to PERSONAL_INFO
    return {
      screen: 'PERSONAL_INFO',
      data: personalInfoData(stored && stored.language)
    };
  }

  // Default: go to PERSONAL_INFO
  return {
    screen: 'PERSONAL_INFO',
    data: personalInfoData()
  };
}

// --- Redis helpers ---

async function storeRegData(flowToken, data) {
  try {
    await redisService.set(`${REDIS_PREFIX}${flowToken}`, JSON.stringify(data), REDIS_TTL);
  } catch (error) {
    logToFile('⚠️ Redis store failed for registration', { flowToken, error: error.message });
  }
}

async function getRegData(flowToken) {
  try {
    const raw = await redisService.get(`${REDIS_PREFIX}${flowToken}`);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    logToFile('⚠️ Redis get failed for registration', { flowToken, error: error.message });
    return {};
  }
}

async function deleteRegData(flowToken) {
  try {
    await redisService.set(`${REDIS_PREFIX}${flowToken}`, '{}', 1);
  } catch (error) {
    logToFile('⚠️ Redis delete failed for registration', { flowToken, error: error.message });
  }
}

// --- Error helper ---

function createErrorResponse(message) {
  return {
    data: {
      error: { message }
    }
  };
}

module.exports = {
  handleRegistrationInit,
  handleRegistrationDataExchange,
  handleRegistrationBack,
  createErrorResponse
};
