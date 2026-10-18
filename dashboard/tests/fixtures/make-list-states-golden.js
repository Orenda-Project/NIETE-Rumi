// Writes list-states-off-golden.json: every door screen's markup with web_quiz_list_states off (run once on the base).
const fs = require('fs');
const path = require('path');
const { screensFor } = require('../wq-list-states-screens');
const out = {};
for (const lang of ['en', 'ur']) out[lang] = screensFor(lang, {});
fs.writeFileSync(path.join(__dirname, 'list-states-off-golden.json'), `${JSON.stringify(out, null, 1)}\n`);
