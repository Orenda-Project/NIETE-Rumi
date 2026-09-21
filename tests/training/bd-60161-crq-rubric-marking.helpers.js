/**
 * Shared capture state for bd-60161-crq-rubric-marking.test.js.
 *
 * A jest.mock factory is hoisted above the file's own variables and may not
 * close over them, so the captured payloads and the canned reply live here
 * where both the factory and the test can reach them.
 */
const __sent = [];
let __replyValue = {};
module.exports = {
  __sent,
  __reply: () => __replyValue,
  __setReply: (v) => { __replyValue = v; },
};
