/**
 * Prioritized Action Service
 *
 * Generates a single, actionable teaching improvement tip based on
 * the coaching analysis and framework context.
 *
 * Bead: (Phase 1C-C)
 */

const { logToFile } = require('../../../utils/logger');

/**
 * Extract every candidate indicator from the analysis, normalized to a
 * common shape. This is the per-framework SHAPE step — it does NOT decide
 * which indicator to target; selection is delegated to a swappable policy
 * (see selectFocusIndicator).
 *
 * @param {object} analysis - Framework analysis data
 * @returns {Array<{ name: string, score: number, maxScore: number, areaName: string, id: string }>}
 */
function extractIndicators(analysis) {
  const indicators = [];

  // HOTS: areas → indicators (score 1-3)
  if (analysis.areas) {
    for (const [areaKey, area] of Object.entries(analysis.areas)) {
      if (!area?.indicators) continue;
      for (const ind of area.indicators) {
        indicators.push({ name: ind.name, score: ind.score, maxScore: 3, areaName: areaKey, id: ind.id });
      }
    }
  }

  // Teach: areas → elements (holistic_score 1-5)
  if (analysis.areas) {
    for (const [areaKey, area] of Object.entries(analysis.areas)) {
      if (!area?.elements) continue;
      for (const el of area.elements) {
        indicators.push({ name: el.name, score: el.holistic_score, maxScore: 5, areaName: areaKey, id: `E${el.id}` });
      }
    }
  }

  // FICO: domains → indicators (score 1-4)
  if (analysis.domains) {
    for (const [domainKey, domain] of Object.entries(analysis.domains)) {
      if (!domain?.indicators) continue;
      for (const ind of domain.indicators) {
        indicators.push({ name: ind.name, score: ind.score, maxScore: 4, areaName: domainKey, id: ind.id });
      }
    }
  }

  // OECD: goal*_* → criteria
  for (const [key, goal] of Object.entries(analysis)) {
    if (!key.startsWith('goal') || !goal || typeof goal !== 'object') continue;
    for (const [critKey, crit] of Object.entries(goal)) {
      if (!crit?.computed_marks && crit?.computed_marks !== 0) continue;
      indicators.push({ name: critKey.replace(/_/g, ' '), score: crit.computed_marks, maxScore: crit.max_marks, areaName: key, id: critKey });
    }
  }

  return indicators;
}

/**
 * Selection policies decide which indicator a coaching card targets.
 * Each policy is a pure function (indicators[]) → indicator|null. Adding a
 * new strategy (e.g. 'strongest', 'most-impactful') means adding a named
 * entry here — the call site stays the same.
 *
 * 'weakest' preserves the historical behavior: pick the lowest score/maxScore
 * ratio, with the first-seen indicator winning ties (matches the original
 * strict-less-than scan order over HOTS → Teach → FICO → OECD).
 */
const SELECTION_POLICIES = {
  weakest(indicators) {
    let weakest = null;
    for (const ind of indicators) {
      if (!weakest || (ind.score / ind.maxScore) < (weakest.score / weakest.maxScore)) {
        weakest = ind;
      }
    }
    return weakest;
  },
};

const DEFAULT_SELECTION_POLICY = 'weakest';

/**
 * Select the focus indicator from a list of candidates using a named,
 * swappable policy. This is the SELECTION seam — distinct from the
 * per-framework shape extraction in extractIndicators.
 *
 * @param {Array} indicators - Normalized indicators from extractIndicators
 * @param {string|function} [policy='weakest'] - Policy name or a custom
 *   (indicators[]) → indicator|null function
 * @returns {object|null} The selected indicator, or null
 */
function selectFocusIndicator(indicators, policy = DEFAULT_SELECTION_POLICY) {
  if (!Array.isArray(indicators) || indicators.length === 0) return null;
  const selector = typeof policy === 'function' ? policy : SELECTION_POLICIES[policy];
  if (!selector) {
    logToFile('Unknown focus-indicator policy, falling back to default', { policy });
    return SELECTION_POLICIES[DEFAULT_SELECTION_POLICY](indicators);
  }
  return selector(indicators);
}

