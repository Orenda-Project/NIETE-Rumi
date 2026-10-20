'use strict';
/**
 * The training-video catalogue the engine reads (bd-gzfdu9): a versioned JSON data file built by
 * bot/scripts/video-reco/build-catalog.js from the VIDREC team's contracts/catalog.json. No DB rows,
 * no transcripts — module and chapter (segment) fields only. Loaded once, synchronously, and cached.
 */
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../../data/video-catalog.v1.json');

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

function segment(segId) {
  return load().segment(segId);
}

function version() {
  return load().version;
}

module.exports = { load, fromData, segment, version, DATA_FILE };
