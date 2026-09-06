/**
 * ajv stub for the ROOT test suite.
 *
 * WHY A STUB AT ALL: `ajv` is a bot-only dependency (bot/vendor/lp-v9/lib/validate.js
 * compiles the lp_doc schemas with it), and CI runs the root suite BEFORE `bot/ npm ci`.
 * Without a stub, every suite whose chain reaches the vendored lint dies on
 * `Cannot find module 'ajv'` instead of on its own assertions — the failure mode
 * tests/jest.config.js's other mappings all exist to prevent.
 *
 * WHY IT IS A REAL (IF PARTIAL) VALIDATOR RATHER THAN `() => true`:
 * the vendored `lint()` SHORT-CIRCUITS on a schema failure and assumes a schema-valid
 * document for every gate after it. An always-passing stub would send `{}` straight into
 * `doc.slo.text_verbatim` and turn a schema test into a TypeError, and — worse — would let
 * a test claim "the schema gate passed" when nothing was checked.
 *
 * WHAT IT SUPPORTS (a deliberate subset of draft-07, enough for lp_doc):
 *   type · required · properties · additionalProperties:false · items · enum · const ·
 *   minItems/maxItems · minimum/maximum · pattern · $ref into #/definitions · oneOf/anyOf
 *   (pass if ANY branch passes) · allOf (every branch)
 * Everything else is IGNORED — this stub can therefore be more permissive than real ajv,
 * never stricter. Treat a green schema result in the root suite as "structurally plausible",
 * not as "ajv would accept this". The bot runs real ajv.
 */

const TYPE_OK = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = root;
  for (const seg of ref.slice(2).split('/')) {
    if (!node) return null;
    node = node[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return node || null;
}

function check(schema, data, at, root, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (target) check(target, data, at, root, errors);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => (TYPE_OK[t] || (() => true))(data))) {
      errors.push({ instancePath: at, message: `must be ${types.join(' or ')}`, params: {} });
      return; // every keyword below assumes the right type
    }
  }

  if ('const' in schema && data !== schema.const) {
    errors.push({ instancePath: at, message: `must be equal to constant`, params: { allowedValues: [schema.const] } });
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push({ instancePath: at, message: 'must be equal to one of the allowed values', params: { allowedValues: schema.enum } });
  }
  if (typeof data === 'string' && schema.pattern && !new RegExp(schema.pattern).test(data)) {
    errors.push({ instancePath: at, message: `must match pattern "${schema.pattern}"`, params: {} });
  }
  if (typeof data === 'number') {
    if (typeof schema.minimum === 'number' && data < schema.minimum) {
      errors.push({ instancePath: at, message: `must be >= ${schema.minimum}`, params: {} });
    }
    if (typeof schema.maximum === 'number' && data > schema.maximum) {
      errors.push({ instancePath: at, message: `must be <= ${schema.maximum}`, params: {} });
    }
  }

  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push({ instancePath: at, message: `must NOT have fewer than ${schema.minItems} items`, params: {} });
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push({ instancePath: at, message: `must NOT have more than ${schema.maxItems} items`, params: {} });
    }
    if (schema.items && !Array.isArray(schema.items)) {
      data.forEach((v, i) => check(schema.items, v, `${at}/${i}`, root, errors));
    }
  }

  if (TYPE_OK.object(data)) {
    for (const key of schema.required || []) {
      if (!(key in data)) {
        errors.push({ instancePath: at, message: `must have required property '${key}'`, params: { missingProperty: key } });
      }
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(data)) {
      if (props[k]) check(props[k], v, `${at}/${k}`, root, errors);
      else if (schema.additionalProperties === false && !schema.patternProperties) {
        errors.push({ instancePath: at, message: 'must NOT have additional properties', params: { additionalProperty: k } });
      }
    }
  }

  for (const branch of schema.allOf || []) check(branch, data, at, root, errors);

  for (const key of ['oneOf', 'anyOf']) {
    const branches = schema[key];
    if (!Array.isArray(branches) || !branches.length) continue;
    const passed = branches.some((b) => {
      const sub = [];
      check(b, data, at, root, sub);
      return sub.length === 0;
    });
    if (!passed) {
      errors.push({ instancePath: at, keyword: key, message: `must match a schema in ${key}`, params: {} });
    }
  }
}

class Ajv {
  constructor(opts = {}) {
    this.opts = opts;
  }

  compile(schema) {
    const validate = (data) => {
      const errors = [];
      check(schema, data, '', schema, errors);
      validate.errors = errors.length ? errors : null;
      return errors.length === 0;
    };
    validate.errors = null;
    validate.schema = schema;
    return validate;
  }

  addSchema() { return this; }
  addKeyword() { return this; }
  addFormat() { return this; }
}

module.exports = Ajv;
module.exports.default = Ajv;
module.exports.Ajv = Ajv;
