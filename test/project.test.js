import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

const NS = '/api/tool-skill-manager';

function makeSkill(name) {
  return {
    name,
    description: `${name} description`,
    provider: 'test-skills',
    source: 'test',
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

function createHarness(options = {}) {
  const record = {
    cwd: options.cwd || '/workspace/project',
    toolCatalogue: options.toolCatalogue || [],
    skills: options.skills || [],
    restrictions: [],
    restrictionReleases: 0,
    guards: [],
    providers: [],
    providerInvalidations: 0,
    handlers: new Map(),
    route: undefined,
    config: options.config || { disabledTools: [], disabledSkills: [] },
  };

  const skillService = {
    async snapshot() {
      return { complete: true, skills: record.skills };
    },
    registerProvider(factory) {
      record.providers.push(factory({ invalidate() { record.providerInvalidations += 1; } }));
      return () => {};
    },
  };

  const agent = {
    id: 'agent-1',
    session: { id: 'session-1' },
    ctx: {
      get(name) {
        return name === 'skills' ? skillService : undefined;
      },
      effect(create) {
        const cleanup = create();
        return () => cleanup?.();
      },
      tools: {
        restrict({ deny }) {
          record.restrictions.push([...deny]);
          return () => { record.restrictionReleases += 1; };
        },
        guard(guard) {
          record.guards.push(guard);
          return () => {};
        },
      },
    },
  };

  const entry = {
    options: { id: 'tool-skill-manager', name: '@local/tool-skill-manager' },
    id: 'include:tool-skill-manager',
    fiber: {},
  };

  const ctx = {
    tools: { schemas: () => record.toolCatalogue },
    agents: { list: () => options.agents || [agent] },
    connection: {
      fetch: {
        register(route) {
          record.route = route;
          return async () => {};
        },
      },
    },
    workingDirectory: { get: () => record.cwd },
    configEditor: {
      entries: () => options.entries || [entry],
      async edit(_entry, change) {
        record.config = change(record.config, {});
      },
    },
    logger: { warn() {} },
    on(event, handler) {
      const list = record.handlers.get(event) || [];
      list.push(handler);
      record.handlers.set(event, list);
      return () => {};
    },
    get(name) {
      return name === 'skills' ? skillService : undefined;
    },
  };

  async function invoke(method, args) {
    const response = await record.route.fetch(new Request(`http://localhost${NS}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, args }),
    }));
    return { status: response.status, payload: await response.json() };
  }

  function emit(event, ...args) {
    for (const handler of record.handlers.get(event) || []) handler(...args);
  }

  async function eventually(check, message = 'condition not reached') {
    const deadline = Date.now() + 3000;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return { record, agent, ctx, invoke, emit, eventually, skillService };
}

async function projectPair() {
  const directory = await mkdtemp(join(tmpdir(), 'tsm-projects-'));
  const alpha = join(directory, 'alpha');
  const beta = join(directory, 'beta');
  await mkdir(join(alpha, '.git'), { recursive: true });
  await mkdir(join(beta, '.git'), { recursive: true });
  return { alpha, beta };
}

test('project overrides re-enable and force-disable capabilities without leaking across scopes', async () => {
  const { alpha } = await projectPair();
  const skills = [makeSkill('alpha-skill'), makeSkill('beta-skill'), makeSkill('gamma-skill')];
  const harness = createHarness({
    cwd: alpha,
    toolCatalogue: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
    skills,
    config: {
      disabledTools: ['alpha', 'beta'],
      disabledSkills: ['beta-skill'],
      projects: {
        [alpha]: {
          tools: { alpha: true, gamma: false },
          skills: { 'alpha-skill': true, 'gamma-skill': false },
        },
      },
    },
  });
  const { record, invoke } = harness;
  const dispose = await apply(harness.ctx, record.config);

  try {
    // Profile-wide `beta` stays denied; project force-disables `gamma` and
    // force-enables `alpha`, so only the first two names reach restrict().
    assert.deepEqual(record.restrictions.at(-1), ['beta', 'gamma']);
    assert.equal(record.guards.at(-1)({ name: 'skill', arguments: { name: 'alpha-skill' } }), undefined);
    assert.match(record.guards.at(-1)({ name: 'skill', arguments: { name: 'gamma-skill' } }), /disabled/);
    assert.match(record.guards.at(-1)({ name: 'skill', arguments: { name: 'beta-skill' } }), /disabled/);

    const disabledSkills = record.providers.at(-1).list().map((skill) => skill.name).sort();
    assert.deepEqual(disabledSkills, ['beta-skill', 'gamma-skill']);
    assert.equal(record.providers.at(-1).list().find((skill) => skill.name === 'gamma-skill').invocation.modelInvocable, false);

    const projectCatalog = await invoke('getCatalog', { scope: alpha });
    assert.equal(projectCatalog.status, 200);
    const tools = Object.fromEntries(projectCatalog.payload.value.tools.map((tool) => [tool.name, tool]));
    assert.equal(tools.alpha.enabled, true);
    assert.equal(tools.alpha.override, true);
    assert.equal(tools.alpha.baseEnabled, false);
    assert.equal(tools.beta.enabled, false);
    assert.equal(tools.beta.override, null);
    assert.equal(tools.gamma.enabled, false);
    assert.equal(tools.gamma.override, false);
    const projectSkills = Object.fromEntries(projectCatalog.payload.value.skills.map((skill) => [skill.name, skill]));
    assert.equal(projectSkills['alpha-skill'].enabled, true);
    assert.equal(projectSkills['gamma-skill'].enabled, false);
    assert.equal(projectCatalog.payload.value.projects.find((row) => row.root === alpha).configured, true);

    const profileCatalog = await invoke('getCatalog', { scope: 'profile' });
    const profileTools = Object.fromEntries(profileCatalog.payload.value.tools.map((tool) => [tool.name, tool]));
    assert.equal(profileTools.alpha.baseEnabled, false);
    assert.equal(profileTools.beta.baseEnabled, false);

    const clear = await invoke('setOverride', { scope: alpha, kind: 'tools', name: 'gamma', value: null });
    assert.equal(clear.status, 200);
    assert.deepEqual(record.config.projects[alpha].tools, { alpha: true });
    assert.deepEqual(record.restrictions.at(-1), ['beta']);

    const unknown = await invoke('setOverride', { scope: alpha, kind: 'tools', name: 'nope', value: false });
    assert.equal(unknown.status, 400);
    assert.match(unknown.payload.error, /Unknown tool: nope/);
  } finally {
    await dispose();
  }
});

test('changing the working directory re-computes the project policy', async () => {
  const { alpha, beta } = await projectPair();
  const harness = createHarness({
    cwd: alpha,
    toolCatalogue: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
    skills: [makeSkill('alpha-skill')],
    config: {
      disabledTools: ['beta'],
      disabledSkills: [],
      projects: {
        [alpha]: { tools: { gamma: false } },
        [beta]: { tools: { gamma: true } },
      },
    },
  });
  const { record, agent, emit, eventually } = harness;
  const dispose = await apply(harness.ctx, record.config);

  try {
    assert.deepEqual(record.restrictions.at(-1), ['beta', 'gamma']);

    record.cwd = beta;
    emit('session/event', agent.session, { type: 'working-directory/change', data: { cwd: beta } });

    await eventually(() => record.restrictions.at(-1)?.join(',') === 'beta', 'policy did not follow the new project root');
    assert.deepEqual(record.restrictions.at(-1), ['beta']);
    // Re-priming the skill overlay is part of resynchronizing the project.
    await eventually(() => record.providerInvalidations > 0, 'skill provider was not invalidated');
  } finally {
    await dispose();
  }
});

test('projects can be registered and removed through the route', async () => {
  const { alpha } = await projectPair();
  const harness = createHarness({ config: { disabledTools: [], disabledSkills: [] } });
  const { record, invoke } = harness;
  const dispose = await apply(harness.ctx, record.config);

  try {
    const added = await invoke('addProject', { root: alpha });
    assert.equal(added.status, 200);
    assert.ok(added.payload.value.projects.some((row) => row.root === alpha && row.configured));
    assert.deepEqual(record.config.projects[alpha], {});

    const removed = await invoke('removeProject', { root: alpha });
    assert.equal(removed.status, 200);
    assert.equal(record.config.projects[alpha], undefined);

    const relative = await invoke('addProject', { root: 'relative/path' });
    assert.equal(relative.status, 400);

    const pluginRequest = await invoke('setPluginEnabled', { scope: alpha, name: 'hello', enabled: false });
    assert.equal(pluginRequest.status, 400);
    assert.match(pluginRequest.payload.error, /Unknown Tools & Skills Manager request/);
  } finally {
    await dispose();
  }
});
