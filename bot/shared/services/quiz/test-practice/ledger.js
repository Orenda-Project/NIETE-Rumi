'use strict';
/**
 * The practice door's assignment ledger: one ab_assignment row per child (unit_id = students.id, block = the phone-group
 * key the draw used). A child keeps the first arm recorded. The insert needs the test's ab_card_lock row (foreign key);
 * until that row exists the write is refused, logged and ignored, and the draw (deterministic per phone group) stands in.
 */
const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { TEST_ID } = require('./arm');

const warn = (m) => logToFile(`⚠️ practice_door ledger ${m}`);

async function readArm(studentId) {
  try {
    const { data, error } = await supabase.from('ab_assignment').select('arm')
      .eq('test_id', TEST_ID).eq('unit_id', studentId).maybeSingle();
    if (error) { warn(`read ${error.code || ''}`); return null; }
    return data && typeof data.arm === 'string' ? data.arm : null;
  } catch (e) { warn(`read ${e.message}`); return null; }
}

async function writeArm(studentId, arm, block) {
  try {
    const { error } = await supabase.from('ab_assignment').insert({ test_id: TEST_ID, unit_id: studentId, arm, block });
    if (error) { warn(`write refused ${error.code || ''}`); return false; }
    return true;
  } catch (e) { warn(`write ${e.message}`); return false; }
}

module.exports = { readArm, writeArm };
