import { existsSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PACKAGE_NAME = '@local/tool-skill-manager';
// The Loader reports the entry that mounted this very plugin, so its package name
// is authoritative even when the profile declares it under a different specifier
// (aliases, forks, or a locally renamed build).
let MOUNTED_NAME = PACKAGE_NAME;
const PROVIDER_NAME = 'tool-skill-manager-disabled';
const PLUGIN_ID = 'tool-skill-manager';
const DISABLED_INVOCATION = Object.freeze({ modelInvocable: false, userInvocable: false });
const PROFILE_SCOPE = 'profile';
const PLUGIN_DIRECTORY = ['.dsh', 'plugins'];
const PLUGIN_EXTENSIONS = new Set(['.mjs', '.js']);

export const inject = ['agents', 'configEditor', 'connection', 'tools', 'workingDirectory'];

let activeRuntime;

function asSet(value, validate = () => true) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .filter((item) => typeof item === 'string' && item.trim() && validate(item.trim()))
      .map((item) => item.trim()),
  );
}

function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name);
}

function errorText(error) {
  return String((error && error.message) || error || 'Unknown error');
}

function warn(ctx, message, error) {
  try {
    ctx.logger.warn(error === undefined ? message : `${message}: ${errorText(error)}`);
  } catch {
    // Logging must not interfere with policy enforcement.
  }
}

