/**
 * register-one-flow — Test Suite
 *
 * register-all-flows.js is built for an EMPTY WhatsApp Business Account: it
 * walks every entry in flow-configs.js and creates each one whose name it
 * cannot find. Pointed at a WABA that already has flows, it creates a pile of
 * them — including duplicates of live, traffic-carrying flows whose Meta names
 * have since drifted from the config names. republish-flow.js is the other
 * half of the pair and needs a flow id that already exists.
 *
 * So nothing in the repo could add ONE flow to a populated WABA. That is what
 * this module is, and every test below encodes a way the old pair could hurt a
 * live account.
 *
 * TDD: written before the implementation.
 */

const {
  normalizeFlowName,
  selectFlowConfig,
  assessWabaForFlow,
  diffFlowSnapshots,
  registerOneFlow,
} = require('../../bot/scripts/setup/register-one-flow');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  name: 'Status',
  jsonPath: '/repo/docs/flows/status-flow.json',
  type: 'endpoint',
  endpointPath: '/api/flows/status',
  envVar: 'STATUS_FLOW_ID',
  categories: ['OTHER'],
};

const STUB_JSON = { version: '7.0', screens: [{ id: 'MAIN' }] };

function ok(data) {
  return { success: true, data };
}

function createMockApi(overrides = {}) {
  return {
    listFlows: jest.fn().mockResolvedValue(ok([])),
    createFlow: jest.fn().mockResolvedValue(ok({ id: 'new_flow_1' })),
    uploadFlowJson: jest.fn().mockResolvedValue(ok({})),
    setFlowEndpoint: jest.fn().mockResolvedValue(ok({})),
    publishFlow: jest.fn().mockResolvedValue(ok({})),
    getFlowDetails: jest
      .fn()
      .mockResolvedValue(ok({ id: 'new_flow_1', name: 'Status', status: 'PUBLISHED' })),
    ...overrides,
  };
}

/** Every call that changes something on Meta's side. */
function mutatingCalls(api) {
  return [api.createFlow, api.uploadFlowJson, api.setFlowEndpoint, api.publishFlow];
}

