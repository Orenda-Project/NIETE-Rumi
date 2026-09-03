/**
 * aws-sdk (v2) stub for the root test suite.
 *
 * `bot/shared/services/queue/sqs-queue.service.js` requires it at MODULE SCOPE, and the package
 * is a `bot/` dependency — but CI runs the root suite BEFORE `bot/ npm ci`. So any root suite
 * whose require chain reaches the SQS driver dies on an unresolved module instead of on its own
 * assertions, and takes the whole suite FILE with it.
 *
 * That chain is shorter than it looks: `text-message.handler.js` requires
 * `lesson-plan-queue.service`, which requires `./queue`, which loads the SQS driver. Any suite
 * that loads the real text handler therefore needs this — which is why the handler's existing
 * sibling suite asserts against SOURCE TEXT rather than loading the module. Source-text assertions
 * cannot catch a wiring bug that only exists at runtime, so this stub buys back the ability to
 * execute the handler in a test.
 *
 * Same case and same fix as the axios, form-data, pino, exceljs, canvas and @aws-sdk/client-s3
 * stubs beside it.
 *
 * The surface is deliberately the whole of what the bot actually touches — `AWS.config.update()`
 * and `new AWS.SQS()` — and no more. `SQS` RECORDS its calls rather than no-opping, so a test can
 * assert what would have been enqueued without the dependency present.
 */

const calls = [];

/** Every SQS method the queue driver uses, in the v2 `.promise()` shape. */
function makeSqsMethod(name) {
  return (params) => {
    calls.push({ method: name, params });
    return {
      promise: () => Promise.resolve(
        name === 'sendMessage' ? { MessageId: `stub-${calls.length}` }
          : name === 'receiveMessage' ? { Messages: [] }
            : {},
      ),
    };
  };
}

class SQS {
  constructor(config) {
    this.config = config;
    for (const m of [
      'sendMessage', 'sendMessageBatch', 'receiveMessage', 'deleteMessage',
      'deleteMessageBatch', 'changeMessageVisibility', 'getQueueAttributes',
      'purgeQueue', 'getQueueUrl',
    ]) {
      this[m] = makeSqsMethod(m);
    }
  }
}

module.exports = {
  config: { update: () => {} },
  SQS,
  // Exposed so a suite can assert on what the driver would have sent.
  __calls: calls,
  __reset: () => { calls.length = 0; },
};
