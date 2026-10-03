'use strict';

/**
 * Child test v2 — the end-of-visit review Flow (bd-s1oo0.46.4). One screen, REVIEW:
 *
 *   heading + one line of instruction
 *   15 static slots, each: "Ayesha Khan · Urdu question 2" (TextSubheading)
 *                          the question or problem as the coach asked it (TextBody)
 *                          "Heard: «…»" over Right / Wrong / Didn't answer (RadioButtonsGroup)
 *   Footer «Save answers» → complete, with every slot's key (k1…k15) and verdict (r1…r15)
 *
 * A slot is shown, and required, only when sendReview fills it (${data.iN_v}). 2 + 15×3 + Footer = 48
 * components, under Meta's 50. Navigate mode: no data_api_version, no endpoint; the message carries the data.
 * Every word is ${data.*} from the catalog, so the coach reads it in their language; the title is the only
 * fixed text, in both.
 *
 * Regenerate the committed copy after any change:  node bot/scripts/generate-child-test-review-flow-json.js
 */

const review = require('./review-view');
const { formItems } = require('./items');

const FLOW_VERSION = '7.3';
const SLOTS = review.MAX_ITEMS;
const TITLE = 'جواب · Answers';

const d = (k) => `\${data.${k}}`;
const OPTION_LIST = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } };

function declare(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    let type;
    if (typeof v === 'boolean') type = { type: 'boolean' };
    else if (Array.isArray(v)) type = OPTION_LIST;
    else type = { type: 'string' };
    out[k] = { ...type, __example__: v };
  }
  return out;
}

/** A synthetic example (no child data): two slots filled, from the Grade 3 Set A bank. */
function exampleData() {
  const items = formItems(3, 'A');
  const entry = { child: { displayName: 'Child A' }, items };
  const q2 = items.urdu.questions[1];
  const examples = [
    { entry, kind: 'question', block: 'urdu', group: 'questions', field: 'questions', number: 2, itemId: q2.id, key: `example|urdu|questions|${q2.id}`, mark: { id: q2.id, verdict: 'wrong', heard: 'پانی', confidence: 0.5 } },
    { entry, kind: 'sum', block: 'maths', group: 'sums', field: 'maths.oral', number: 3, itemId: 'm3A-s3', key: 'example|maths|sums|m3A-s3', mark: { id: 'm3A-s3', prompt: '92 − 41', verdict: 'wrong', heard: '41', confidence: 0.4 } },
  ];
  return review.reviewScreenData('ur', examples, 'rv_example');
}

function slot(i) {
  const v = d(`i${i}_v`);
  return [
    { type: 'TextSubheading', text: d(`i${i}_who`), visible: v },
    { type: 'TextBody', text: d(`i${i}_q`), visible: v },
    {
      type: 'RadioButtonsGroup', name: `r${i}`, label: d('t_mark'), description: d(`i${i}_h`), 'data-source': d('verdicts'), required: v, visible: v,
    },
  ];
}

function buildChildTestReviewFlow() {
  const children = [
    { type: 'TextHeading', text: d('heading') },
    { type: 'TextBody', text: d('intro') },
  ];
  // Flat keys in the complete payload: Meta drops extension_message_response (flow-type-detector.js).
  const payload = { child_test: 'review', review_ref: d('review_ref') };
  for (let i = 1; i <= SLOTS; i += 1) {
    children.push(...slot(i));
    payload[`k${i}`] = d(`i${i}_k`);
    payload[`r${i}`] = `\${form.r${i}}`;
  }
  children.push({ type: 'Footer', label: d('save'), 'on-click-action': { name: 'complete', payload } });
  return {
    version: FLOW_VERSION,
    screens: [{
      id: 'REVIEW',
      title: TITLE,
      terminal: true,
      success: true,
      data: declare(exampleData()),
      layout: { type: 'SingleColumnLayout', children: [{ type: 'Form', name: 'review_form', children }] },
    }],
  };
}

module.exports = { buildChildTestReviewFlow, SLOTS, FLOW_VERSION, TITLE };
