# 工具/技能管理 · Tools & Skills

A [DeepSeek Harness](https://github.com/deepseek-ai/dsh) bundle that manages **tools and skills per project**.

The profile-wide `disabledTools` / `disabledSkills` lists remain the defaults. Every project can then override individual entries — inherit, force on, or force off — without changing the profile or affecting other projects.

> 插件不在此管理范围内：DeepSeek Harness 在启动时一次性组合插件树，第三方插件无法按项目卸载。请到「设置 → 插件」管理已安装的插件；需要按项目扩展能力时，把工具/技能注册到项目自身的技能目录或 Agent 预设中。

## Install

```yaml
- id: tool-skill-manager
  name: '@local/tool-skill-manager'
  config:
    disabledTools: []      # profile default
    disabledSkills: []
    projects: {}           # per-project overrides
```

The `id` must stay unique and addressable: the Settings page persists through `configEditor`, which refuses to write an entry it cannot address unambiguously.

## Configuration

| Field | Meaning |
| --- | --- |
| `disabledTools` | Global tool names disabled for every project (the profile default) |
| `disabledSkills` | Global skill names disabled for every project |
| `projects.<absolute root>.tools.<name>` | `true` force-enables, `false` force-disables; omit to inherit |
| `projects.<absolute root>.skills.<name>` | Same override semantics for skills |

A project boundary is the nearest ancestor of the session's working directory that contains a `.git` marker — the same rule `dsh-skill-filesystem` uses for project skill roots, falling back to the working directory itself.

```yaml
- id: tool-skill-manager
  name: '@local/tool-skill-manager'
  config:
    disabledTools: [weather]
    disabledSkills: []
    projects:
      /Users/me/code/my-app:
        tools:
          weather: true        # force this tool on for this project
          code_interpreter: false
        skills:
          deploy: false
```

Overrides are machine-local: they live in the active profile's patch, not in the project repository.

## Settings page

Settings → Plugins → **工具/技能管理** (`Tools & Skills`).

- **Scope selector** — `Profile defaults` or any live/configured project. `Add project…` registers an absolute path; `Remove project` deletes its overrides.
- **Tools / Skills tabs** — search, per-row switches, bulk enable/disable, and (project scope) a tri-state override: inherit, force on, force off.
- **Skills** additionally shows source invocation policy and a project-scope “Keep only this” action.
- Sessions are re-evaluated on every `working-directory/change`: moving a session into another checkout immediately switches its tool restriction and skill overlay.

## Enforcement

- **Tools** — the effective project policy becomes a per-agent `tools.restrict({ deny })`; names are denied as soon as their plugin registers them, so a disabled tool never reaches the model.
- **Skills** — a per-agent provider overlays disabled entries as uninvocable (stable catalog), and a `skill`-tool guard refuses to load them.

## Development

```bash
npm test      # node --test test/*.test.js
```

The tests use a fake Cordis context: per-agent tool restrictions, skill overlay/guard, working-directory changes, project overrides, project registration/removal, and route validation.

## Limitations

- Only global tool registrations are listed; agent-scoped tools registered by presets or other plugins are managed by their own composition.
- Skills come from the Harness workspace catalog plus project roots (`<project>/.dsh/skills`, `<project>/.agents/skills`).
- Profile plugins are composed at startup and are intentionally out of scope.

## License

MIT
