# Tools, Skills & Plugins Manager

A [DeepSeek Harness](https://github.com/deepseek-ai/dsh) bundle that manages **tools, skills, and project plugin packs per project**.

The profile-wide `disabledTools` / `disabledSkills` lists remain the defaults. Every project can then override individual entries (inherit, force on, force off) and add its own plugins under `.dsh/plugins/` — without changing the profile or affecting other projects.

## Project boundary

A **project** is the nearest ancestor of the working directory that contains a `.git` marker, falling back to the working directory itself. This is the same rule `@deepseek-ai/dsh-skill-filesystem` uses for project skill roots, so project policy and project skills agree on their boundaries.

Sessions are re-evaluated on every `working-directory/change`: moving a session into another checkout immediately switches its tool restriction, skill overlay, and project plugin mounts.

## Install

```yaml
# <profile>/cordis.patch.yml
- id: tool-skill-manager
  name: '@local/tool-skill-manager'
  config:
    disabledTools: []
    disabledSkills: []
```

The bundle also inserts its own row, so a profile that only links the package still mounts it. Keep the row id unique and stable: the Settings page persists through `configEditor`, which only addresses an entry whose id appears exactly once in the profile root.

## Configuration

```yaml
- id: tool-skill-manager
  name: '@local/tool-skill-manager'
  config:
    # Profile defaults, applied to every project.
    disabledTools: [weather]
    disabledSkills: [some-skill]

    # Optional per-project overrides, keyed by absolute project root.
    projects:
      /Users/me/code/my-app:
        tools:
          weather: true        # force-enable although disabled profile-wide
          web_search: false    # force-disable for this project only
        skills:
          deploy: false
        disabledPlugins: [experimental-pack]
```

| Field | Meaning |
|---|---|
| `disabledTools` | Profile-wide tool names denied to every agent |
| `disabledSkills` | Profile-wide skill names denied to every agent |
| `projects.<root>.tools` | `true` force-enables, `false` force-disables for that project |
| `projects.<root>.skills` | Same, for skills |
| `projects.<root>.disabledPlugins` | Project plugin pack file stems that stay unmounted |

Effective policy = profile defaults with the project's overrides applied. An override of `true` wins over a profile-wide disable; `false` wins over the default enable.

## Settings page

Settings → Plugins → **Tools, Skills & Plugins**.

- **Scope selector** — `Profile defaults` or any live/configured project. `Add project…` registers an absolute path; `Remove project` deletes its overrides (plugin files are left alone).
- **Tools / Skills** — profile scope uses a checkbox; project scope uses a three-state control (inherit / force on / force off) and shows the profile default. Bulk actions only touch the rows currently visible under the search filter.
- **Plugins** — profile scope explains that profile plugins load at startup and are managed under Settings → Plugins; project scope lists `.dsh/plugins/*.mjs` packs with mount status and per-pack toggles.

## Project plugin packs

Profile plugins are composed once at startup and cannot be unloaded for a single project. The supported per-project extension point is a **plugin pack**:

```
my-app/
  .dsh/
    plugins/
      experimental.mjs
```

```js
// my-app/.dsh/plugins/experimental.mjs
export default function experimental(ctx) {
  ctx.tools.register({ /* ordinary Cordis tool definition */ });
  ctx.skills.registerProvider(() => ({ /* ... */ }));
}
```

The default export is a normal Cordis plugin. The manager mounts it on the **agent context** of sessions whose project root contains that file, so tools and skills it registers are scoped to those sessions and disappear when the project changes, the pack is disabled, or the session ends. Packs are re-imported from disk by mtime when reloaded; failures are surfaced in the UI and retried on the next synchronization.

Because mounting is agent-scoped, a pack can shadow a profile tool name for its own project while other projects keep the global registration.

## Development

```bash
npm test          # node --test test/*.test.js
```

The tests use a fake Cordis context: per-agent tool restrictions, skill overlay/guard, working-directory changes, project overrides, project plugin mount/unmount, and route validation.

## Limitations

- Profile plugins themselves remain profile-global; the Plugins tab is read-only at profile scope.
- Only global tool registrations are listed. Agent-local registrations (including a project pack's own tools) cannot be restricted from within their own scope.
- Per-project overrides live in the profile patch, not in the project repository, so they are machine-local.

## License

MIT
