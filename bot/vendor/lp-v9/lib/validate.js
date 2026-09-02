// Schema validation. Shared by render_lp.js, lint_lp.js and the tests so a doc can never be
// "valid enough to render but not valid enough to lint".
//
// TWO schemas live side by side and the DOCUMENT chooses:
//   schema_version "3.0" -> schema/lp_doc.schema.json     (v9 — the closed heading system)
//   schema_version "2.0" -> schema/lp_doc.v2.schema.json  (v8 — frozen, read-only)
//
// The v2 file is not deprecated-by-neglect: the corpus authored before 2026-09-01 is 2.0, it
// still has to render, and a schema that quietly stopped accepting it would turn every one of
// those docs into a silent SCHEMA failure. lib/migrate.js lifts a 2.0 doc into the 3.0 SHAPE
// for the renderer; validation still happens against the schema the doc declares.

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const SCHEMA_DIR = path.join(__dirname, "..", "schema");
const SCHEMA_PATH = path.join(SCHEMA_DIR, "lp_doc.schema.json");        // v3.0 — current
const SCHEMA_PATH_V2 = path.join(SCHEMA_DIR, "lp_doc.v2.schema.json");  // v2.0 — frozen

const _cache = new Map();
function compiled(file) {
  if (_cache.has(file)) return _cache.get(file);
  const schema = JSON.parse(fs.readFileSync(file, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
  const fn = ajv.compile(schema);
  _cache.set(file, fn);
  return fn;
}

/** Which schema a document is asking to be judged against. */
function schemaFor(doc) {
  const v = doc && doc.schema_version;
  if (v === "2.0") return SCHEMA_PATH_V2;
  return SCHEMA_PATH;   // 3.0, and anything else — which the const then rejects, loudly
}

/** @returns {{ok:boolean, errors:string[], schema:string}} */
function validateDoc(doc) {
  const file = schemaFor(doc);
  const validate = compiled(file);
  const ok = validate(doc);
  if (ok) return { ok: true, errors: [], schema: path.basename(file) };
  // ajv's oneOf noise on the block union is unreadable raw; keep the deepest,
  // most specific messages and drop the "must match exactly one schema" wrapper.
  const errs = (validate.errors || [])
    .filter((e) => e.keyword !== "oneOf" || (validate.errors || []).length === 1)
    .map((e) => `${e.instancePath || "/"} ${e.message}${e.params && e.params.additionalProperty ? ` ('${e.params.additionalProperty}')` : ""}${e.params && e.params.allowedValues ? ` — allowed: ${e.params.allowedValues.join(", ")}` : ""}`);
  return { ok: false, errors: [...new Set(errs)], schema: path.basename(file) };
}

module.exports = { validateDoc, schemaFor, SCHEMA_PATH, SCHEMA_PATH_V2 };
