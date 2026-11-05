'use strict';
// The G6-12 registry, in contract order: core rows by band, then the pending rows.
module.exports = [
  ...require('./6_8'),
  ...require('./9_10'),
  ...require('./11_12'),
  ...require('./pending'),
];
