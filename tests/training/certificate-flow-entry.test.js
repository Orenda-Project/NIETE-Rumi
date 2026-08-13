/**
 * bd-2665 (sheet row R7) — certificates need a TAPPABLE route on WhatsApp.
 *
 * Before this change the only way a teacher could reach a certificate was to
 * type `/certificates`, read a plain-text list, and then RETYPE
 * `/certificate <CODE>` with the exact code. No button, list row, or Flow
 * affordance reached a certificate anywhere in the product — the 🏆 on
 * LEVEL_DETAIL is state text, not a target.
 *
 * That matters more than it looks: the two proactive push paths only send a
 * PDF when one has already been rendered (capstone-delivery.service.js:461),
 * and the overwhelming majority of production certificates have no stored PDF.
 * Only the fetch-or-mint path behind the typed command mints on demand — so
 * for almost every certificate ever issued, code-retyping was the sole route.
 *
 * The fix adds a MY_CERTIFICATES screen to the teacher-training Flow, reachable
 * from both VENDOR_PICKER (the Flow's only entry point, per BUG-144) and
 * TRAINING_HOME (so a teacher mid-level need not back out).
 *
 * These tests lock the pure, DB-free parts of that contract:
 *   1. the row formatter that turns a certificate into a pickable option
 *   2. the Flow JSON actually carrying the screen + both entry links
 *   3. the routing table accepting the new actions
 * The DB-backed screen builders are covered by the endpoint's own integration
 * path and post-deploy E2E on staging.
 */

const path = require('path');
const fs = require('fs');

const {
  certificateOptionTitle,
  certificateOptionDescription,
} = require('../../bot/shared/routes/teacher-training-endpoint');

const FLOW_JSON = path.join(__dirname, '../../docs/flows/teacher-training-flow-v1.json');

// A realistic pair: one freshly-minted certificate that already has a stored
// PDF, and one legacy import that does NOT — the common case in production.
const CERTS = [
  {
    certificate_code: 'NIETE-20260712-697CAA',
    level_name_snapshot: 'Aspiring Teacher',
    teacher_name_snapshot: 'Aisha Malik',
    issued_at: '2026-07-12T09:30:00.000Z',
    pdf_r2_key: 'certificates/NIETE-20260712-697CAA.pdf',
    training_levels: { order_index: 0 },
  },
  {
    certificate_code: 'OXB-L3-20260430-1B2C3D',
    level_name_snapshot: 'Game-Based Teaching',
    teacher_name_snapshot: 'Aisha Malik',
    issued_at: '2026-04-30T11:00:00.000Z',
    pdf_r2_key: null,
    training_levels: { order_index: 2 },
  },
];

