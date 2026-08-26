/**
 * bd-neeyat — post-call memory writer.
 *
 * Pinned contracts:
 *  - After a call, the transcript + existing summary are merged by the LLM and
 *    upserted to call_memory, with call_count incremented.
 *  - An over-long summary is truncated to the hard cap.
 *  - No transcript → no write, no LLM call.
 *  - A broken read still lets the call's memory be written (fresh).
 *  - Nothing throws: an LLM/DB failure is swallowed (memory must never break a call).
 */

const { createMemoryWriter, MAX_MEMORY_CHARS } = require('../../shared/calls/call-memory.service');

function makeRepo(existing) {
  return {
    fetchMemory: jest.fn().mockResolvedValue(existing),
    upsertMemory: jest.fn().mockResolvedValue(undefined),
  };
}

describe('call memory — write side', () => {
  test('merges transcript with existing memory and upserts with call_count + 1', async () => {
    const repo = makeRepo({ summary: 'Teaches Grade 5 English.', call_count: 2 });
    const llm = jest.fn().mockResolvedValue('Updated memory.');
    const write = createMemoryWriter({ repo, apiKey: 'k', llm });

    await write({ callerNumber: '923001234567', transcript: 'Caller: hi\nNeeyat: hello' });

    expect(llm).toHaveBeenCalledTimes(1);
    const arg = llm.mock.calls[0][0];
    expect(arg.user).toMatch(/Teaches Grade 5 English/);      // existing memory fed in
    expect(arg.user).toMatch(/Caller: hi/);                   // transcript fed in
    expect(repo.upsertMemory).toHaveBeenCalledWith('923001234567', { summary: 'Updated memory.', callCount: 3 });
  });

  test('first-ever call starts call_count at 1', async () => {
    const repo = makeRepo(null);
    const write = createMemoryWriter({ repo, apiKey: 'k', llm: async () => 'First memory.' });
    await write({ callerNumber: '92300', transcript: 'something real' });
    expect(repo.upsertMemory).toHaveBeenCalledWith('92300', { summary: 'First memory.', callCount: 1 });
  });

  test('truncates an over-long summary to the hard cap', async () => {
    const repo = makeRepo(null);
    const huge = 'x'.repeat(MAX_MEMORY_CHARS + 500);
    const write = createMemoryWriter({ repo, apiKey: 'k', llm: async () => huge });
    await write({ callerNumber: '92300', transcript: 'real' });
    const stored = repo.upsertMemory.mock.calls[0][1].summary;
    expect(stored.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS + 1); // +1 for the ellipsis
  });

  test('no transcript → no LLM, no write', async () => {
    const repo = makeRepo(null);
    const llm = jest.fn();
    const write = createMemoryWriter({ repo, apiKey: 'k', llm });
    await write({ callerNumber: '92300', transcript: '   ' });
    expect(llm).not.toHaveBeenCalled();
    expect(repo.upsertMemory).not.toHaveBeenCalled();
  });

  test('a broken memory read still writes fresh memory for this call', async () => {
    const repo = {
      fetchMemory: jest.fn().mockRejectedValue(new Error('table missing')),
      upsertMemory: jest.fn().mockResolvedValue(undefined),
    };
    const write = createMemoryWriter({ repo, apiKey: 'k', llm: async () => 'Fresh.' });
    await write({ callerNumber: '92300', transcript: 'real' });
    expect(repo.upsertMemory).toHaveBeenCalledWith('92300', { summary: 'Fresh.', callCount: 1 });
  });

  test('never throws when the LLM or DB fails', async () => {
    const repo = {
      fetchMemory: jest.fn().mockResolvedValue(null),
      upsertMemory: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const write = createMemoryWriter({ repo, apiKey: 'k', llm: async () => { throw new Error('llm down'); } });
    await expect(write({ callerNumber: '92300', transcript: 'real' })).resolves.toBeUndefined();
  });
});