function toolNameSet(tools) {
  return new Set(tools.schemas().map((tool) => tool.name));
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRoot(value) {
  return resolve(value);
}

function resolveDirectory(value) {
  const resolved = resolve(value);
  try {
    return statSync(resolved).isDirectory() ? resolved : dirname(resolved);
  } catch {
    return resolved;
  }
}

/**
 * The project a working directory belongs to: the nearest ancestor that owns a
 * `.git` marker. This is the same rule `dsh-skill-filesystem` uses for project
 * skill roots, so project policy and project skills agree on their boundaries.
 */
function projectRootFor(cwd) {
  const start = resolveDirectory(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  let directory = start;
  for (;;) {
    if (existsSync(join(directory, '.git'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return start;
    directory = parent;
  }
}

function asOverride(value, validate = () => true) {
  const overrides = new Map();
  if (!isPlainRecord(value)) return overrides;
  for (const [rawName, enabled] of Object.entries(value)) {
    if (typeof rawName !== 'string' || typeof enabled !== 'boolean') continue;
    const name = rawName.trim();
    if (!name || !validate(name)) continue;
    overrides.set(name, enabled);
  }
  return overrides;
}

function loadProjects(value) {
  const projects = new Map();
  if (!isPlainRecord(value)) return projects;
  for (const [rawRoot, rawEntry] of Object.entries(value)) {
    if (typeof rawRoot !== 'string' || !isAbsolute(rawRoot.trim()) || !isPlainRecord(rawEntry)) continue;
    projects.set(normalizeRoot(rawRoot.trim()), {
      tools: asOverride(rawEntry.tools),
      skills: asOverride(rawEntry.skills, isSkillName),
      disabledPlugins: asSet(rawEntry.disabledPlugins),
    });
  }
  return projects;
}

export async function apply(ctx, config = {}) {
  await activeRuntime?.dispose();

  const tools = ctx.tools;
  const agents = ctx.agents;
  const connection = ctx.connection;
  const workingDirectory = ctx.workingDirectory;
  const configEditor = ctx.configEditor;
  const agentStates = new Map();
  const disposers = [];
  let disabledTools = asSet(config.disabledTools);
  let disabledSkills = asSet(config.disabledSkills, isSkillName);
  let projects = loadProjects(config.projects);
  let live = true;

  try {
    const entry = ctx[Symbol.for('cordis.entry')];
    if (typeof entry?.options?.name === 'string' && entry.options.name) MOUNTED_NAME = entry.options.name;
  } catch {
    // The entry symbol is optional metadata; the package name stays the fallback.
  }

  function emptyProject() {
    return { tools: new Map(), skills: new Map(), disabledPlugins: new Set() };
  }

  function projectEntry(root, create = false) {
    if (root === PROFILE_SCOPE) return undefined;
    let entry = projects.get(root);
    if (!entry && create) {
      entry = emptyProject();
      projects.set(root, entry);
    }
    return entry;
  }

  function effectiveDisabled(root, kind) {
    const base = kind === 'tools' ? disabledTools : disabledSkills;
    const policy = new Set(base);
    const overrides = projectEntry(root)?.[kind];
    if (overrides) {
      for (const [name, enabled] of overrides) {
        if (enabled) policy.delete(name);
        else policy.add(name);
      }
    }
    return policy;
  }

  function capture() {
    return {
      disabledTools: new Set(disabledTools),
      disabledSkills: new Set(disabledSkills),
      projects: new Map(
        [...projects].map(([root, entry]) => [
          root,
          {
            tools: new Map(entry.tools),
            skills: new Map(entry.skills),
            disabledPlugins: new Set(entry.disabledPlugins),
          },
        ]),
      ),
    };
  }

  function restore(snapshot) {
    disabledTools = new Set(snapshot.disabledTools);
    disabledSkills = new Set(snapshot.disabledSkills);
    projects = new Map(
      [...snapshot.projects].map(([root, entry]) => [
        root,
        {
          tools: new Map(entry.tools),
          skills: new Map(entry.skills),
          disabledPlugins: new Set(entry.disabledPlugins),
        },
      ]),
    );
  }

  function projectsForConfig() {
    const serialized = {};
    for (const [root, entry] of [...projects].sort(([left], [right]) => left.localeCompare(right))) {
      const tools = Object.fromEntries([...entry.tools].sort(([left], [right]) => left.localeCompare(right)));
      const skills = Object.fromEntries([...entry.skills].sort(([left], [right]) => left.localeCompare(right)));
      const disabledPlugins = [...entry.disabledPlugins].sort();
      serialized[root] = {
        ...(Object.keys(tools).length > 0 ? { tools } : {}),
        ...(Object.keys(skills).length > 0 ? { skills } : {}),
        ...(disabledPlugins.length > 0 ? { disabledPlugins } : {}),
      };
    }
    return serialized;
  }

  function scopeKey(value) {
    if (value === undefined || value === null || value === '' || value === PROFILE_SCOPE) return PROFILE_SCOPE;
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new Error('Expected scope to be "profile" or an absolute project directory.');
    }
    return normalizeRoot(value);
  }

  function safeCwd(agent) {
    try {
      const cwd = workingDirectory.get(agent.session);
      return typeof cwd === 'string' && cwd ? cwd : undefined;
    } catch {
      return undefined;
    }
  }

  function agentRoot(agent) {
    const cwd = safeCwd(agent);
    return cwd ? projectRootFor(cwd) : null;
  }

  function assertKind(kind) {
    if (kind !== 'tools' && kind !== 'skills') {
      throw new Error('Expected kind to be "tools" or "skills".');
    }
  }

  function assertName(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Expected a non-empty name.');
    return name.trim();
  }

  function findConfigEntry() {
    const entries = configEditor.entries();
    const matches = entries.filter((candidate) => {
      if (candidate?.options?.name === MOUNTED_NAME) return true;
      return candidate?.id === PLUGIN_ID || (typeof candidate?.id === 'string' && candidate.id.endsWith(`:${PLUGIN_ID}`));
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  async function persistNow() {
    const entry = findConfigEntry();
    if (!entry) {
      throw new Error('The Tools, Skills and Plugins Manager config entry is unavailable: this profile has no uniquely addressable `- id: tool-skill-manager` row, so the Settings page cannot save. Add that row to the profile cordis.patch.yml (or remove the duplicate) and restart.');
    }
    await configEditor.edit(entry, (current) => ({
      ...current,
      disabledTools: [...disabledTools].sort(),
      disabledSkills: [...disabledSkills].sort(),
      projects: projectsForConfig(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Skill overlay: disabled skills stay listed as uninvocable so the catalog is
  // stable, but the `skill` tool guard refuses to load them for this agent.
  // ---------------------------------------------------------------------------

  async function primeOriginals(state) {
    const service = state.agent.ctx.get('skills');
    state.originals = new Map();
    if (!service) return;
    const cwd = state.cwd || safeCwd(state.agent);
    try {
      const snapshot = await service.snapshot({ cwd });
      for (const skill of snapshot.skills) {
        if (skill.provider === PROVIDER_NAME) continue;
        state.originals.set(skill.name, skill);
      }
    } catch (error) {
      warn(ctx, `Could not read skills for agent ${state.agent.id}`, error);
    }
  }

  function registerSkillProvider(state) {
    const service = state.agent.ctx.get('skills');
    if (!service) return;
    state.providerRelease = service.registerProvider((control) => {
      state.providerControl = control;
      return {
        name: PROVIDER_NAME,
        list() {
          const rows = [];
          for (const name of state.effectiveSkills) {
            const original = state.originals.get(name);
            rows.push({
              name,
              description: original?.description || `Skill "${name}" is disabled for this project.`,
              ...(original?.whenToUse ? { whenToUse: original.whenToUse } : {}),
              invocation: DISABLED_INVOCATION,
              source: original?.source || 'runtime',
              provider: PROVIDER_NAME,
              ...(original?.resourceBase ? { resourceBase: original.resourceBase } : {}),
              rank: Number.MIN_SAFE_INTEGER,
            });
          }
          return rows;
        },
        async get(candidate) {
          const name = typeof candidate === 'string' ? candidate : candidate?.name;
          if (typeof name !== 'string' || !state.effectiveSkills.has(name)) return undefined;
          const original = state.originals.get(name);
          return {
            name,
            description: original?.description || candidate?.description || `Skill "${name}" is disabled for this project.`,
            ...(original?.whenToUse ? { whenToUse: original.whenToUse } : {}),
            invocation: DISABLED_INVOCATION,
            source: original?.source || candidate?.source || 'runtime',
            provider: PROVIDER_NAME,
            ...(original?.resourceBase ? { resourceBase: original.resourceBase } : {}),
            content: `The skill "${name}" is disabled for project ${state.projectRoot ?? 'this workspace'} by the Tools, Skills and Plugins Manager.`,
          };
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Tool restriction: the effective project policy becomes a per-agent deny set.
  // ---------------------------------------------------------------------------

  function syncToolRestriction(state) {
    // `tools.restrict({ deny })` rejects names that are not yet registered, so a
    // disabled tool can only be denied once its plugin has registered it. Tools
    // arrive lazily (`dsh-free-search` registers through `ctx.inject`), so the
    // synchronous pass at attach time usually sees only a subset.
    //
    // Denying as early as each name becomes available keeps the tool out of every
    // `schemas()` projection, and the system prompt is re-assembled at the start
    // of each turn, so a name denied before the turn begins never reaches the
    // model and never perturbs the prompt cache. `tools/change` fires on every
    // registration, which is what drives the retry.
    const available = new Set(toolNameSet(tools));
    const deny = [...state.effectiveTools].filter((name) => available.has(name)).sort();
    const signature = deny.join('\n');
    if (signature === state.restrictionSignature) return;
    state.toolRelease?.();
    state.toolRelease = undefined;
    state.restrictionSignature = signature;
    if (deny.length === 0) return;
    state.toolRelease = state.agent.ctx.effect(
      () => state.agent.ctx.tools.restrict({ deny }),
      `${PACKAGE_NAME}.tools.${state.agent.id}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Project plugin packs: `<projectRoot>/.dsh/plugins/*.mjs` default-export a
  // Cordis plugin. Mounting it on the agent context gives the project its own
  // tools and skills and unmounts them with the project policy.
  // ---------------------------------------------------------------------------

  async function listProjectPlugins(root) {
    const directory = join(root, ...PLUGIN_DIRECTORY);
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') warn(ctx, `Could not read project plugin directory ${directory}`, error);
      return [];
    }
    const files = [];
    for (const dirent of dirents) {
      if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;
      const dot = dirent.name.lastIndexOf('.');
      if (dot <= 0) continue;
      const extension = dirent.name.slice(dot);
      if (!PLUGIN_EXTENSIONS.has(extension)) continue;
      files.push({
        name: dirent.name.slice(0, dot),
        fileName: dirent.name,
        path: join(directory, dirent.name),
      });
    }
    files.sort((left, right) => left.name.localeCompare(right.name));
    return files;
  }

  async function releaseMount(mount) {
    try {
      await mount?.release?.();
    } catch (error) {
      warn(ctx, 'Could not release a project plugin', error);
    }
  }

  function schedulePluginSync(state) {
    state.pluginQueue = (state.pluginQueue || Promise.resolve())
      .then(() => syncProjectPlugins(state))
      .catch((error) => warn(ctx, `Could not sync project plugins for agent ${state.agent.id}`, error));
    return state.pluginQueue;
  }

  async function syncProjectPlugins(state) {
    if (!state.active) return;
    // A failed mount is retried on the next sync so a transient import error does
    // not leave the project without its tools for the rest of the session.
    for (const [name, mount] of [...state.pluginMounts]) {
      if (mount.failed) state.pluginMounts.delete(name);
    }
    const files = state.projectRoot ? await listProjectPlugins(state.projectRoot) : [];
    const disabled = projectEntry(state.projectRoot)?.disabledPlugins ?? new Set();
    const wanted = new Map(files.filter((file) => !disabled.has(file.name)).map((file) => [file.name, file]));

    for (const [name, mount] of [...state.pluginMounts]) {
      const file = wanted.get(name);
      if (file && file.path === mount.path) continue;
      await releaseMount(mount);
      state.pluginMounts.delete(name);
    }

    for (const [name, file] of wanted) {
      if (state.pluginMounts.has(name)) continue;
      try {
        const info = await stat(file.path);
        const module = await import(`${pathToFileURL(file.path).href}?v=${info.mtimeMs}`);
        const plugin = module.default ?? module;
        const fiber = state.agent.ctx.plugin(plugin);
        // Cordis fibers are awaitable; awaiting surfaces activation failures here
        // instead of as an unhandled rejection later.
        await Promise.resolve(fiber);
        state.pluginMounts.set(name, {
          path: file.path,
          release: async () => {
            try {
              await fiber?.dispose?.();
            } catch {
              // Disposal is best-effort while the agent is shutting down.
            }
          },
        });
      } catch (error) {
        warn(ctx, `Project plugin "${name}" failed to mount`, error);
        state.pluginMounts.set(name, {
          path: file.path,
          failed: true,
          error: errorText(error),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Catalogs.
  // ---------------------------------------------------------------------------

  function liveProjects() {
    const live = new Map();
    for (const agent of agents.list()) {
      const cwd = safeCwd(agent);
      if (!cwd) continue;
      const root = projectRootFor(cwd);
      const row = live.get(root) ?? { root, agents: 0, cwd };
      row.agents += 1;
      live.set(root, row);
    }
    return live;
  }

  async function catalogPlugins(root) {
    if (root === PROFILE_SCOPE) return [];
    const files = await listProjectPlugins(root);
    const policy = projectEntry(root)?.disabledPlugins ?? new Set();
    const statuses = new Map();
    for (const state of agentStates.values()) {
      if (state.projectRoot !== root) continue;
      for (const [name, mount] of state.pluginMounts) {
        if (mount.failed) statuses.set(name, { status: 'failed', error: mount.error });
        else statuses.set(name, { status: 'mounted' });
      }
    }
    return files.map((file) => {
      const live = statuses.get(file.name);
      return {
        name: file.name,
        fileName: file.fileName,
        path: file.path,
        enabled: !policy.has(file.name),
        status: live?.status ?? (policy.has(file.name) ? 'disabled' : 'available'),
        ...(live?.error ? { error: live.error } : {}),
      };
    });
  }

  async function catalogSkills(scope, scopeAgents) {
    // The root context normally owns the workspace skill service. Some embedders
    // and the test harness only expose per-agent services, so fall back to the
    // first scoped agent instead of failing the whole catalog.
    const service = typeof ctx.get === 'function' ? ctx.get('skills') : undefined;
    const rows = new Map();
    if (!service && scopeAgents.length === 0) return [];
    const add = (snapshot) => {
      if (!snapshot || !Array.isArray(snapshot.skills)) return;
      for (const skill of snapshot.skills) {
        if (skill.provider === PROVIDER_NAME) continue;
        if (!rows.has(skill.name)) rows.set(skill.name, skill);
      }
    };
    const cwds = new Set();
    if (scope === PROFILE_SCOPE) {
      for (const agent of agents.list()) {
        const cwd = safeCwd(agent);
        if (cwd) cwds.add(cwd);
      }
    } else {
      cwds.add(scope);
      for (const agent of scopeAgents) {
        const cwd = safeCwd(agent);
        if (cwd) cwds.add(cwd);
      }
    }
    if (cwds.size === 0) cwds.add(process.cwd());
    const baseService = service || (scopeAgents[0] ? scopeAgents[0].ctx.get('skills') : undefined);
    for (const cwd of cwds) {
      if (!baseService) break;
      try {
        add(await baseService.snapshot({ cwd }));
      } catch (error) {
        warn(ctx, `Could not read the skill catalog for ${cwd}`, error);
      }
    }
    // Agent-scoped providers (project plugin packs) only appear in a scoped
    // snapshot; add the ones the global catalog does not know yet.
    for (const agent of scopeAgents) {
      try {
        const scoped = agent.ctx.get('skills');
        if (!scoped) continue;
        add(await scoped.snapshot({ cwd: safeCwd(agent) || scope, scope: agent }));
      } catch (error) {
        warn(ctx, `Could not read scoped skills for agent ${agent.id}`, error);
      }
    }

    const base = disabledSkills;
    const overrides = projectEntry(scope)?.skills;
    return [...rows.values()]
      .map((skill) => {
        const override = overrides?.has(skill.name) ? overrides.get(skill.name) : null;
        const baseEnabled = !base.has(skill.name);
        return {
          name: skill.name,
          description: skill.description || '',
          provider: skill.provider || null,
          source: skill.source || null,
          modelPolicy: skill.invocation?.modelInvocable !== false,
          userPolicy: skill.invocation?.userInvocable !== false,
          baseEnabled,
          override,
          enabled: scope === PROFILE_SCOPE ? baseEnabled : override ?? baseEnabled,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function catalogTools(scope) {
    const overrides = projectEntry(scope)?.tools;
    const base = disabledTools;
    return tools
      .schemas()
      .map((tool) => {
        const override = overrides?.has(tool.name) ? overrides.get(tool.name) : null;
        const baseEnabled = !base.has(tool.name);
        return {
          name: tool.name,
          description: tool.description || '',
          provider: null,
          source: null,
          baseEnabled,
          override,
          enabled: scope === PROFILE_SCOPE ? baseEnabled : override ?? baseEnabled,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function getCatalog(args = {}) {
    const scope = scopeKey(args?.scope);
    const allAgents = agents.list();
    const lives = liveProjects();
    const scopeAgents = scope === PROFILE_SCOPE
      ? allAgents
      : allAgents.filter((agent) => {
          const cwd = safeCwd(agent);
          return cwd ? projectRootFor(cwd) === scope : false;
        });
    const projectRows = new Map();
    for (const [root, info] of lives) projectRows.set(root, { root, configured: projects.has(root), agents: info.agents });
    for (const root of projects.keys()) {
      if (!projectRows.has(root)) projectRows.set(root, { root, configured: true, agents: 0 });
    }
    if (scope !== PROFILE_SCOPE && !projectRows.has(scope)) {
      projectRows.set(scope, { root: scope, configured: false, agents: 0 });
    }
    return {
      scope,
      activeAgents: allAgents.length,
      projects: [...projectRows.values()].sort((left, right) => left.root.localeCompare(right.root)),
      tools: catalogTools(scope),
      skills: await catalogSkills(scope, scopeAgents),
      plugins: await catalogPlugins(scope),
      pluginDir: scope === PROFILE_SCOPE ? null : join(scope, ...PLUGIN_DIRECTORY),
      profilePluginScope: scope === PROFILE_SCOPE,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations.
  // ---------------------------------------------------------------------------

  async function reapplyAll() {
    await Promise.allSettled([...agentStates.values()].map((state) => applyAgentPolicy(state)));
  }

  async function commitChange(scope) {
    const previous = capture();
    try {
      await reapplyAll();
      await persistNow();
    } catch (error) {
      restore(previous);
      await reapplyAll();
      throw error;
    }
    return getCatalog({ scope });
  }

  async function knownEntries(scope, kind) {
    if (scope === PROFILE_SCOPE) {
      return kind === 'tools' ? catalogTools(PROFILE_SCOPE) : catalogSkills(PROFILE_SCOPE, agents.list());
    }
    return kind === 'tools' ? catalogTools(scope) : catalogSkills(scope, agents.list().filter((agent) => agentRoot(agent) === scope));
  }

  async function setEnabled(args) {
    if (!isPlainRecord(args)) throw new Error('Expected { scope?, kind, name, enabled }.');
    const scope = scopeKey(args.scope);
    const kind = args.kind;
    assertKind(kind);
    const name = assertName(args.name);
    if (typeof args.enabled !== 'boolean') throw new Error('Expected `enabled` to be a boolean.');
    const entries = await knownEntries(scope, kind);
    if (!entries.some((entry) => entry.name === name)) throw new Error(`Unknown ${kind.slice(0, -1)}: ${name}`);
    if (scope === PROFILE_SCOPE) {
      const target = kind === 'tools' ? disabledTools : disabledSkills;
      if (args.enabled) target.delete(name);
      else target.add(name);
    } else {
      const entry = projectEntry(scope, true);
      entry[kind].set(name, args.enabled);
    }
    return commitChange(scope);
  }

  async function setOverride(args) {
    if (!isPlainRecord(args)) throw new Error('Expected { scope, kind, name, value }.');
    const scope = scopeKey(args.scope);
    if (scope === PROFILE_SCOPE) throw new Error('Profile rows use setEnabled, not per-project overrides.');
    const kind = args.kind;
    assertKind(kind);
    const name = assertName(args.name);
    if (args.value !== null && typeof args.value !== 'boolean') {
      throw new Error('Expected `value` to be true, false, or null.');
    }
    const entries = await knownEntries(scope, kind);
    if (!entries.some((entry) => entry.name === name)) throw new Error(`Unknown ${kind.slice(0, -1)}: ${name}`);
    const entry = projectEntry(scope, true);
    if (args.value === null) entry[kind].delete(name);
    else entry[kind].set(name, args.value);
    return commitChange(scope);
  }

  async function setAll(args) {
    if (!isPlainRecord(args) || !['tools', 'skills'].includes(args.kind) || typeof args.enabled !== 'boolean') {
      throw new Error('Expected { scope?, kind: "tools" | "skills", enabled: boolean, names?: string[] }.');
    }
    if (args.names !== undefined && (!Array.isArray(args.names) || args.names.some((name) => typeof name !== 'string'))) {
      throw new Error('Expected `names` to be an array of strings.');
    }
    const scope = scopeKey(args.scope);
    const known = await knownEntries(scope, args.kind);
    const knownNames = new Set(known.map((entry) => entry.name));
    const target = args.names === undefined ? known : known.filter((entry) => args.names.includes(entry.name));
    if (args.names !== undefined) {
      const unknown = args.names.filter((name) => !knownNames.has(name));
      if (unknown.length > 0) throw new Error(`Unknown ${args.kind}: ${unknown.join(', ')}`);
    }
    if (scope === PROFILE_SCOPE) {
      const set = args.kind === 'tools' ? disabledTools : disabledSkills;
      for (const entry of target) {
        if (args.enabled) set.delete(entry.name);
        else set.add(entry.name);
      }
    } else {
      const entry = projectEntry(scope, true);
      for (const row of target) entry[args.kind].set(row.name, args.enabled);
    }
    await commitChange(scope);
    return { ok: true, affected: target.length };
  }

  async function clearAll(args) {
    if (!isPlainRecord(args) || !['tools', 'skills'].includes(args.kind)) {
      throw new Error('Expected { scope, kind: "tools" | "skills", names?: string[] }.');
    }
    const scope = scopeKey(args.scope);
    if (scope === PROFILE_SCOPE) throw new Error('Profile rows have no overrides to clear.');
    const known = await knownEntries(scope, args.kind);
    const names = args.names === undefined ? known.map((entry) => entry.name) : args.names;
    const entry = projectEntry(scope, true);
    for (const name of names) entry[args.kind].delete(name);
    return commitChange(scope);
  }

  async function setOnly(args) {
    if (!isPlainRecord(args) || args.kind !== 'skills' || typeof args.name !== 'string') {
      throw new Error('Expected { scope?, kind: "skills", name: string }. Use per-tool switches to keep other tools active.');
    }
    const scope = scopeKey(args.scope);
    const entries = await knownEntries(scope, 'skills');
    if (!entries.some((entry) => entry.name === args.name)) throw new Error(`Unknown skill: ${args.name}`);
    const names = new Set(entries.map((entry) => entry.name));
    if (scope === PROFILE_SCOPE) {
      for (const name of names) {
        if (name === args.name) disabledSkills.delete(name);
        else disabledSkills.add(name);
      }
    } else {
      const entry = projectEntry(scope, true);
      for (const name of names) entry.skills.set(name, name === args.name);
    }
    return commitChange(scope);
  }

  async function setPluginEnabled(args) {
    if (!isPlainRecord(args) || typeof args.enabled !== 'boolean' || typeof args.name !== 'string') {
      throw new Error('Expected { scope, name, enabled }.');
    }
    const scope = scopeKey(args.scope);
    if (scope === PROFILE_SCOPE) {
      throw new Error('Profile plugins are load-time and managed in Settings → Plugins; this page only manages project plugin packs.');
    }
    const files = await listProjectPlugins(scope);
    if (!files.some((file) => file.name === args.name)) throw new Error(`Unknown project plugin: ${args.name}`);
    const entry = projectEntry(scope, true);
    if (args.enabled) entry.disabledPlugins.delete(args.name);
    else entry.disabledPlugins.add(args.name);
    return commitChange(scope);
  }

  async function addProject(args) {
    if (!isPlainRecord(args) || typeof args.root !== 'string' || !isAbsolute(args.root)) {
      throw new Error('Expected { root: absolute directory }.');
    }
    const root = normalizeRoot(args.root);
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Not a directory: ${root}`);
    if (!projects.has(root)) projects.set(root, emptyProject());
    return commitChange(root);
  }

  async function removeProject(args) {
    if (!isPlainRecord(args) || typeof args.root !== 'string') throw new Error('Expected { root }.');
    const root = normalizeRoot(args.root);
    projects.delete(root);
    return commitChange(root);
  }

  async function refreshProjectPlugins(args) {
    const scope = scopeKey(args?.scope);
    if (scope === PROFILE_SCOPE) throw new Error('Profile plugins are load-time and cannot be reloaded from this page.');
    await reapplyAll();
    return getCatalog({ scope });
  }

  async function applyAgentPolicy(state) {
    if (!state.active) return;
    const cwd = safeCwd(state.agent);
    const root = cwd ? projectRootFor(cwd) : null;
    const changed = root !== state.projectRoot || cwd !== state.cwd;
    state.cwd = cwd;
    state.projectRoot = root;
    state.effectiveTools = effectiveDisabled(root, 'tools');
    state.effectiveSkills = effectiveDisabled(root, 'skills');
    syncToolRestriction(state);
    if (changed) await primeOriginals(state);
    state.providerControl?.invalidate();
    schedulePluginSync(state);
    await state.pluginQueue;
  }

  async function attachAgent(agent) {
    const existing = agentStates.get(agent);
    if (existing) return existing.ready;
    const cwd = safeCwd(agent);
    const root = cwd ? projectRootFor(cwd) : null;
    const state = {
      agent,
      active: true,
      cwd,
      projectRoot: root,
      originals: new Map(),
      ready: Promise.resolve(),
      effectiveTools: effectiveDisabled(root, 'tools'),
      effectiveSkills: effectiveDisabled(root, 'skills'),
      restrictionSignature: null,
      toolRelease: undefined,
      guardRelease: undefined,
      providerRelease: undefined,
      providerControl: undefined,
      pluginMounts: new Map(),
      pluginQueue: Promise.resolve(),
    };
    agentStates.set(agent, state);

    state.guardRelease = agent.ctx.effect(
      () => agent.ctx.tools.guard((execution) => {
        const name = execution?.arguments?.name;
        if (execution?.name !== 'skill' || typeof name !== 'string') return undefined;
        if (!state.effectiveSkills.has(name)) return undefined;
        return `Skill "${name}" is disabled for project ${state.projectRoot ?? 'this workspace'}.`;
      }),
      `${PACKAGE_NAME}.skill-guard.${agent.id}`,
    );
    syncToolRestriction(state);

    state.ready = (async () => {
      try {
        await primeOriginals(state);
        registerSkillProvider(state);
        state.providerControl?.invalidate();
        schedulePluginSync(state);
        await state.pluginQueue;
      } catch (error) {
        // A broken skill service or project plugin must not take down the whole
        // manager; tool restrictions are already in effect.
        warn(ctx, `Could not finish policy setup for agent ${agent.id}`, error);
      }
    })();
    return state.ready;
  }

  async function disposeAgent(agent, release = true) {
    const state = agentStates.get(agent);
    if (!state) return;
    state.active = false;
    agentStates.delete(agent);
    for (const mount of state.pluginMounts.values()) await releaseMount(mount);
    state.pluginMounts.clear();
    if (release) {
      try {
        state.toolRelease?.();
        state.guardRelease?.();
        state.providerRelease?.();
      } catch {
        // The agent context may already be tearing down.
      }
    }
  }

  const releaseApiRoute = connection.fetch.register({
    path: '/api/tool-skill-manager',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const payload = await request.json();
        const handlers = {
          getCatalog,
          setEnabled,
          setOverride,
          setAll,
          clearAll,
          setOnly,
          setPluginEnabled,
          addProject,
          removeProject,
          refreshProjectPlugins,
        };
        if (!isPlainRecord(payload) || typeof payload.method !== 'string' || !Object.hasOwn(handlers, payload.method)) {
          throw new Error('Unknown Tools, Skills and Plugins Manager request.');
        }
        const value = await handlers[payload.method](payload.args);
        return Response.json({ ok: true, value });
      } catch (error) {
        return Response.json({ ok: false, error: errorText(error) }, { status: 400 });
      }
    },
  });

  disposers.push(ctx.on('tools/change', () => {
    for (const state of agentStates.values()) syncToolRestriction(state);
  }));
  disposers.push(ctx.on('agent/created', ({ agent }) => {
    try {
      return Promise.resolve(attachAgent(agent)).catch((error) => {
        warn(ctx, `Could not attach policy to agent ${agent.id}`, error);
      });
    } catch (error) {
      warn(ctx, `Could not attach policy to agent ${agent.id}`, error);
      return undefined;
    }
  }));
  disposers.push(ctx.on('agent/disposed', ({ agent }) => disposeAgent(agent, false)));
  disposers.push(ctx.on('session/event', (session, event) => {
    if (event?.type !== 'working-directory/change') return;
    for (const state of agentStates.values()) {
      if (state.agent.session !== session) continue;
      void applyAgentPolicy(state);
    }
  }));

  const dispose = async () => {
    if (!live) return;
    live = false;
    for (const release of disposers.splice(0)) {
      try {
        release();
      } catch {
        // Event disposers are idempotent; shutdown must not throw.
      }
    }
    for (const agent of [...agentStates.keys()]) await disposeAgent(agent);
    try {
      await releaseApiRoute();
    } finally {
      if (activeRuntime === runtime) activeRuntime = undefined;
    }
  };

  const runtime = {
    getCatalog,
    setEnabled,
    setOverride,
    setAll,
    clearAll,
    setOnly,
    setPluginEnabled,
    addProject,
    removeProject,
    refreshProjectPlugins,
    dispose,
  };
  activeRuntime = runtime;

  try {
    await Promise.all(agents.list().map((agent) => attachAgent(agent)));
  } catch (error) {
    await dispose();
    throw error;
  }
  return dispose;
}

function requireRuntime() {
  if (!activeRuntime) throw new Error('Tools, Skills and Plugins Manager is not active.');
  return activeRuntime;
}

export async function getCatalog(args) {
  return requireRuntime().getCatalog(args);
}

export async function setEnabled(args) {
  return requireRuntime().setEnabled(args);
}

export async function setOverride(args) {
  return requireRuntime().setOverride(args);
}

export async function setAll(args) {
  return requireRuntime().setAll(args);
}

export async function clearAll(args) {
  return requireRuntime().clearAll(args);
}

export async function setOnly(args) {
  return requireRuntime().setOnly(args);
}

export async function setPluginEnabled(args) {
  return requireRuntime().setPluginEnabled(args);
}

export async function addProject(args) {
  return requireRuntime().addProject(args);
}

export async function removeProject(args) {
  return requireRuntime().removeProject(args);
}

export async function refreshProjectPlugins(args) {
  return requireRuntime().refreshProjectPlugins(args);
}
