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

// "Cannot find module './engine' …" names the module itself; a missing dependency of a module that IS
// there names the dependency instead, and must surface as its own error.
function isSelfMissing(err, relPath) {
  return !!err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${relPath}'`);
}

function lazy(name, relPath, loader) {
  if (loader) return function get() { return loader(); };
  return function get() {
    try {
      require.resolve(relPath);
    } catch (err) {
      if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
      // Not on disk. A registered stand-in (a test's virtual module) still loads; anything else is
      // "not ported yet".
      try { return require(relPath); } catch (loadErr) {
        if (isSelfMissing(loadErr, relPath)) throw new FflpModuleMissing(name);
        throw loadErr;
      }
    }
    return require(relPath);
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

/**
 * TRUE when the engine module is on this deployment and loads. The typed-topic seam checks it before
 * queueing anything, so the switch cannot send a teacher to an engine that is not there.
 */
function engineReady() {
  try {
    return !!_internals.resolveEngine();
  } catch (err) {
    return false;
  }
}

const fflp = { FflpModuleMissing, engineReady, _internals };
Object.defineProperty(fflp, 'engine', { enumerable: true, get: () => _internals.resolveEngine() });
Object.defineProperty(fflp, 'chat', { enumerable: true, get: () => _internals.resolveChat() });
Object.defineProperty(fflp, 'render', { enumerable: true, get: () => _internals.resolveRender() });
Object.defineProperty(fflp, 'publish', { enumerable: true, get: () => _internals.resolvePublish() });
Object.defineProperty(fflp, 'switch', { enumerable: true, get: () => require('./switch') });
Object.defineProperty(fflp, 'catalogueMatch', { enumerable: true, get: () => require('./catalogue-match') });

module.exports = fflp;