describe('bd-2665 — a tappable certificate route', () => {
  describe('row formatting', () => {
    test('the title names the level, so a teacher recognises what they earned', () => {
      expect(certificateOptionTitle(CERTS[0])).toBe('Level 1 · Aspiring Teacher');
      expect(certificateOptionTitle(CERTS[1])).toBe('Level 3 · Game-Based Teaching');
    });

    test('a missing level name degrades to the code rather than rendering "undefined"', () => {
      const bare = { certificate_code: 'NIETE-20260101-AAAAAA', training_levels: null };
      expect(certificateOptionTitle(bare)).toBe('NIETE-20260101-AAAAAA');
    });

    test('the description carries the issue date and the code', () => {
      const d = certificateOptionDescription(CERTS[0]);
      expect(d).toContain('12 Jul 2026');
      expect(d).toContain('NIETE-20260712-697CAA');
    });

    // The whole point of R7: the teacher must never need to type the code.
    // A certificate with no rendered PDF is still fully pickable — minting
    // happens after the tap, not before it.
    test('a certificate with no stored PDF is still offered', () => {
      expect(certificateOptionTitle(CERTS[1])).toBe('Level 3 · Game-Based Teaching');
      expect(certificateOptionDescription(CERTS[1])).toContain('OXB-L3-20260430-1B2C3D');
    });

    test('WhatsApp row limits are respected — title ≤ 30 chars is not required by Flows, but the description stays on one line', () => {
      for (const c of CERTS) {
        expect(certificateOptionDescription(c).split('\n')).toHaveLength(1);
      }
    });
  });

  describe('the Flow JSON carries the screen and both entry points', () => {
    const flow = JSON.parse(fs.readFileSync(FLOW_JSON, 'utf8'));
    const byId = Object.fromEntries(flow.screens.map(s => [s.id, s]));

    // Walk a screen's layout collecting every on-click _action.
    const actionsOf = (screen) => {
      const found = [];
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        const a = n['on-click-action'];
        if (a && a.payload && a.payload._action) found.push(a.payload._action);
        Object.values(n).forEach(walk);
      };
      walk(screen.layout);
      return found;
    };

    test('MY_CERTIFICATES exists and is not terminal', () => {
      expect(byId.MY_CERTIFICATES).toBeDefined();
      expect(byId.MY_CERTIFICATES.terminal).toBe(false);
    });

    test('VENDOR_PICKER — the Flow\'s only entry point — offers certificates', () => {
      expect(actionsOf(byId.VENDOR_PICKER)).toContain('open_certificates');
    });

    test('TRAINING_HOME offers certificates too, so a teacher mid-level need not back out', () => {
      expect(actionsOf(byId.TRAINING_HOME)).toContain('open_certificates');
    });

    test('MY_CERTIFICATES can send a PDF and can exit', () => {
      const actions = actionsOf(byId.MY_CERTIFICATES);
      expect(actions).toContain('send_certificate');
      // Exits by CLOSING, not by routing back — see the forward-only test below.
      expect(actions).toContain('close');
    });

    /**
     * Meta rejects the publish with INVALID_ROUTING_MODEL if any declared
     * route points at a screen that comes earlier. The first cut of this
     * change declared MY_CERTIFICATES → TRAINING_HOME and would have failed
     * to publish — caught pre-merge, pinned here so it cannot come back.
     */
    test('routing_model is forward-only', () => {
      const order = ['VENDOR_PICKER', 'TRAINING_HOME', 'LEVEL_DETAIL', 'MY_CERTIFICATES', 'SUCCESS'];
      const pos = Object.fromEntries(order.map((s, i) => [s, i]));
      const backward = [];
      for (const [src, dests] of Object.entries(flow.routing_model)) {
        for (const dst of dests) {
          if (pos[dst] <= pos[src]) backward.push(`${src} → ${dst}`);
        }
      }
      expect(backward).toEqual([]);
    });

    test('VENDOR_PICKER remains the only entry point (BUG-144)', () => {
      const incoming = Object.fromEntries(flow.screens.map(s => [s.id, 0]));
      for (const dests of Object.values(flow.routing_model)) {
        for (const d of dests) incoming[d] += 1;
      }
      expect(Object.entries(incoming).filter(([, n]) => n === 0).map(([id]) => id))
        .toEqual(['VENDOR_PICKER']);
    });

    test('every screen is reachable from the entry point', () => {
      const seen = new Set(['VENDOR_PICKER']);
      const stack = ['VENDOR_PICKER'];
      while (stack.length) {
        for (const n of flow.routing_model[stack.pop()] || []) {
          if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      expect([...flow.screens.map(s => s.id)].filter(id => !seen.has(id))).toEqual([]);
    });

    test('the screen declares the data it renders, so Meta can validate it', () => {
      const data = byId.MY_CERTIFICATES.data || {};
      expect(data.certificate_options).toBeDefined();
      expect(data.certificate_options.type).toBe('array');
      // __example__ is required by Meta on every data key.
      expect(data.certificate_options.__example__.length).toBeGreaterThan(0);
    });

    test('every screen referenced by a routing edge exists (no dangling transition)', () => {
      const ids = new Set(flow.screens.map(s => s.id));
      for (const s of flow.screens) {
        const walk = (n) => {
          if (Array.isArray(n)) return n.forEach(walk);
          if (!n || typeof n !== 'object') return;
          if (n.next && n.next.name) expect(ids).toContain(n.next.name);
          Object.values(n).forEach(walk);
        };
        walk(s.layout);
      }
    });
  });

  describe('the endpoint routes the new actions', () => {
    const SRC = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/routes/teacher-training-endpoint.js'),
      'utf8'
    );

    // A Flow action with no handler is the bug class the pre-merge checklist
    // calls "orphan dispatch": the button ships, the tap does nothing.
    test('open_certificates is handled, not orphaned', () => {
      expect(SRC).toContain("'open_certificates'");
    });

    test('send_certificate is handled, not orphaned', () => {
      expect(SRC).toContain("'send_certificate'");
    });

    test('MY_CERTIFICATES is a recognised screen in data_exchange', () => {
      expect(SRC).toContain("screen === 'MY_CERTIFICATES'");
    });

    /**
     * data_exchange has a ~10s budget; the mint path is render → R2 upload →
     * WhatsApp media upload → send, and almost every production certificate
     * still needs that mint. Delivery must therefore be kicked off AFTER the
     * screen is returned, or the Flow times out on exactly the certificates
     * this feature exists to reach.
     */
    test('certificate delivery is kicked off asynchronously, not awaited inline', () => {
      const block = SRC.slice(SRC.indexOf("action === 'send_certificate'"));
      const body = block.slice(0, block.indexOf("if (action === 'close')"));
      expect(body).toContain('setImmediate');
      // The screen must be returned, not blocked on the send.
      expect(body).toContain('buildSuccessScreen');
    });

    /**
     * Class E — a name used only inside an error path no test reaches. The
     * first cut of this change called WhatsAppService.sendMessage in the
     * setImmediate failure branch without importing it; it would have thrown
     * only when a teacher's certificate failed to send.
     */
    test('every service referenced in the send path is imported BEFORE it is used', () => {
      const block = SRC.slice(SRC.indexOf("action === 'send_certificate'"));
      const body = block.slice(0, block.indexOf("if (action === 'close')"));

      // Position-aware: a require further down the function does not save an
      // earlier call site. Each usage needs a binding that precedes it.
      // (Verified to fail by deleting either import.)
      for (const m of body.matchAll(/\b([A-Z][A-Za-z]+Service)\s*\./g)) {
        const [, name] = m;
        const before = body.slice(0, m.index);
        const bound = new RegExp(
          `(const|let|var)\\s+(\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s*=`
        ).test(before);
        expect(bound).toBe(true);
      }
    });
  });
});
