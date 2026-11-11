'use strict';
/**
 * Regenerate, then flag (bd-5jmnfj.4.13). A Grade 1-2 FDE paper that does not match its blueprint
 * used to ship silently. It is written once more; a second miss is delivered with a plain note
 * on the paper, so the teacher checks it before printing. Wraps the writer, which stays as it is.
 */

const NOTE_EN = 'Note: this paper does not fully match the FDE blueprint — please check it before printing.';
const NOTE_UR = 'نوٹ: یہ پرچہ FDE بلیو پرنٹ سے مکمل طور پر مطابقت نہیں رکھتا — چھاپنے سے پہلے اسے جانچ لیں۔'; // needs fluent-Urdu review

// Every section carried its own level targets and met them to the mark, and the only misses are
// whole-paper level shares: the pattern's two targets disagree, so a rewrite cannot fix it.
const metEverySection = (bp) => (bp.problems || []).every((p) => p && p.code === 'LEVEL')
  && (bp.sections || []).length > 0
  && bp.sections.every((s) => s.levels && Object.values(s.levels).every((l) => l.marks === l.target));

const offBlueprint = (paper) => {
  const bp = paper && paper.examJson && paper.examJson._layout && paper.examJson._layout.blueprint;
  return !!bp && bp.ok === false && !metEverySection(bp);
};

function flag(paper) {
  const L = paper.examJson._layout;
  const lang = L.medium === 'ur' ? 'ur' : 'en';
  const key = `note_${lang}`;
  const note = lang === 'ur' ? NOTE_UR : NOTE_EN;
  L.header = { ...L.header, [key]: L.header && L.header[key] ? `${L.header[key]} ${note}` : note };
  return paper;
}

async function withBlueprintRetry(write, logToFile = () => {}) {
  const first = await write();
  if (!offBlueprint(first)) return first;
  logToFile('[assessment] off blueprint, regenerating once', { problems: first.examJson._layout.blueprint.problems });
  let second;
  try {
    second = await write();
  } catch (err) {
    logToFile('[assessment] blueprint regeneration failed, delivering the first paper', { error: err.message });
    return flag(first);
  }
  if (!offBlueprint(second)) return second;
  logToFile('[assessment] still off blueprint, delivered with a note', { problems: second.examJson._layout.blueprint.problems });
  return flag(second);
}

module.exports = { withBlueprintRetry, NOTE_EN, NOTE_UR };
