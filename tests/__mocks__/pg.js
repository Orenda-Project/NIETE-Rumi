/**
 * node-postgres (pg) mock for OSS test suite.
 * pg is a runtime dependency of dashboard/ (config/database.js,
 * mv-refresh-scheduler.service.js) and of the bot's one-off migration scripts,
 * but not of the root package — and the root test job runs before those deps
 * install, so source files that require 'pg' can't resolve it.
 *
 * Every query resolves to an empty result set. A test that needs rows should
 * mock the module it is exercising, not reach through to this stub — the point
 * here is only to let dashboard source load in the root suite. Resolving empty
 * (rather than throwing) keeps a forgotten mock surfacing as an assertion
 * failure on the data, not as an unresolved-module crash.
 */

const emptyResult = () => Promise.resolve({ rows: [], rowCount: 0, fields: [] });

function makeClient() {
  return {
    query: jest.fn(emptyResult),
    connect: jest.fn(() => Promise.resolve()),
    release: jest.fn(),
    end: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
  };
}

class Client {
  constructor(config) {
    this.config = config;
    Object.assign(this, makeClient());
  }
}

class Pool {
  constructor(config) {
    this.config = config;
    this.query = jest.fn(emptyResult);
    this.connect = jest.fn(() => Promise.resolve(makeClient()));
    this.end = jest.fn(() => Promise.resolve());
    this.on = jest.fn();
    this.totalCount = 0;
    this.idleCount = 0;
    this.waitingCount = 0;
  }
}

module.exports = { Client, Pool, types: { setTypeParser: jest.fn() } };
module.exports.default = module.exports;
