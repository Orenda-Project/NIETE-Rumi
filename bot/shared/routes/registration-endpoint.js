/**
 * Registration Flow Endpoint Handler
 *
 * Handles endpoint-based WhatsApp Flow for user registration.
 * Uses data_api_version 3.0 with encrypted data exchange.
 *
 * v5 (docs/flows/registration-flow-v5.json, bd-x7aprz.2) — what new numbers get:
 *   PERSONAL_INFO {full_name, language} → ROLE_SCHOOL {role, school_query}
 *   → SCHOOL_PICK {school_id | 'none'} → TEACHING {grade, subjects} → SUCCESS
 *   Country and organization are set, not asked; the school is chosen from `schools`
 *   (school-search.service), never typed in. Role: registration-roles.js.
 *
 * v4 below stays served, unchanged in shape, until every environment's Flow is republished:
 * the endpoint ships first, and Meta keeps serving the old asset until the new one is
 * published. The two are told apart on the first submit — v4 sends a country, v5 does not.
 *
 * v4 Flow screens (split-screen + conditional org):
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
const { findSchoolByEmis } = require('../services/schools/school-resolver.service');

/**
 * Persist a completed screen's fields to the user row AS SOON AS the screen is
 * submitted — not at SUCCESS. In production the terminal Flow payload arrives with
 * the earlier screens' values empty (Redis round-trip loses them; verified in
 * niete-logs 2026-09-03: a real teacher's completion had full_name:"" while the
 * last screen's role/school survived), so relying on it drops the name and, on the
 * org="other" path, the role. Writing per screen makes the account correct whatever
 * the terminal payload loses. Only non-empty values are written, so nothing is ever
 * blanked; failure is logged and swallowed — a Redis/DB hiccup must not break the
 * Flow response the teacher is waiting on.
 */
async function persistToUser(userId, cols) {
  const clean = {};
  for (const [k, v] of Object.entries(cols)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    clean[k] = v;
  }
  if (!userId || Object.keys(clean).length === 0) return;
  try {
    const supabase = require('../config/supabase');   // lazy: importing this module must stay side-effect-free
    const { error } = await supabase.from('users').update(clean).eq('id', userId);
    if (error) logToFile('⚠️ registration: per-screen user write failed', { userId, cols: Object.keys(clean), error: error.message });
    else logToFile('✅ registration: per-screen persisted', { userId, cols: Object.keys(clean) });
  } catch (e) {
    logToFile('⚠️ registration: per-screen user write threw', { userId, error: e.message });
  }
}
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

// Which role the form may write is decided in ONE place,
// registration-roles.js roleToWrite(): teacher or principal, and never over a coach or AEO an
// admin set. An unknown/empty value → null (users.role is then left as it is).
const { roleToWrite, formRole, isAdminRole } = require('../config/registration-roles');
const { searchSchools, findPickableSchool } = require('../services/schools/school-search.service');
const { resolveUx, gradeLabelFor, subjectLabelFor } = require('../config/ux-strings');

/** The bits of her row the form pre-fills from and guards on. null when it cannot be read. */
async function readUser(userId) {
  if (!userId) return null;
  try {
    const supabase = require('../config/supabase');   // lazy: importing this module must stay side-effect-free
    const { data, error } = await supabase.from('users')
      .select('id, name, role, preferred_language, language_locked, school_id, organization, grades_taught, subjects_taught')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      logToFile('⚠️ registration: user read failed', { userId, error: error.message }, 'warn');
      return null;
    }
    return data || null;
  } catch (e) {
    logToFile('⚠️ registration: user read threw', { userId, error: e.message }, 'warn');
    return null;
  }
}

/**
 * Mark the account complete AT THE SCREEN THAT ENDS THE FLOW, not at the terminal payload.
 *
 * Both SUCCESS branches below tell the teacher "Your registration is
 * complete." Until now neither wrote `registration_completed` — the flag was set only
 * when the terminal Flow payload later reached flow-response.handler.js
 * (handleRegistrationFlow). That is exactly the payload this file's own header documents
 * as unreliable ("the terminal Flow payload arrives with the earlier screens' values
 * empty… verified in the logs 2026-09-03"), which is why the NAME write was moved
 * per screen. The completion flag was never moved with it, so a teacher whose terminal
 * payload was lost ended registered-in-fact and unregistered-on-the-row.
 *
 * On prod that shows as a 76.7% completion rate over the last 7 days: of 30 named users
 * created in that window, 23 carry the flag. flow-response.handler.js still writes it too
 * — a second write of `true` is a no-op, and losing it there no longer loses the fact.
 */
