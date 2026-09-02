/**
 * `katex/dist/contrib/mhchem.js` stub. Upstream this file is imported purely for its side
 * effect — it registers the \ce and \pu macros on the katex singleton. The katex stub in this
 * directory flattens every maths run itself, so there is nothing to register: a no-op is the
 * honest stand-in, and it keeps `require("katex/dist/contrib/mhchem.js")` resolvable in the
 * root suite (see tests/jest.config.js).
 */
module.exports = {};
