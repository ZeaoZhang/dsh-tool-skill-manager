import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
    mounted: [],
    disposed: [],
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
      plugin(plugin) {
        record.mounted.push(plugin);
        return {
          async dispose() {
            record.disposed.push(plugin);
          },
        };
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
    assert.equal(profileCatalog.payload.value.plugins.length, 0);
    assert.equal(profileCatalog.payload.value.pluginDir, null);

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

test('project plugin packs mount on the agent scope and can be disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tsm-plugin-'));
  const project = join(directory, 'project');
  const plugins = join(project, '.dsh', 'plugins');
  await mkdir(join(project, '.git'), { recursive: true });
  await mkdir(plugins, { recursive: true });
  await writeFile(join(plugins, 'hello.mjs'), 'export default function hello() {}\n', 'utf8');

  const harness = createHarness({
    cwd: project,
    config: { disabledTools: [], disabledSkills: [], projects: { [project]: {} } },
  });
  const { record, invoke, eventually } = harness;
  const dispose = await apply(harness.ctx, record.config);

  try {
    await eventually(() => record.mounted.length === 1, 'project plugin was not mounted');
    const mounted = await invoke('getCatalog', { scope: project });
    assert.equal(mounted.status, 200);
    assert.equal(mounted.payload.value.pluginDir, plugins);
    assert.equal(mounted.payload.value.plugins.length, 1);
    assert.equal(mounted.payload.value.plugins[0].name, 'hello');
    assert.equal(mounted.payload.value.plugins[0].enabled, true);
    assert.equal(mounted.payload.value.plugins[0].status, 'mounted');

    const off = await invoke('setPluginEnabled', { scope: project, name: 'hello', enabled: false });
    assert.equal(off.status, 200);
    assert.deepEqual(record.config.projects[project].disabledPlugins, ['hello']);
    await eventually(() => record.disposed.length === 1, 'disabled plugin was not disposed');
    const disabledCatalog = await invoke('getCatalog', { scope: project });
    assert.equal(disabledCatalog.payload.value.plugins[0].enabled, false);
    assert.equal(disabledCatalog.payload.value.plugins[0].status, 'disabled');

    const on = await invoke('setPluginEnabled', { scope: project, name: 'hello', enabled: true });
    assert.equal(on.status, 200);
    await eventually(() => record.mounted.length === 2, 're-enabled plugin was not mounted again');

    const profile = await invoke('setPluginEnabled', { scope: 'profile', name: 'hello', enabled: false });
    assert.equal(profile.status, 400);
    assert.match(profile.payload.error, /load-time/);
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
  } finally {
    await dispose();
  }
});
