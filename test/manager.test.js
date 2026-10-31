import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../index.js';

test('authenticated settings route persists per-Agent tool and skill policy', async () => {
  let route;
  let persisted = { disabledTools: ['beta'], disabledSkills: ['write'] };
  const toolRestrictions = [];
  const guards = [];
  const providers = [];
  const skill = {
    name: 'write',
    description: 'Write files',
    provider: 'project-skills',
    source: 'project-dsh',
    invocation: { modelInvocable: true, userInvocable: true },
  };
  const skills = {
    async snapshot() {
      return { complete: true, skills: [skill] };
    },
    registerProvider(factory) {
      const provider = factory({ invalidate() {} });
      providers.push(provider);
      return () => {};
    },
  };
  const agent = {
    id: 'agent-1',
    session: {},
    ctx: {
      get(name) {
        return name === 'skills' ? skills : undefined;
      },
      effect(create) {
        const cleanup = create();
        return () => cleanup?.();
      },
      tools: {
        restrict({ deny }) {
          toolRestrictions.push([...deny]);
          return () => {};
        },
        guard(guard) {
          guards.push(guard);
          return () => {};
        },
      },
    },
  };
  const ctx = {
    tools: {
      schemas: () => [{ name: 'alpha', description: 'Alpha' }, { name: 'beta', description: 'Beta' }],
    },
    agents: { list: () => [agent] },
    connection: {
      fetch: {
        register(value) {
          route = value;
          return async () => { route = undefined; };
        },
      },
    },
    workingDirectory: { get: () => '/workspace/project' },
    // A real Loader Entry keeps the row in `options` and exposes a tree-qualified `id`
    // ("include:tool-skill-manager"), with no `name`/`patchId` of its own.
    configEditor: {
      entries: () => [{ options: { id: 'tool-skill-manager', name: '@local/tool-skill-manager' }, id: 'include:tool-skill-manager', fiber: {} }],
      async edit(_entry, change) {
        persisted = change(persisted, {});
      },
    },
    logger: { warn() {} },
    on() { return () => {}; },
  };

  const dispose = await apply(ctx, persisted);
  try {
    assert.equal(route.path, '/api/tool-skill-manager');
    assert.deepEqual(route.methods, ['POST']);
    assert.deepEqual(toolRestrictions.at(-1), ['beta']);
    assert.match(guards[0]({ name: 'skill', arguments: { name: 'write' } }), /disabled/);
    assert.equal(providers[0].list()[0].invocation.modelInvocable, false);

    async function invoke(method, args) {
      const response = await route.fetch(new Request('http://localhost/api/tool-skill-manager', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      }));
      return { status: response.status, payload: await response.json() };
    }

    const initial = await invoke('getCatalog');
    assert.equal(initial.status, 200);
    assert.equal(initial.payload.value.tools.find((item) => item.name === 'beta').enabled, false);
    assert.equal(initial.payload.value.skills.find((item) => item.name === 'write').enabled, false);

    const keepOnly = await invoke('setOnly', { kind: 'skills', name: 'write' });
    assert.equal(keepOnly.status, 200);
    assert.deepEqual(persisted.disabledTools, ['beta']);
    assert.deepEqual(persisted.disabledSkills, []);

    const disableOne = await invoke('setEnabled', { kind: 'tools', name: 'alpha', enabled: false });
    assert.equal(disableOne.status, 200);
    assert.deepEqual(persisted.disabledTools, ['alpha', 'beta']);

    const enableBeta = await invoke('setEnabled', { kind: 'tools', name: 'beta', enabled: true });
    assert.equal(enableBeta.status, 200);
    assert.deepEqual(persisted.disabledTools, ['alpha']);
    assert.deepEqual(toolRestrictions.at(-1), ['alpha']);

    const enableSkill = await invoke('setEnabled', { kind: 'skills', name: 'write', enabled: true });
    assert.equal(enableSkill.status, 200);
    assert.deepEqual(persisted.disabledSkills, []);
    assert.equal(guards[0]({ name: 'skill', arguments: { name: 'write' } }), undefined);

    const invalid = await invoke('__proto__');
    assert.equal(invalid.status, 400);

    // Bulk actions scoped to an explicit name list must leave other rows untouched,
    // so a filtered view cannot silently rewrite the whole catalog.
    const scoped = await invoke('setAll', { kind: 'tools', enabled: false, names: ['alpha'] });
    assert.equal(scoped.status, 200);
    assert.equal(scoped.payload.value.affected, 1);
    assert.deepEqual(persisted.disabledTools, ['alpha']);

    const scopedEnable = await invoke('setAll', { kind: 'tools', enabled: true, names: ['alpha'] });
    assert.equal(scopedEnable.status, 200);
    assert.deepEqual(persisted.disabledTools, []);

    const unknownName = await invoke('setAll', { kind: 'tools', enabled: false, names: ['nope'] });
    assert.equal(unknownName.status, 400);
    assert.match(unknownName.payload.error, /Unknown tools: nope/);
  } finally {
    await dispose();
  }
});

