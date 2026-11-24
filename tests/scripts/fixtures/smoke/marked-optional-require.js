// The helper this lazily loads is not on every branch; the caller catches MODULE_NOT_FOUND.
const deps = { load: () => require('./not-on-this-branch') }; // optional-require: the caller falls back when it is absent

module.exports = { deps };
