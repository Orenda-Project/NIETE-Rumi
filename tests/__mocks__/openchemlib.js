/**
 * openchemlib stub for the ROOT test suite.
 *
 * bot/vendor/lp-v9/diagrams/types/molecule.js requires it at MODULE SCOPE to turn a SMILES
 * string into a 2D structural formula. It is a bot-only dependency and CI runs the root suite
 * before `bot/ npm ci`, so without this stub every suite that loads the vendored diagram
 * engine — which is every suite that loads the lint — dies on an unresolved require.
 *
 * The stub does NOT draw chemistry. `moleculeFromSmiles` throws a named error, which is the
 * loud-not-silent choice: a root-suite test that genuinely needs a rendered molecule fails on
 * "openchemlib is stubbed" rather than passing over an empty <svg>. Molecule diagrams are
 * exercised against the real package in the bot.
 */
const stubbed = (what) => () => {
  throw new Error(`openchemlib is STUBBED in the root test suite (${what}) — run this against the bot's real dependency`);
};

const Molecule = {
  fromSmiles: stubbed('Molecule.fromSmiles'),
  fromMolfile: stubbed('Molecule.fromMolfile'),
};

module.exports = { Molecule, __stub: true };
module.exports.default = module.exports;