function runOpts(extra = {}) {
  return {
    config: STATUS_CONFIG,
    endpointBase: 'https://niete.example.app',
    flowJson: STUB_JSON,
    write: false,
    env: {},
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Name normalisation — the drift that made register-all-flows dangerous
// ---------------------------------------------------------------------------

describe('normalizeFlowName', () => {
  it('ignores case, spaces and punctuation so near-misses compare equal', () => {
    expect(normalizeFlowName('Student join — name and class')).toBe(
      normalizeFlowName('student  join name and class')
    );
  });

  it('keeps genuinely different names different', () => {
    expect(normalizeFlowName('Status')).not.toBe(normalizeFlowName('Settings'));
  });
});

// ---------------------------------------------------------------------------
// Selecting exactly one config
// ---------------------------------------------------------------------------

describe('selectFlowConfig', () => {
  const configs = [STATUS_CONFIG, { ...STATUS_CONFIG, name: 'Settings', envVar: 'SETTINGS_FLOW_ID' }];

  it('returns the single named config', () => {
    const result = selectFlowConfig('Status', configs);
    expect(result.ok).toBe(true);
    expect(result.config).toBe(STATUS_CONFIG);
  });

  it('refuses an unknown name and lists what is available', () => {
    const result = selectFlowConfig('Stats', configs);
    expect(result.ok).toBe(false);
    expect(result.available).toEqual(['Status', 'Settings']);
  });

  it('refuses rather than guessing when the name is omitted', () => {
    expect(selectFlowConfig(undefined, configs).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reading the live WABA before writing to it
// ---------------------------------------------------------------------------

describe('assessWabaForFlow', () => {
  it('is clear when nothing on the account resembles the flow', () => {
    const result = assessWabaForFlow({
      configName: 'Status',
      existingFlows: [{ id: '1', name: 'Registration v4' }, { id: '2', name: 'Settings' }],
    });
    expect(result.verdict).toBe('clear');
  });

  it('reports an exact match so the flow is never created twice', () => {
    const result = assessWabaForFlow({
      configName: 'Status',
      existingFlows: [{ id: '9', name: 'Status' }],
    });
    expect(result.verdict).toBe('exact');
    expect(result.exact.id).toBe('9');
  });

  it('matches exactly even when Meta spells the name differently', () => {
    const result = assessWabaForFlow({
      configName: 'Student Videos',
      existingFlows: [{ id: '9', name: 'student videos' }],
    });
    expect(result.verdict).toBe('exact');
  });

  // Four live flows on one production account carry a suffixed name
  // ("Registration v4", "Pakistan LP v3.2", "Student Videos v2"). The old
  // registrar compared names with === , saw no match, and would have created
  // a second copy of each alongside fifteen thousand sends a week.
  it('stops on a suffixed near-miss instead of creating a duplicate', () => {
    const result = assessWabaForFlow({
      configName: 'Registration',
      existingFlows: [{ id: '2010172012940869', name: 'Registration v4' }],
    });
    expect(result.verdict).toBe('similar');
    expect(result.similar.map((f) => f.name)).toEqual(['Registration v4']);
  });

  // The sandbox account prefixes every flow with its environment
  // ("sandbox-status" for what the config calls "Status"). A prefix-only
  // near-miss check reads that as "nothing like it here" and creates a second
  // Status flow next to the one the sandbox bot is already sending.
  it('stops on a prefixed live name, not just a suffixed one', () => {
    const result = assessWabaForFlow({
      configName: 'Status',
      existingFlows: [{ id: '1722781448772022', name: 'sandbox-status' }],
    });
    expect(result.verdict).toBe('similar');
    expect(result.similar.map((f) => f.name)).toEqual(['sandbox-status']);
  });

  it('still calls a genuinely unrelated account clear', () => {
    const result = assessWabaForFlow({
      configName: 'Status',
      existingFlows: [
        { id: '1', name: 'Observe FICO v4' },
        { id: '2', name: 'Student join — name and class' },
        { id: '3', name: 'teacher_training_v2_bands' },
      ],
    });
    expect(result.verdict).toBe('clear');
  });

  it('treats a shortened live name as a near-miss too', () => {
    const result = assessWabaForFlow({
      configName: 'Pakistan LP v3',
      existingFlows: [{ id: '5', name: 'Pakistan LP' }],
    });
    expect(result.verdict).toBe('similar');
  });
});

// ---------------------------------------------------------------------------
// Proving nothing else moved
// ---------------------------------------------------------------------------

describe('diffFlowSnapshots', () => {
  const before = [
    { id: '1', name: 'Registration v4', status: 'PUBLISHED' },
    { id: '2', name: 'Pakistan LP v3.2 (6-12 menu)', status: 'PUBLISHED' },
  ];

  it('sees a single addition and no collateral change', () => {
    const after = [...before, { id: '3', name: 'Status', status: 'PUBLISHED' }];
    const diff = diffFlowSnapshots(before, after);
    expect(diff.added.map((f) => f.id)).toEqual(['3']);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  // The failure mode that took sandbox /status down: an upload against a
  // published flow reverts it to DRAFT. A diff that only counted rows would
  // have called that "nothing changed".
  it('catches a bystander flow knocked from PUBLISHED to DRAFT', () => {
    const after = [
      { id: '1', name: 'Registration v4', status: 'DRAFT' },
      before[1],
      { id: '3', name: 'Status', status: 'PUBLISHED' },
    ];
    const diff = diffFlowSnapshots(before, after);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({ id: '1', from: 'PUBLISHED', to: 'DRAFT' });
  });

  it('catches a bystander flow being renamed', () => {
    const after = [{ ...before[0], name: 'Registration v5' }, before[1]];
    const diff = diffFlowSnapshots(before, after);
    expect(diff.changed[0]).toMatchObject({ id: '1', fromName: 'Registration v4', toName: 'Registration v5' });
  });

  it('catches a disappearance', () => {
    const diff = diffFlowSnapshots(before, [before[0]]);
    expect(diff.removed.map((f) => f.id)).toEqual(['2']);
  });
});

// ---------------------------------------------------------------------------
// The run itself
// ---------------------------------------------------------------------------

describe('registerOneFlow — dry run', () => {
  it('writes nothing to Meta', async () => {
    const api = createMockApi();
    const result = await registerOneFlow(api, runOpts());

    expect(result.status).toBe('dry-run');
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });

  it('still reads the account, so the plan is grounded in what is live', async () => {
    const api = createMockApi();
    await registerOneFlow(api, runOpts());
    expect(api.listFlows).toHaveBeenCalled();
  });

  it('reports the endpoint it would set, built from the config not a guess', async () => {
    const api = createMockApi();
    const result = await registerOneFlow(api, runOpts());
    expect(result.plan.endpointUri).toBe('https://niete.example.app/api/flows/status');
  });
});

describe('registerOneFlow — refusals', () => {
  it('refuses when the env var already holds an id', async () => {
    const api = createMockApi();
    const result = await registerOneFlow(
      api,
      runOpts({ write: true, env: { STATUS_FLOW_ID: '1234567890' } })
    );

    expect(result.status).toBe('refused');
    expect(result.reason).toMatch(/STATUS_FLOW_ID/);
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });

  it('refuses when the flow already exists on the account', async () => {
    const api = createMockApi({
      listFlows: jest.fn().mockResolvedValue(ok([{ id: '77', name: 'Status', status: 'PUBLISHED' }])),
    });
    const result = await registerOneFlow(api, runOpts({ write: true }));

    expect(result.status).toBe('refused');
    expect(result.existingId).toBe('77');
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });

  it('refuses on a near-miss name until a human confirms it is a different flow', async () => {
    const api = createMockApi({
      listFlows: jest
        .fn()
        .mockResolvedValue(ok([{ id: '88', name: 'Status v2', status: 'PUBLISHED' }])),
    });
    const result = await registerOneFlow(api, runOpts({ write: true }));

    expect(result.status).toBe('refused');
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });

  it('refuses when the account cannot be read at all', async () => {
    const api = createMockApi({
      listFlows: jest.fn().mockResolvedValue({ success: false, error: { message: 'bad token' } }),
    });
    const result = await registerOneFlow(api, runOpts({ write: true }));

    expect(result.status).toBe('refused');
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });

  it('refuses an endpoint flow with no endpoint base, rather than publishing one that 404s', async () => {
    const api = createMockApi();
    const result = await registerOneFlow(api, runOpts({ write: true, endpointBase: '' }));

    expect(result.status).toBe('refused');
    for (const call of mutatingCalls(api)) expect(call).not.toHaveBeenCalled();
  });
});

describe('registerOneFlow — writing', () => {
  it('creates exactly one flow, the one named', async () => {
    const api = createMockApi();
    await registerOneFlow(api, runOpts({ write: true }));

    expect(api.createFlow).toHaveBeenCalledTimes(1);
    expect(api.createFlow).toHaveBeenCalledWith('Status', ['OTHER']);
  });

  // Writing endpoint_uri to a PUBLISHED flow silently unpublishes it. The
  // endpoint has to be in place before the publish call, never after.
  it('sets the endpoint before publishing', async () => {
    const order = [];
    const api = createMockApi({
      uploadFlowJson: jest.fn(async () => (order.push('upload'), ok({}))),
      setFlowEndpoint: jest.fn(async () => (order.push('endpoint'), ok({}))),
      publishFlow: jest.fn(async () => (order.push('publish'), ok({}))),
    });
    await registerOneFlow(api, runOpts({ write: true }));

    expect(order).toEqual(['upload', 'endpoint', 'publish']);
  });

  it('does not publish a flow whose JSON failed to upload', async () => {
    const api = createMockApi({
      uploadFlowJson: jest
        .fn()
        .mockResolvedValue({ success: false, error: { message: 'rejected key _comment' } }),
    });
    const result = await registerOneFlow(api, runOpts({ write: true }));

    expect(result.status).toBe('error');
    expect(api.publishFlow).not.toHaveBeenCalled();
  });

  it('re-reads the flow afterwards instead of trusting the publish response', async () => {
    const api = createMockApi();
    const result = await registerOneFlow(api, runOpts({ write: true }));

    expect(api.getFlowDetails).toHaveBeenCalledWith('new_flow_1');
    expect(result.status).toBe('registered');
    expect(result.flowId).toBe('new_flow_1');
  });

  it('re-reads the whole account afterwards and reports the diff', async () => {
    const before = [{ id: '1', name: 'Registration v4', status: 'PUBLISHED' }];
    const after = [...before, { id: 'new_flow_1', name: 'Status', status: 'PUBLISHED' }];
    const listFlows = jest
      .fn()
      .mockResolvedValueOnce(ok(before))
      .mockResolvedValueOnce(ok(after));

    const result = await registerOneFlow(createMockApi({ listFlows }), runOpts({ write: true }));

    expect(result.diff.added.map((f) => f.id)).toEqual(['new_flow_1']);
    expect(result.diff.changed).toEqual([]);
    expect(result.collateral).toBe(false);
  });

  it('flags collateral damage when a bystander flow changed during the run', async () => {
    const before = [{ id: '1', name: 'Registration v4', status: 'PUBLISHED' }];
    const after = [
      { id: '1', name: 'Registration v4', status: 'DRAFT' },
      { id: 'new_flow_1', name: 'Status', status: 'PUBLISHED' },
    ];
    const listFlows = jest
      .fn()
      .mockResolvedValueOnce(ok(before))
      .mockResolvedValueOnce(ok(after));

    const result = await registerOneFlow(createMockApi({ listFlows }), runOpts({ write: true }));

    expect(result.collateral).toBe(true);
  });

  it('skips the endpoint call for a navigate-type flow', async () => {
    const api = createMockApi();
    await registerOneFlow(
      api,
      runOpts({
        write: true,
        config: { ...STATUS_CONFIG, type: 'navigate', endpointPath: undefined },
      })
    );

    expect(api.setFlowEndpoint).not.toHaveBeenCalled();
    expect(api.publishFlow).toHaveBeenCalled();
  });
});
