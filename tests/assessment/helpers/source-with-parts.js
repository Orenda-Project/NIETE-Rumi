'use strict';
/**
 * The source text of an assessment module, for a test that checks a call is wired in. A module split
 * under the 300-line limit (bd-5jmnfj.4.52, bd-5jmnfj.37) is an index over a folder of parts; its
 * text is the index and every part, so a wiring check reads the same code wherever the cut put it.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../bot/shared/services/assessment');
// A split module → the folder its parts are in.
const PARTS = {
  'assessment-generation.service.js': 'assessment-generation',
  'assessment-paper-fde.renderer.js': 'fde-renderer',
  'fde-layout.js': 'fde-layout',
  'marking-scheme.js': 'marking-scheme',
  'patterns/fde-g5-2027.js': 'patterns/fde-g5-2027',
};

function sourceWithParts(file) {
  const files = [path.join(DIR, file)];
  const parts = PARTS[file] && path.join(DIR, PARTS[file]);
  if (parts && fs.existsSync(parts)) {
    fs.readdirSync(parts).filter((f) => f.endsWith('.js')).sort().forEach((f) => files.push(path.join(parts, f)));
  }
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

module.exports = { sourceWithParts };
