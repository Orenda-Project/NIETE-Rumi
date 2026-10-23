'use strict';
/**
 * fflp — the free-form lesson-plan engine's single entry point.
 *
 * Every cross-module call goes through here. Each engine module is a LAZY getter: it is
 * `require`d at access time, never when this file loads, so the seam (the typed-topic handler, the
 * queue service, the generation worker) can import this file while the switch is OFF and the
 * engine modules are not on this deployment yet. A module that is not on disk throws
 * FflpModuleMissing(name); a module that IS on disk but fails to load re-throws its own error (a
 * broken module must never masquerade as "not ported yet").
 */
class FflpModuleMissing extends Error {
  constructor(name) {
    super(`fflp module "${name}" is not available yet`);
    this.name = 'FflpModuleMissing';
    this.module = name;
  }
}

function lazy(name, relPath, loader) {
  const load = loader || (() => require(relPath));
  const exists = loader ? () => true : () => {
    try { require.resolve(relPath); return true; } catch (err) {
      if (err && err.code === 'MODULE_NOT_FOUND') return false;
      throw err;
    }
  };
  return function get() {
    if (!exists()) throw new FflpModuleMissing(name);
    return load();
  };
}

// One resolver per module; `_internals` exposes them so a test can stand a module in.
const _internals = {
  lazy,
  resolveEngine: lazy('engine', './engine'),
  resolveChat: lazy('chat', './chat'),
  resolveRender: lazy('render', './render'),
  resolvePublish: lazy('publish', './publish'),
};

const fflp = { FflpModuleMissing, _internals };
Object.defineProperty(fflp, 'engine', { enumerable: true, get: () => _internals.resolveEngine() });
Object.defineProperty(fflp, 'chat', { enumerable: true, get: () => _internals.resolveChat() });
Object.defineProperty(fflp, 'render', { enumerable: true, get: () => _internals.resolveRender() });
Object.defineProperty(fflp, 'publish', { enumerable: true, get: () => _internals.resolvePublish() });
Object.defineProperty(fflp, 'switch', { enumerable: true, get: () => require('./switch') });
Object.defineProperty(fflp, 'catalogueMatch', { enumerable: true, get: () => require('./catalogue-match') });

module.exports = fflp;
