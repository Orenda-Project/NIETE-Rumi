/**
 * Teach a hand-rolled supabase mock the two operations ConversationState performs.
 *
 * WHY NOT JUST `jest.mock` THE SERVICE. Because the behaviour under test IS the
 * store: bd-2733 moved the attendance register's in-flight state out of a
 * process-local Map and into `users.conversation_state` precisely so a second replica
 * can read what the first one wrote. Stubbing the service would hand every test a
 * perfect in-process store — the exact thing that was already there and already
 * broken — and the suite would prove nothing about the fix. Class O of the pre-merge
 * checklist: a mocked collaborator hides the bug in the seam.
 *
 * So the real service runs, against a fake `users` row. It performs exactly two
 * queries, and only these two are intercepted:
 *
 *   .from('users').select('conversation_state, conversation_state_expires_at')
 *                 .eq('id', userId).maybeSingle()
 *   .from('users').update({ conversation_state, conversation_state_expires_at })
 *                 .eq('id', userId)
 *
 * Everything else on `users`, and every other table, falls through to the mock the
 * test already built.
 *
 * Usage — in the jest.mock factory, so the wrapper is what the endpoint imports:
 *
 *   const mockSupabase = { from: jest.fn() };
 *   jest.mock('../../bot/shared/config/supabase', () =>
 *     require('../fixtures/conversation-state-fake').withConversationState(mockSupabase));
 *
 * The test keeps configuring `mockSupabase.from` exactly as before; the wrapper
 * delegates to whatever implementation is current at call time.
 */

/** One `users` row's worth of state, per user id. */
function makeStore() {
  return new Map();
}

function usersProxy(inner, store) {
  return {
    ...inner,
    select(cols, ...rest) {
      const wantsState = typeof cols === 'string' && cols.includes('conversation_state');
      if (!wantsState) return inner.select ? inner.select(cols, ...rest) : inner;
      return {
        eq: (_col, id) => ({
          maybeSingle: async () => ({
            data: store.get(id) || {
              conversation_state: null,
              conversation_state_expires_at: null,
            },
            error: null,
          }),
        }),
      };
    },
    update(patch, ...rest) {
      const isState = patch && Object.prototype.hasOwnProperty.call(patch, 'conversation_state');
      if (!isState) return inner.update ? inner.update(patch, ...rest) : { eq: async () => ({ error: null }) };
      return {
        eq: async (_col, id) => {
          store.set(id, {
            conversation_state: patch.conversation_state,
            conversation_state_expires_at: patch.conversation_state_expires_at,
          });
          return { error: null };
        },
      };
    },
  };
}

/**
 * @param {{from: Function}} mockSupabase the test's own mock
 * @returns {{from: Function, _stateStore: Map}} a drop-in replacement
 */
function withConversationState(mockSupabase) {
  const store = makeStore();
  return {
    ...mockSupabase,
    _stateStore: store,
    from(table) {
      const inner = mockSupabase.from(table);
      if (table !== 'users' || !inner) return inner;
      return usersProxy(inner, store);
    },
  };
}

module.exports = { withConversationState, makeStore };
