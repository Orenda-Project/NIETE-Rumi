'use strict';
/**
 * The training-video catalogue the engine reads (bd-gzfdu9): a versioned JSON data file built by
 * bot/scripts/video-reco/build-catalog.js from the VIDREC team's contracts/catalog.json. No DB rows,
 * no transcripts — module and chapter (segment) fields only. Loaded once, synchronously, and cached.
 */
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../../data/video-catalog.v1.json');
// R9 (bd-tp4w7n.1): lib's catalogue v2 chapters the aligned picks may use (kind, shows, quality.usable), built by
// build-catalog.js --v2. Read only by aligned mode and as the fallback of a v1 miss below.
const DATA_FILE_V2 = path.join(__dirname, '../../../data/video-catalog.v2.json');

function fromData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const modules = Array.isArray(d.modules) ? d.modules : [];
  const bySeg = new Map();
  for (const module of modules) {
    for (const segment of (Array.isArray(module.segments) ? module.segments : [])) {
      if (segment && segment.seg_id) bySeg.set(String(segment.seg_id), { module, segment });
    }
  }
  return {
    version: typeof d.version === 'string' ? d.version : null,
    framework: d.framework || null,
    aliases: d.indicator_aliases && typeof d.indicator_aliases === 'object' ? d.indicator_aliases : {},
    holes: Array.isArray(d.holes) ? d.holes : [], // v4 ids with no strength-2 chapter (catalog.meta.json, m-catalog + ped-panel)
    modules,
    segment(segId) {
      return (segId !== null && segId !== undefined && bySeg.get(String(segId))) || null;
    },
  };
}

let cached = null;
function load() {
  if (!cached) cached = fromData(require(DATA_FILE)); // eslint-disable-line global-require, import/no-dynamic-require
  return cached;
}

let cachedV2 = null;
/** The v2 file, or an empty catalogue when it is absent or unreadable (never throws). */
function loadV2() {
  if (!cachedV2) {
    try { cachedV2 = fromData(require(DATA_FILE_V2)); } catch (e) { cachedV2 = fromData({}); } // eslint-disable-line global-require, import/no-dynamic-require
  }
  return cachedV2;
}

/** A chapter by seg id: the v1 file first (unchanged), then v2, so the send / strip / portal surfaces resolve an aligned pick. */
function segment(segId) {
  return load().segment(segId) || loadV2().segment(segId);
}

function version() {
  return load().version;
}

module.exports = { load, loadV2, fromData, segment, version, DATA_FILE, DATA_FILE_V2 };
