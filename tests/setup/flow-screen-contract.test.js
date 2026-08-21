/**
 * Every screen an endpoint RETURNS must be declared in its Flow JSON.
 *
 * This is the seam that keeps biting. The attendance port that had to be reverted
 * failed exactly here in a different guise: a state machine returned an action the
 * message handler had no branch for, so the question was never sent and the
 * teacher saw only the validation error from her retry. Verified at one layer,
 * broken at the join.
 *
 * The Flow equivalent is worse, because it is invisible until a real handset hits
 * it: if the endpoint answers `{ screen: 'SAVED' }` and the Flow JSON has no
 * SAVED screen, Meta has nowhere to navigate and the teacher is stranded
 * mid-flow with her taps already spent.
 *
 * Static assertion — no network, no DB. Add a pair here whenever a new endpoint
 * Flow lands.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

/** [endpoint source, its Flow JSON] */
const PAIRS = [
  ['bot/shared/routes/attendance-setup-endpoint.js', 'docs/flows/attendance-setup-flow.json'],
  ['bot/shared/routes/attendance-marking-endpoint.js', 'docs/flows/attendance-marking-flow.json'],
  ['bot/shared/routes/edit-class-endpoint.js', 'docs/flows/edit-class-flow.json'],
  ['bot/shared/routes/class-manager-endpoint.js', 'docs/flows/class-manager-flow.json'],
];

describe('flow screen contract', () => {
  PAIRS.forEach(([srcRel, jsonRel]) => {
    describe(path.basename(srcRel), () => {
      const src = fs.readFileSync(path.join(ROOT, srcRel), 'utf8');
      const flow = JSON.parse(fs.readFileSync(path.join(ROOT, jsonRel), 'utf8'));
      const declared = new Set(flow.screens.map((s) => s.id));

      it('returns only screens the Flow JSON declares', () => {
        const returned = [...new Set([...src.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]))];
        expect(returned.filter((s) => !declared.has(s))).toEqual([]);
      });

      it('declares exactly one terminal screen, and the endpoint can reach it', () => {
        const terminals = flow.screens.filter((s) => s.terminal).map((s) => s.id);
        expect(terminals).toHaveLength(1);
        expect(src).toContain(`screen: '${terminals[0]}'`);
      });

      it('every screen in routing_model exists, and every screen is routable', () => {
        const inModel = new Set(Object.keys(flow.routing_model));
        Object.values(flow.routing_model).flat().forEach((s) => inModel.add(s));
        [...inModel].forEach((s) => expect(declared.has(s)).toBe(true));
        // Terminal screens legitimately have no outgoing routes, but must be named.
        [...declared].forEach((s) => expect(inModel.has(s)).toBe(true));
      });

      /**
       * bd-2713: the rule this file was missing.
       *
       * Declaring a screen is not enough — WhatsApp also refuses to OPEN a flow on
       * a screen that has incoming edges, with:
       *
       *   invalid-screen-transition: The first screen -[X] that was provided with
       *   response already have incoming nodes found in the routing model
       *
       * So the INIT handler may only ever answer with an ENTRY screen. The
       * attendance marking endpoint returned CONFIRM for an empty roster, which is
       * declared, terminal-reachable, and routable — every assertion above passed —
       * and still stranded every teacher whose class had no students.
       *
       * The INIT body is sliced by function name, the same technique
       * attendance-tap-routing.test.js uses to scope a static assertion to one
       * function.
       */
      it('the INIT handler returns only entry screens (no incoming edges)', () => {
        const incoming = new Set(Object.values(flow.routing_model).flat());
        const entry = [...declared].filter((s) => !incoming.has(s));

        // A flow with no entry screen cannot be opened at all.
        expect(entry.length).toBeGreaterThan(0);

        const initFn = src.match(/async function (handle\w*Init)\s*\(/);
        expect(initFn).not.toBeNull();

        /** Body of a named function, up to the next top-level declaration. */
        const bodyOf = (name) => {
          const decl = src.match(new RegExp(`(?:async )?function ${name}\\s*\\(`));
          if (!decl) return '';
          const from = src.indexOf(decl[0]) + decl[0].length;
          const rest = src.slice(from);
          const next = rest.search(/\n(?:async )?function \w+\s*\(/);
          return next === -1 ? rest : rest.slice(0, next);
        };

        // INIT may DELEGATE rather than answer inline — since bd-2726 the marking
        // endpoint's INIT is `return renderClassScreen(...)`. Follow one level of
        // `return someFn(...)` so the guard sees the screens actually produced.
        // Without this the body has no `screen:` literal and the check silently
        // asserts nothing.
        const screensIn = (body) => [...body.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
        const initBody = bodyOf(initFn[1]);
        const delegates = [...initBody.matchAll(/return\s+(\w+)\s*\(/g)]
          .map((m) => m[1])
          .filter((n) => /^(render|handle)/.test(n) && n !== initFn[1]);

        const returned = [...new Set([
          ...screensIn(initBody),
          ...delegates.flatMap((n) => screensIn(bodyOf(n))),
        ])];
        expect(returned.length).toBeGreaterThan(0);

        const illegal = returned.filter((s) => !entry.includes(s));
        expect(illegal).toEqual([]);
      });
    });
  });
});

/**
 * Meta refuses to publish a NavigationList that shares a screen with anything
 * else. The error it returns names the wrong cause — "Only up to 2
 * NavigationList components can be used per screen. Please remove other
 * components." — while pointing at the FIRST sibling, so it reads as a count
 * limit when it is really a co-existence rule.
 *
 * This cost a DRAFT on staging: PICK_TEACHER shipped as
 * TextHeading + TextBody + NavigationList, the publish was rejected, and
 * /remark could not open until a valid asset went up. The working precedent
 * (observe-visit-v2 MENU) has the NavigationList as its ONLY child.
 *
 * Anything the screen needs to say has to live in the rows themselves.
 */
describe('NavigationList screens carry nothing else', () => {
  const FLOW_DIR = path.join(ROOT, 'docs/flows');

  const flows = fs.existsSync(FLOW_DIR)
    ? fs.readdirSync(FLOW_DIR).filter((f) => f.endsWith('.json'))
    : [];

  function childTypes(node, acc = []) {
    if (Array.isArray(node)) { node.forEach((n) => childTypes(n, acc)); return acc; }
    if (node && typeof node === 'object') {
      if (typeof node.type === 'string') acc.push(node.type);
      Object.values(node).forEach((v) => childTypes(v, acc));
    }
    return acc;
  }

  flows.forEach((file) => {
    it(`${file}: every NavigationList is the only component on its screen`, () => {
      const flow = JSON.parse(fs.readFileSync(path.join(FLOW_DIR, file), 'utf8'));
      const offenders = [];

      for (const screen of flow.screens || []) {
        const types = childTypes(screen.layout || {});
        if (!types.includes('NavigationList')) continue;
        // The layout wrapper itself is allowed; nothing else is.
        const siblings = types.filter(
          (t) => t !== 'NavigationList' && !/Layout$/.test(t),
        );
        if (siblings.length) offenders.push(`${screen.id}: + ${siblings.join(', ')}`);
      }

      expect(offenders).toEqual([]);
    });
  });
});