test('a profile without an addressable entry refuses to save instead of silently dropping the policy', async () => {
  let route;
  const ctx = {
    tools: { schemas: () => [{ name: 'alpha', description: 'Alpha' }] },
    agents: { list: () => [] },
    connection: {
      fetch: {
        register(value) {
          route = value;
          return async () => {};
        },
      },
    },
    workingDirectory: { get: () => '/workspace/project' },
    // A bundle-only install: the inserted row is not addressable by configEditor.
    configEditor: {
      entries: () => [],
      async edit() {
        throw new Error('configEditor.edit must not be reached');
      },
    },
    logger: { warn() {} },
    on() { return () => {}; },
  };

  const dispose = await apply(ctx, { disabledTools: [], disabledSkills: [] });
  try {
    const response = await route.fetch(new Request('http://localhost/api/tool-skill-manager', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'setEnabled', args: { kind: 'tools', name: 'alpha', enabled: false } }),
    }));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /id: tool-skill-manager/);

    // The catalog is still readable, so the UI can show state while the save is refused.
    const catalog = await route.fetch(new Request('http://localhost/api/tool-skill-manager', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'getCatalog' }),
    }));
    assert.equal(catalog.status, 200);
  } finally {
    await dispose();
  }
});

test('a tool registered after attach is denied as soon as it appears', async () => {
  // dsh-free-search registers its tools lazily through `ctx.inject`, so at attach
  // time the catalog is still empty. A disabled tool must not be denied with a
  // name `restrict()` would reject, but it must be denied the moment it shows up
  // — before any turn assembles its system prompt — so it never leaks in.
  const registrations = [];
  let catalog = [];
  const toolChangeHandlers = [];
  const agent = {
    id: 'agent-lazy',
    session: {},
    ctx: {
      get(name) { return name === 'skills' ? { async snapshot() { return { skills: [] }; }, registerProvider() { return () => {}; } } : undefined; },
      effect(create) { const cleanup = create(); return () => cleanup?.(); },
      tools: {
        restrict({ deny }) {
          const known = new Set(catalog.map((tool) => tool.name));
          const unknown = [...deny].filter((name) => !known.has(name));
          if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool ${unknown.join(', ')}`);
          registrations.push([...deny]);
          return () => {};
        },
        guard() { return () => {}; },
      },
    },
  };
  const ctx = {
    tools: { schemas: () => catalog },
    agents: { list: () => [agent] },
    connection: { fetch: { register() { return async () => {}; } } },
    workingDirectory: { get: () => '/workspace/project' },
    configEditor: {
      entries: () => [{ options: { id: 'tool-skill-manager', name: '@local/tool-skill-manager' }, id: 'include:tool-skill-manager', fiber: {} }],
      async edit(_entry, change) { change({ disabledTools: ['weather'], disabledSkills: [] }, {}); },
    },
    logger: { warn() {} },
    on(event, handler) {
      if (event === 'tools/change') toolChangeHandlers.push(handler);
      return () => {};
    },
  };

  const dispose = await apply(ctx, { disabledTools: ['weather'], disabledSkills: [] });
  try {
    // Nothing registered yet: denying "weather" now would be rejected by restrict().
    assert.deepEqual(registrations, []);

    // The plugin now registers its tools; the real runtime emits tools/change.
    catalog = [{ name: 'weather', description: 'Weather' }];
    for (const handler of toolChangeHandlers) handler();

    assert.deepEqual(registrations, [['weather']]);
  } finally {
    await dispose();
  }
});
