'use strict';
/** Union of the day rows behind one topic: numeric days/pages sorted, SLOs in first-appearance order. */
const sortedUnique = (nums) => [...new Set(nums)].sort((a, b) => a - b);
const orderedUnique = (items) => [...new Set(items)];

function collect(rows) {
  return {
    days: sortedUnique(rows.map((r) => r.day)),
    pages: sortedUnique(rows.flatMap((r) => r.pages)),
    sloCodes: orderedUnique(rows.flatMap((r) => r.sloCodes)),
    sloDescriptions: orderedUnique(rows.flatMap((r) => r.sloDescriptions)),
  };
}

module.exports = { collect };