/**
 * Find the weakest indicator from the analysis to target for improvement.
 * Thin wrapper preserved for backward compatibility — composes the
 * extract + select seams with the default 'weakest' policy.
 *
 * @param {object} analysis - Framework analysis data
 * @returns {{ name: string, score: number, maxScore: number, areaName: string }|null}
 */
function findWeakestIndicator(analysis) {
  return selectFocusIndicator(extractIndicators(analysis), 'weakest');
}

/**
 * Generate a prioritized teaching action from analysis data.
 * Does NOT call LLM — uses rule-based generation for reliability and speed.
 *
 * @param {object} analysis - Framework analysis from GPT
 * @param {string} teacherName - Teacher's first name
 * @param {object} [priorAction] - Previous session's prioritized action (if any)
 * @returns {Promise<{action: string, example: string, indicator: string}|null>}
 */
async function generatePrioritizedAction(analysis, teacherName, priorAction = null) {
  if (!analysis) return null;

  try {
    const weakest = findWeakestIndicator(analysis);
    if (!weakest) {
      logToFile('No weak indicator found for coaching card', { framework: analysis.framework });
      return {
        action: `Continue building on your strengths, ${teacherName}. Focus on one area where you want to grow.`,
        example: 'Set a personal goal before your next class and reflect on it afterward.',
        indicator: 'General improvement',
      };
    }

    const framework = analysis.framework || 'oecd';
    const percentage = Math.round((analysis.scores?.overall_percentage || 0));

    // Build progressive action if teacher committed last time
    let progressivePrefix = '';
    if (priorAction?.teacher_response === 'yes') {
      progressivePrefix = `Building on your last commitment: `;
    }

    // Generate framework-appropriate action
    const action = `${progressivePrefix}Focus on "${weakest.name}" — currently ${weakest.score}/${weakest.maxScore}. Try one specific improvement in your next class.`;

    // Generate concrete example based on indicator type
    const example = generateExample(weakest, teacherName);

    return {
      action,
      example,
      indicator: `${weakest.name} (${weakest.id})`,
    };
  } catch (error) {
    logToFile('Error generating prioritized action', { error: error.message });
    return null;
  }
}

/**
 * Generate a concrete teaching example for the weakest indicator.
 */
function generateExample(indicator, teacherName) {
  const name = indicator.name.toLowerCase();

  if (name.includes('question') || name.includes('bloom') || name.includes('cognitive')) {
    return `${teacherName}, instead of asking "Do you understand?", try: "Can you explain WHY this works in your own words?"`;
  }
  if (name.includes('feedback') || name.includes('assessment')) {
    return `${teacherName}, after a student answers, try: "Good start! Can you add one more detail to make it even better?"`;
  }
  if (name.includes('collaborat') || name.includes('peer') || name.includes('group') || name.includes('social')) {
    return `${teacherName}, pair students up for 3 minutes to discuss: "Tell your partner one thing you learned and one question you still have."`;
  }
  if (name.includes('differentiat') || name.includes('scaffold')) {
    return `${teacherName}, prepare two versions of the next activity: a simpler one and a challenge version. Let students choose.`;
  }
  if (name.includes('material') || name.includes('resource') || name.includes('visibility')) {
    return `${teacherName}, before class, write the main learning goal on the board where all students can see it throughout the lesson.`;
  }
  if (name.includes('autonomy') || name.includes('choice') || name.includes('volunteer')) {
    return `${teacherName}, give students 2-3 choices for how to complete the next activity (e.g., draw, write, or present).`;
  }
  if (name.includes('perseverance') || name.includes('effort') || name.includes('goal')) {
    return `${teacherName}, at the start of class, ask each student to set one small goal: "Today I want to learn..." and check at the end.`;
  }

  // Default
  return `${teacherName}, try dedicating 5 minutes of your next class specifically to improving "${indicator.name}".`;
}

module.exports = {
  generatePrioritizedAction,
  findWeakestIndicator,
  extractIndicators,
  selectFocusIndicator,
  SELECTION_POLICIES,
};
