/**
 * @aws-sdk/s3-request-presigner stub for the root test suite.
 * Same reason as the client-s3 stub beside it: bot-only dependency, root job runs
 * first. Returns a deterministic, obviously-fake URL so a test asserting "we handed
 * her a link" can pass without reaching AWS.
 */

const getSignedUrl = jest.fn(async (_client, command) => {
  const key = (command && command.input && command.input.Key) || 'object';
  return `https://r2.test.invalid/${key}?signed=stub`;
});

module.exports = { getSignedUrl };
module.exports.default = module.exports;