async function markRegistrationComplete(userId) {
  await persistToUser(userId, {
    registration_completed: true,
    registration_completed_at: new Date().toISOString(),
  });
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

  // bd-x7aprz.2 — pre-filled from her row, so a teacher we partly know (a roster import, a coach
  // added her, a form she left half-way) only fills the gaps. Her language is pre-selected only
  // when SHE chose it (language_locked); the schema default 'en' was never a choice.
  const user = await readUser(userId);
  const chosen = user && user.language_locked ? user.preferred_language : null;

  // ONE first screen serves both published versions: v5 binds full_name + language, v4 (still
  // live on staging/prod until each is republished) binds full_name + country. Meta ignores data
  // a screen does not declare — production v4 has been receiving `languages` it never declared.
  return {
    screen: 'PERSONAL_INFO',
    data: {
      ...personalInfoData(chosen),
      init_full_name: (user && typeof user.name === 'string' && user.name.trim()) || '',
      init_country: 'PK',
    }
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

  // v5 (bd-x7aprz.2)
  if (screen === 'ROLE_SCHOOL') {
    return await handleRoleSchoolSubmit(userId, screenData || {}, flowToken);
  }

  if (screen === 'SCHOOL_PICK') {
    return await handleSchoolPickSubmit(userId, screenData || {}, flowToken);
  }

  if (screen === 'TEACHING') {
    return await handleTeachingSubmit(userId, screenData || {}, flowToken);
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

  // v5 asks no country (every NIETE teacher is in Pakistan), so its first screen sends none.
  // v4 — still published on staging/prod until each is republished — always sends one.
  if (!Object.prototype.hasOwnProperty.call(screenData, 'country')) {
    return await handlePersonalInfoV5(userId, fullName, screenData, flowToken);
  }

  if (!country) {
    return createErrorResponse('Country is required');
  }

  // Clamped, not trusted. A stale published Flow version submits no language at
  // all, and a replayed payload could carry a code this deployment does not
  // serve — either way this must resolve to something offered rather than flow
  // onward as undefined and reach a write.
  const language = clampLanguage(screenData.language || offerDefaultLanguage());

  // Persist name + country to the account NOW (the terminal payload loses them — bd-2480).
  await persistToUser(userId, {
    name: fullName,
    country,
  });

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
  const province = screenData.region || null;

  // The screen has always carried the school's EMIS code (form.emis_code) and this handler
  // dropped it, storing only the province string. The EMIS is the one identifier the code
  // links on (users.school_id -> schools), so resolve it here; the stored region becomes the
  // school's sector, which is what every school-scoped read expects to find in users.region.
  // A miss keeps the old behaviour (province stored, no link) and is logged so it can be counted.
  const emisCode = String(screenData.emis_code == null ? '' : screenData.emis_code).trim();
  let school = null;
  if (emisCode) {
    school = await findSchoolByEmis(emisCode);
    if (!school) {
      logToFile('⚠️ registration: emis_not_found — province stored, no school link', { userId, emis_code: emisCode, province });
    }
  }
  const region = (school && school.region) || province;

  // Get stored data and update with region (+ the school, once known)
  const stored = await getRegData(flowToken);
  stored.region = region;
  if (school) stored.school_id = school.id;
  await storeRegData(flowToken, stored);
  await persistToUser(userId, school ? { region, school_id: school.id } : { region });

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
  const user = await readUser(userId);

  const allData = {
    ...stored,
    organization,
    school_name: (screenData.school_name || '').trim() || null,
    grade: screenData.grade || '',
    subjects: screenData.subjects || [],
    // The selection is carried into the completion payload — only a role the form may
    // grant, and never over an admin-set coach/AEO (registration-roles.js).
    // Her row unreadable → write no role: an unknown current role may be an admin-set coach.
    role: user ? roleToWrite(screenData.role, user.role) : null
  };

  // Persist role + professional fields NOW (org="other" adds ORG_DETAILS after this
  // screen, making it no longer the last screen, so the terminal payload drops the
  // role — bd-2773). Only the role id is validated; empties are skipped in persistToUser.
  await persistToUser(userId, {
    role: allData.role,
    school_name: allData.school_name,
    // users columns are grades_taught / subjects_taught (matching flow-response.handler); NOT
    // grade/subjects — a wrong name makes PostgREST reject the WHOLE update, which dropped the
    // role again on the org="other" path (bd-2773 verify, 2026-09-03: "Could not find the
    // 'subjects' column of 'users'").
    grades_taught: (Array.isArray(allData.grade) ? allData.grade.length : allData.grade) ? allData.grade : undefined,
    subjects_taught: (allData.subjects && allData.subjects.length) ? allData.subjects : undefined,
    organization: organization === 'other' ? undefined : organization,
  });

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

  // Non-"other" org → go directly to SUCCESS. This screen ENDS the flow, so the account
  // is marked complete here rather than waiting on the terminal payload.
  await markRegistrationComplete(userId);
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
  // ORG_DETAILS is the last screen on the org="other" path — mark complete here too.
  await markRegistrationComplete(userId);
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

// --- v5 (bd-x7aprz.2): name + language → role + school search → pick → grades + subjects ---
//
// The operator, 2026-10-16: no Country or Organization question (set automatically), roles
// Teacher / Principal only, the school CHOSEN from the schools table (searched, never typed in
// as free text), and a teacher whose school is not there finishes without one. Every screen
// writes what it collected to her row as it is submitted, as v4 does, so nothing depends on the
// terminal payload. Screens after the first speak the language she picked on it.

const NIETE_ORGANIZATION = 'niete';
const SCHOOL_RESULTS = 10;
const NONE = 'none';

const GRADE_IDS = GRADES_DROPDOWN.map((g) => g.id);
const SUBJECT_IDS = SUBJECTS_DROPDOWN.map((s) => s.id);

// Grade/subject option titles: the class catalog's own labels where it has the code, the
// registration keys where it does not (its codes are the seeded reference set).
const EXTRA_GRADE_KEYS = { higher_secondary: 'regGradeHigherSecondary' };
const EXTRA_SUBJECT_KEYS = {
  islamiat: 'regSubjectIslamiat', physics: 'regSubjectPhysics', chemistry: 'regSubjectChemistry',
  biology: 'regSubjectBiology', social_studies: 'regSubjectSocialPakStudies',
  computer_science: 'regSubjectComputerScience', other: 'regSubjectOther',
};

const ux = (key, language, params) => resolveUx(key, { language, params });
const cut = (s, n) => { const a = [...String(s || '')]; return a.length <= n ? a.join('') : `${a.slice(0, n - 1).join('')}…`; };
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';

function gradeOptions(language) {
  return GRADE_IDS.map((id) => ({
    id,
    title: EXTRA_GRADE_KEYS[id] ? ux(EXTRA_GRADE_KEYS[id], language) : (gradeLabelFor(id, language) || id),
  }));
}

function subjectOptions(language) {
  return SUBJECT_IDS.map((id) => ({
    id,
    title: EXTRA_SUBJECT_KEYS[id] ? ux(EXTRA_SUBJECT_KEYS[id], language) : (subjectLabelFor(id, language) || id),
  }));
}

function roleOptions(language) {
  const KEY = { teacher: 'regFormRoleTeacher', principal: 'regFormRolePrincipal' };
  return ROLES_DROPDOWN.map(({ id }) => ({ id, title: KEY[id] ? ux(KEY[id], language) : id }));
}

/**
 * A school as a radio option. The SAME fields on every row (the NavigationList lesson, whatsapp-flows
 * rule 15): title = the name without its level bracket, cut to Meta's 30; description = the full
 * name, the sector and the EMIS. School names are Latin, so the description is safe from the
 * Urdu-script list-chrome defect.
 */
function schoolOption(s) {
  const short = String(s.name).replace(/\(\s*[ivxlc]+\s*-\s*[ivxlc]+\s*\)/gi, ' ').replace(/\s+/g, ' ').trim() || s.name;
  return {
    id: String(s.id),
    title: cut(short, 30),
    description: cut([s.name, s.region, s.emis ? `EMIS ${s.emis}` : null].filter(Boolean).join(' · '), 300),
  };
}

/**
 * The words a v5 screen shows, in her language. Exported so the caps test can measure every string
 * the endpoint can serve, in both languages, without standing up a Flow.
 */
function screenCopy(screen, language, { query = '', name = '', count = 0 } = {}) {
  const lang = clampLanguage(language);
  if (screen === 'ROLE_SCHOOL') {
    return {
      t_heading: ux('regFormRoleSchoolHeading', lang),
      t_role_label: ux('regFormRoleLabel', lang),
      t_search_label: ux('regFormSearchLabel', lang),
      t_search_help: ux('regFormSearchHelp', lang),
      t_search: ux('regFormSearchButton', lang),
      roles: roleOptions(lang),
    };
  }
  if (screen === 'SCHOOL_PICK') {
    return {
      t_heading: ux('regFormPickHeading', lang),
      t_note: ux(count > 0 ? 'regFormPickNote' : 'regFormPickNothing', lang, { query: cut(query, 40) }),
      t_pick_label: ux('regFormPickLabel', lang),
      t_next: ux('regFormNext', lang),
      none_option: [{ id: NONE, title: ux('regFormPickNone', lang) }],
    };
  }
  if (screen === 'TEACHING') {
    return {
      t_heading: ux('regFormTeachHeading', lang),
      t_note: ux('regFormTeachNote', lang),
      t_grades: ux('regFormGradesLabel', lang),
      t_subjects: ux('regFormSubjectsLabel', lang),
      t_finish: ux('regFormFinish', lang),
      grades: gradeOptions(lang),
      subjects: subjectOptions(lang),
    };
  }
  if (screen === 'SUCCESS') {
    return {
      t_heading: ux('regFormDoneHeading', lang),
      welcome_message: ux('regFormDoneBody', lang, { name: firstName(name) || '🙂' }),
      t_done: ux('regFormDoneButton', lang),
    };
  }
  return {};
}

/** Her language for the screens after the first: what she picked there, else her row. */
async function screenLanguage(stored, user) {
  if (stored && stored.language) return clampLanguage(stored.language);
  return clampLanguage((user && user.language_locked && user.preferred_language) || offerDefaultLanguage());
}

async function roleSchoolResponse(userId, user, language) {
  const current = user && user.school_id ? await findPickableSchool(user.school_id) : null;
  const { roles, ...copy } = screenCopy('ROLE_SCHOOL', language);
  return {
    screen: 'ROLE_SCHOOL',
    data: {
      ...copy,
      roles,
      // An admin-set coach/AEO is not asked: the form cannot change her role, so it does not pretend.
      show_role: !isAdminRole(user && user.role),
      init_role: formRole(user && user.role) || 'teacher',
      // A school already on her row is searched for her, so confirming it is one tap. An initial
      // value is SENT only when there is one — the shape production v4 already runs on.
      ...(current ? { init_query: current.name } : {}),
    },
  };
}

async function handlePersonalInfoV5(userId, fullName, screenData, flowToken) {
  const language = clampLanguage(screenData.language || offerDefaultLanguage());
  const user = await readUser(userId);

  await persistToUser(userId, {
    name: fullName,
    country: 'PK',
    // Organization is no longer asked: the deployment's own, only where the row has none (an
    // organization a roster import set is kept).
    organization: user && user.organization ? undefined : NIETE_ORGANIZATION,
  });

  // She chose it — through the ONE writer, locked, so a later recording cannot flip it.
  try {
    const { setUserLanguage } = require('../utils/language-cache');
    const ok = await setUserLanguage(userId, language, true);
    if (!ok) logToFile('⚠️ registration: language write rejected', { userId, language }, 'warn');
  } catch (e) {
    logToFile('⚠️ registration: language write threw', { userId, language, error: e.message }, 'warn');
  }

  await storeRegData(flowToken, { v: 5, full_name: fullName, language });
  const response = await roleSchoolResponse(userId, user, language);
  logToFile('📤 PERSONAL_INFO → ROLE_SCHOOL (v5)', { userId, language, showRole: response.data.show_role });
  return response;
}

async function handleRoleSchoolSubmit(userId, screenData, flowToken) {
  const stored = await getRegData(flowToken);
  const user = await readUser(userId);
  const language = await screenLanguage(stored, user);

  // Her row unreadable → write no role: an unknown current role may be an admin-set coach.
  const role = user ? roleToWrite(screenData.role, user.role) : null;
  if (role) await persistToUser(userId, { role });
  else if (screenData.role) logToFile('📝 registration: role not written', { userId, submitted: String(screenData.role).slice(0, 20), existing: user && user.role });

  const query = String(screenData.school_query || '').trim().slice(0, 80);
  const results = await searchSchools(query, { limit: SCHOOL_RESULTS });
  logToFile('🔎 registration: school search', { userId, query, results: results.length });

  await storeRegData(flowToken, { ...stored, role: role || stored.role || null, school_query: query });

  const { none_option: noneOption, ...copy } = screenCopy('SCHOOL_PICK', language, { query, count: results.length });
  const schools = [...results.map(schoolOption), ...noneOption];
  const mine = user && user.school_id && results.some((s) => String(s.id) === String(user.school_id));
  return {
    screen: 'SCHOOL_PICK',
    data: { ...copy, schools, ...(mine ? { init_school: String(user.school_id) } : {}) },
  };
}

function idsFrom(value, allowed) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (_) { list = list.split(','); }
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((x) => String(x == null ? '' : x).trim()).filter((x) => allowed.includes(x)))];
}

