'use strict';
/**
 * A table-driven supabase double for the teacher /quiz menu tests. Every read
 * is recorded ({table, op, filters}) so a test can assert how many round-trips
 * a page cost (one per table, never one per quiz).
 *
 * Built on the shared table double, so every filter the product sends applies
 * (an unknown one throws) and a write answers the rows it wrote.
 */
const { tableDouble } = require('../../helpers/table-double');

function fakeDb(tables = {}) {
  return tableDouble(tables);
}

module.exports = { fakeDb };
