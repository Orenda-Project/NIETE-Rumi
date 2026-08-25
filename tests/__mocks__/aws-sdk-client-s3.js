/**
 * @aws-sdk/client-s3 stub for the root test suite.
 *
 * bot/shared/storage/r2.js requires it, and the package lives in bot/node_modules
 * rather than the root — while the root test job runs before bot deps install. So
 * any suite whose require chain reached R2 storage died on an unresolved module
 * instead of on its own assertions. Same case and same fix as the axios, form-data,
 * pino, exceljs, canvas, dotenv and pg stubs beside it.
 *
 * The command classes RECORD their input rather than no-opping, so a test can
 * assert what would have been sent to R2 without the dependency present.
 */

class S3Client {
  constructor(config) {
    this.config = config;
    this.send = jest.fn(() => Promise.resolve({}));
  }
}

const command = (name) => {
  const C = class {
    constructor(input) { this.input = input; }
  };
  Object.defineProperty(C, 'name', { value: name });
  return C;
};

module.exports = {
  S3Client,
  PutObjectCommand: command('PutObjectCommand'),
  GetObjectCommand: command('GetObjectCommand'),
  DeleteObjectCommand: command('DeleteObjectCommand'),
  HeadObjectCommand: command('HeadObjectCommand'),
  ListObjectsV2Command: command('ListObjectsV2Command'),
};
module.exports.default = module.exports;