async function handleSchoolPickSubmit(userId, screenData, flowToken) {
  const stored = await getRegData(flowToken);
  const user = await readUser(userId);
  const language = await screenLanguage(stored, user);

  const picked = String(screenData.school_id || '').trim();
  let schoolId = null;
  if (picked && picked !== NONE) {
    // Never trust the id the phone sends: it must be a real, non-test school.
    const school = await findPickableSchool(picked);
    if (school) {
      schoolId = school.id;
      // The school's sector is what every school-scoped read expects in users.region (bd-z8p96).
      await persistToUser(userId, { school_id: school.id, region: school.region || undefined });
    } else {
      logToFile('⚠️ registration: picked school is not pickable — nothing stored', { userId, picked: picked.slice(0, 40) }, 'warn');
    }
  }
  await storeRegData(flowToken, { ...stored, school_id: schoolId || (picked === NONE ? null : stored.school_id || null) });

  const { grades, subjects, ...copy } = screenCopy('TEACHING', language);
  const initGrades = idsFrom(user && user.grades_taught, GRADE_IDS);
  const initSubjects = idsFrom(user && user.subjects_taught, SUBJECT_IDS);
  return {
    screen: 'TEACHING',
    data: {
      ...copy,
      grades,
      subjects,
      ...(initGrades.length ? { init_grades: initGrades } : {}),
      ...(initSubjects.length ? { init_subjects: initSubjects } : {}),
    },
  };
}

