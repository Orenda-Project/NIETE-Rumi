/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
  ],
  // Force module resolution to root node_modules so Jest mocks work
  // even when bot/node_modules exists (dual-install scenario)
  moduleNameMapper: {
    '^openai$': '<rootDir>/node_modules/openai',
    '^ioredis$': '<rootDir>/node_modules/ioredis',
    // axios + form-data live in bot/node_modules (not root), and the root test
    // job runs before bot deps install — so source that requires them can't
    // resolve. Map to lightweight stubs (same pattern as pino/canvas above) so
    // the real whatsapp.service can load in the root suite.
    '^axios$': '<rootDir>/tests/__mocks__/axios.js',
    '^form-data$': '<rootDir>/tests/__mocks__/form-data.js',
    // bot-only optional/native packages — use lightweight mocks for OSS test suite
    '^pino$': '<rootDir>/tests/__mocks__/pino.js',
    // exceljs is bot-only too. The stub RECORDS rows rather than no-opping, so the
    // teacher-register tests can assert what the generator wrote without the dep.
    '^exceljs$': '<rootDir>/tests/__mocks__/exceljs.js',
    '^canvas$': '<rootDir>/tests/__mocks__/canvas.js',
    // Same case, same fix: dotenv lives in bot/node_modules and pg in
    // dashboard/node_modules, so every root suite that loads bot config or
    // dashboard source died on an unresolved require rather than on anything
    // it was actually asserting. Stubbing them also stops a developer's local
    // .env from leaking into test expectations.
    '^dotenv$': '<rootDir>/tests/__mocks__/dotenv.js',
    '^pg$': '<rootDir>/tests/__mocks__/pg.js',
    // Same case again: the two AWS S3 packages live in bot/node_modules, so any
    // root suite whose chain reached bot/shared/storage/r2.js died on an
    // unresolved require rather than on its own assertions.
    '^@supabase/supabase-js$': '<rootDir>/tests/__mocks__/supabase-js.js',
    '^@aws-sdk/client-s3$': '<rootDir>/tests/__mocks__/aws-sdk-client-s3.js',
    '^@aws-sdk/s3-request-presigner$': '<rootDir>/tests/__mocks__/aws-sdk-s3-request-presigner.js',
  },
  setupFiles: ['<rootDir>/tests/setup.js'],
  testEnvironment: 'node',
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
    // Disable Web Storage APIs to avoid Node.js 25 SecurityError
    experimentalVmModules: false,
  },
  // Disable localStorage/sessionStorage to avoid Node.js 25 SecurityError
  globals: {
    localStorage: undefined,
    sessionStorage: undefined,
  },
  verbose: true,
  collectCoverageFrom: [
    'bot/shared/**/*.js',
    'dashboard/services/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  testTimeout: 30000,
};
