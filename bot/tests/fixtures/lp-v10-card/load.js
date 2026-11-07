/**
 * Test loader for the v10 card port: the prototype card (G2 English ch10 seg1, the Python suite's fixture),
 * its v9 must-happen move ids, a v9 skeleton (the anchors, diagram and video markup of the real 1.8 MB v9
 * page, which is too big to commit) and the Python goldens.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const clone = (o) => JSON.parse(JSON.stringify(o));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

const PROTO = JSON.parse(read('proto.card.json'));
const PROTO_GOLDEN = JSON.parse(read('goldens/ict_g2_ch10_English_seg1.golden.json'));

function goldens() {
  return fs.readdirSync(path.join(DIR, 'goldens')).sort()
    .map((f) => JSON.parse(read(path.join('goldens', f))));
}

module.exports = {
  card: () => clone(PROTO),
  clone,
  MUST: PROTO_GOLDEN.must,
  V9: PROTO_GOLDEN.v9Skeleton,
  goldens,
  css: () => read('card.css'),
};
