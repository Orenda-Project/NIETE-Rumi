/**
 * Framework Registry
 *
 * Single source of truth for all observation framework modules.
 * Lazy-loads framework modules on first access and caches them.
 *
 * Bead: (Phase 1C)
 */

const { logToFile } = require('../../../utils/logger');

// ─── Lazy loaders ────────────────────────────────────────────────────

const registry = {
  oecd:   () => require('./oecd-framework'),
  hots:   () => require('./hots-framework'),
  teach:  () => require('./teach-framework'),
  fico:   () => require('./fico-framework'),
  // bd-ra8xu.38 — FICO17 v6 (17 ind, C/D/F). No region defaults to it; only the fico_dc_rubric shadow and the
  // coach v6 paths load it by name. Never mixed with V3 'fico' in a total.
  fico17_v6: () => require('./fico17-v6-framework'),
  // Queue #184: FICO 6-12 (FICO-S v1.1), the DC's pre-fill for an ICT grade 6-12 HITL visit; starred indicators excluded.
  fico_s_v1_1: () => require('./fico-s-framework'),
  // Queue #218: FICO-S v1.2 (N/A on C2 and C3, a Couldn't tell line per indicator). One scorer serves both ids.
  fico_s_v1_2: () => require('./fico-s-framework'),
  mewaka: () => require('./mewaka-framework'),
};

// ─── Cache ───────────────────────────────────────────────────────────

const cache = {};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get a framework module by key. Throws if key is unknown.
 * @param {string} key - Framework key (oecd, hots, teach, fico, mewaka)
 * @returns {object} Framework module
 */
function getFramework(key) {
  if (!registry[key]) {
    throw new Error(`Unknown framework: ${key}`);
  }

  if (!cache[key]) {
    cache[key] = registry[key]();
    logToFile(`[framework-registry] Loaded framework: ${key}`);
  }

  return cache[key];
}

/**
 * List all registered framework keys.
 * @returns {string[]}
 */
function listFrameworks() {
  return Object.keys(registry);
}

module.exports = { getFramework, listFrameworks };
