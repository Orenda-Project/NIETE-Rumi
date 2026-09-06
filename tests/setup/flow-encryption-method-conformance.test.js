/**
 * Every FlowEncryptionService method the flow routes call must actually exist.
 *
 * A route that calls a method the service does not export throws a TypeError on
 * EVERY request — including Meta's encrypted health-check ping — and the catch
 * block turns it into a 500. That is indistinguishable by curl from the 500 a
 * healthy route returns for an unencrypted body, so the endpoint looks fine and
 * silently fails Meta's pre-publish probe with "Endpoint not available".
 *
 * Caught when a new flow's route called `handleFlowRequest`, which reads like a
 * method this service would have and is not one.
 */

const path = require('path');
const fs = require('fs');

const FlowEncryptionService = require('../../bot/shared/services/flow-encryption.service');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'routes');

function routeFiles() {
  return fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));
}

describe('flow routes only call FlowEncryptionService methods that exist', () => {
  const exported = new Set(Object.keys(FlowEncryptionService));

  test.each(routeFiles())('%s', (file) => {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const called = new Set();
    // FlowEncryptionService.foo( — the only way these routes reach the service.
    const re = /FlowEncryptionService\.([A-Za-z0-9_$]+)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) called.add(m[1]);

    const missing = [...called].filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });
});