async function handleTeachingSubmit(userId, screenData, flowToken) {
  const stored = await getRegData(flowToken);
  const user = await readUser(userId);
  const language = await screenLanguage(stored, user);

  const grades = idsFrom(screenData.grade, GRADE_IDS);
  const subjects = idsFrom(screenData.subjects, SUBJECT_IDS);
  await persistToUser(userId, {
    grades_taught: grades.length ? grades : undefined,
    subjects_taught: subjects.length ? subjects : undefined,
  });

  // This screen ENDS the flow: the account is complete here, whatever the terminal payload does.
  await markRegistrationComplete(userId);
  await deleteRegData(flowToken);

  const fullName = stored.full_name || (user && user.name) || '';
  const schoolLinked = Boolean(stored.school_id || (user && user.school_id));
  const response = {
    screen: 'SUCCESS',
    data: {
      ...screenCopy('SUCCESS', language, { name: fullName }),
      // Flat, as every working completion in this repo is (roster-flow-v1 notes): the chat ack
      // finds these on the nfm_reply and needs nothing else.
      registration_action: 'complete',
      flow_token: String(flowToken || ''),
      full_name: fullName,
      language,
      school_linked: schoolLinked ? 'yes' : 'no',
    },
  };
  logToFile('📤 TEACHING → SUCCESS (v5)', { userId, grades: grades.length, subjects: subjects.length, schoolLinked });
  return response;
}

// --- Redis helpers ---

async function storeRegData(flowToken, data) {
  try {
    // Stored as JSON text; get() hands it back already parsed (see getRegData).
    await redisService.set(`${REDIS_PREFIX}${flowToken}`, JSON.stringify(data), REDIS_TTL);
  } catch (error) {
    logToFile('⚠️ Redis store failed for registration', { flowToken, error: error.message });
  }
}

/**
 * The state saved by the earlier screens.
 *
 * railway-redis.service get() ALREADY JSON-parses what it reads. This used to parse again, so
 * JSON.parse(object) threw '"[object Object]" is not valid JSON' and every read returned {} —
 * 403 times in 30 days in niete-logs, every day: the SUCCESS card greeted "Teacher", BACK lost
 * the region screen, and the terminal payload arrived with the earlier screens empty (which the
 * per-screen writes were added to survive). A string is still parsed, for a value written raw.
 */
async function getRegData(flowToken) {
  try {
    const value = await redisService.get(`${REDIS_PREFIX}${flowToken}`);
    if (!value) return {};
    if (typeof value === 'object') return value;
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
  createErrorResponse,
  screenCopy,
};
