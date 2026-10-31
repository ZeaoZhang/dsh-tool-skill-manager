window.__ModuleLoader__.load({
  id: '@local/tool-skill-manager',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'tool-skill-manager';
    const PROFILE_SCOPE = 'profile';
    const L = {
      zh: {
        title: '工具、技能与插件',
        tools: '工具',
        skills: '技能',
        plugins: '插件',
        scopeLabel: '作用范围',
        profileScope: '配置档默认（所有项目）',
        addProject: '添加项目…',
        addProjectPrompt: '输入项目根目录的绝对路径（通常是包含 .git 的目录）',
        confirmAdd: '添加',
        cancel: '取消',
        removeProject: '移除项目',
        removeProjectConfirm: '移除该项目的全部项目级覆写？（不会删除项目插件文件）',
        confirmRemove: '确认移除',
        search: '搜索名称或说明',
        enabledCount: '已启用 {enabled} / {total}',
        activeAgents: '活动会话：{count}',
        enableAll: '全部启用',
        disableAll: '全部关闭',
        clearOverrides: '清除覆写',
        stateEnabled: '已启用',
        stateDisabled: '已关闭',
        keepOnly: '仅保留此项',
        inherit: '继承配置档',
        overrideEnabled: '强制启用',
        overrideDisabled: '强制关闭',
        profileDefault: '配置档默认：{state}',
        loading: '正在读取…',
        saving: '正在保存…',
        empty: '没有匹配项',
        errorLabel: '操作失败',
        modelPolicy: '技能来源禁止模型调用',
        userPolicy: '技能来源禁止用户调用',
        noTools: '当前没有可管理的全局工具',
        refresh: '刷新',
        bulkFiltered: '{action}（仅作用于当前筛选出的 {count} 项）',
        pluginHelpProfile: '配置档插件在启动时加载、对整个配置档生效，无法按项目卸载。请到「设置 → 插件」管理它们。',
        pluginHelpProject: '项目插件位于 {dir}。放置 *.mjs 文件（default export 一个 Cordis 插件）即可只为本项目的会话注册工具与技能。',
        pluginEmpty: '该项目还没有项目插件。',
        reloadPlugins: '重新加载插件',
        pluginMounted: '已挂载',
        pluginFailed: '挂载失败',
        pluginAvailable: '待挂载',
        pluginDisabled: '已关闭',
      },
      en: {
        title: 'Tools, Skills & Plugins',
        tools: 'Tools',
        skills: 'Skills',
        plugins: 'Plugins',
        scopeLabel: 'Scope',
        profileScope: 'Profile defaults (all projects)',
        addProject: 'Add project…',
        addProjectPrompt: 'Absolute project root path (usually the directory containing .git)',
        confirmAdd: 'Add',
        cancel: 'Cancel',
        removeProject: 'Remove project',
        removeProjectConfirm: 'Remove all project-level overrides? Project plugin files are left untouched.',
        confirmRemove: 'Confirm remove',
        search: 'Search names or descriptions',
        enabledCount: '{enabled} of {total} enabled',
        activeAgents: 'Active sessions: {count}',
        enableAll: 'Enable all',
        disableAll: 'Disable all',
        clearOverrides: 'Clear overrides',
        stateEnabled: 'Enabled',
        stateDisabled: 'Disabled',
        keepOnly: 'Keep only this',
        inherit: 'Inherit profile',
        overrideEnabled: 'Force on',
        overrideDisabled: 'Force off',
        profileDefault: 'Profile default: {state}',
        loading: 'Loading…',
        saving: 'Saving…',
        empty: 'No matching entries',
        errorLabel: 'Action failed',
        modelPolicy: 'Skill source blocks model invocation',
        userPolicy: 'Skill source blocks user invocation',
        noTools: 'No global tools are currently available',
        refresh: 'Refresh',
        bulkFiltered: '{action} (applies only to the {count} filtered rows)',
        pluginHelpProfile: 'Profile plugins load at startup and apply to the whole profile; they cannot be unloaded for a single project. Manage them under Settings → Plugins.',
        pluginHelpProject: 'Project plugins live in {dir}. Drop a *.mjs file there (default-exporting a Cordis plugin) to register tools and skills for this project’s sessions only.',
        pluginEmpty: 'This project has no project plugins yet.',
        reloadPlugins: 'Reload plugins',
        pluginMounted: 'Mounted',
        pluginFailed: 'Mount failed',
        pluginAvailable: 'Available',
        pluginDisabled: 'Disabled',
      },
    };
    const CSS = `
      .tsm { display:flex; flex-direction:column; gap:14px; color:var(--dsw-alias-label-primary); font-size:13px; }
      .tsm__heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .tsm__title { margin:0; font-size:18px; line-height:1.35; font-weight:600; }
      .tsm__meta, .tsm__description, .tsm__policy, .tsm__hint { color:var(--dsw-alias-label-secondary); }
      .tsm__meta { white-space:nowrap; font-size:12px; }
      .tsm__scope { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .tsm__scope label { color:var(--dsw-alias-label-secondary); font-size:12px; }
      .tsm__select { flex:1 1 260px; min-width:0; max-width:520px; height:32px; box-sizing:border-box; padding:0 8px; border:1px solid var(--dsw-alias-border-l1); border-radius:4px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; }
      .tsm__select--override { flex:0 0 128px; max-width:128px; }
      .tsm__select:focus { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .tsm__toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding-bottom:12px; border-bottom:1px solid var(--dsw-alias-border-l1); }
      .tsm__segments { display:flex; gap:3px; padding:3px; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:5px; }
      .tsm__segments button, .tsm__action, .tsm__refresh { min-height:30px; border:1px solid transparent; border-radius:4px; padding:5px 9px; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; }
      .tsm__segments button[aria-pressed="true"] { background:var(--dsw-alias-bg-base); border-color:var(--dsw-alias-border-l1); }
      .tsm__action, .tsm__refresh { border-color:var(--dsw-alias-border-l1); white-space:nowrap; }
      .tsm__action:hover:not(:disabled), .tsm__refresh:hover:not(:disabled), .tsm__segments button:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-1); }
      .tsm__search { flex:1 1 190px; min-width:150px; max-width:360px; height:32px; box-sizing:border-box; padding:0 9px; border:1px solid var(--dsw-alias-border-l1); border-radius:4px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:inherit; }
      .tsm__search:focus { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .tsm__search--path { flex:1 1 300px; max-width:440px; }
      .tsm__count { margin-left:auto; color:var(--dsw-alias-label-secondary); font-size:12px; white-space:nowrap; }
      .tsm__list { min-width:0; }
      .tsm__row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:14px; min-height:56px; padding:10px 2px; border-bottom:1px solid var(--dsw-alias-border-l1); }
      .tsm__main { min-width:0; }
      .tsm__name { margin:0; font-size:13px; line-height:1.4; font-weight:600; overflow-wrap:anywhere; }
      .tsm__description { margin:3px 0 0; line-height:1.45; overflow-wrap:anywhere; }
      .tsm__policy { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; font-size:11px; }
      .tsm__controls { display:flex; align-items:center; gap:10px; }
      .tsm__toggle { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; }
      .tsm__toggle input { width:16px; height:16px; margin:0; accent-color:var(--dsw-alias-brand-primary); }
      .tsm__danger { color:var(--dsw-alias-state-error-primary); }
      .tsm__action:disabled, .tsm__refresh:disabled, .tsm__toggle input:disabled, .tsm__select:disabled { opacity:.55; cursor:default; }
      .tsm__help { margin:0; padding:12px 14px; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; background:var(--dsw-alias-bg-layer-1); line-height:1.55; }
      .tsm__help code { overflow-wrap:anywhere; }
      .tsm__hint { font-size:11px; white-space:nowrap; }
      .tsm__status { min-height:18px; color:var(--dsw-alias-label-secondary); }
      .tsm__error { color:var(--dsw-alias-state-error-primary); }
      .tsm__empty { padding:18px 2px; color:var(--dsw-alias-label-secondary); }
      @media (max-width:680px) {
        .tsm__heading { flex-direction:column; gap:4px; }
        .tsm__meta { white-space:normal; }
        .tsm__count { flex-basis:100%; margin-left:0; }
        .tsm__row { grid-template-columns:minmax(0,1fr); gap:9px; }
        .tsm__controls { justify-content:space-between; }
        .tsm__hint { white-space:normal; }
      }
    `;

    let localeService;
    let translate = (key, params) => {
      const language = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
      let text = L[language][key] || L.en[key] || key;
      if (params) text = String(text).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
      return text;
    };

    function messageOf(error) {
      return String((error && error.message) || error || 'Unknown error');
    }

    async function callHost(method, args) {
      const response = await fetch('/api/tool-skill-manager', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload.value;
    }

    function SettingsPage() {
      const [catalog, setCatalog] = React.useState(null);
      const [scope, setScope] = React.useState(PROFILE_SCOPE);
      const [tab, setTab] = React.useState('tools');
      const [query, setQuery] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState('');
      const [adding, setAdding] = React.useState(false);
      const [draft, setDraft] = React.useState('');
      const [confirmRemove, setConfirmRemove] = React.useState(false);
      const [, setLocaleRevision] = React.useState(0);

      React.useEffect(() => {
        if (!localeService) return undefined;
        return localeService.subscribe(() => setLocaleRevision((revision) => revision + 1));
      }, []);

      function load(target) {
        setLoading(true);
        setError('');
        callHost('getCatalog', { scope: target }).then((value) => {
          setCatalog(value);
        }).catch((failure) => {
          setError(messageOf(failure));
        }).finally(() => {
          setLoading(false);
        });
      }

      React.useEffect(() => {
        load(scope);
      }, [scope]);

      async function update(method, args, nextScope) {
        const target = nextScope === undefined ? scope : nextScope;
        setBusy(true);
        setError('');
        try {
          await callHost(method, args);
          const value = await callHost('getCatalog', { scope: target });
          setCatalog(value);
        } catch (failure) {
          setError(messageOf(failure));
        } finally {
          setBusy(false);
        }
      }

      const projectScope = scope !== PROFILE_SCOPE;
      const projects = catalog ? catalog.projects : [];
      const entries = catalog ? (tab === 'tools' ? catalog.tools : tab === 'skills' ? catalog.skills : []) : [];
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const visible = entries.filter((entry) => {
        if (!normalizedQuery) return true;
        return [entry.name, entry.description, entry.provider, entry.source]
          .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
      });
      const enabledCount = entries.filter((entry) => entry.enabled).length;
      // Bulk actions apply to the rows the user can actually see, so a search
      // narrows the blast radius instead of silently touching the whole catalog.
      const bulkScope = visible;
      const bulkTitle = (key) => (normalizedQuery
        ? translate('bulkFiltered', { action: translate(key), count: bulkScope.length })
        : translate(key));
      const currentProject = projects.find((project) => project.root === scope);
      const submitAdd = () => {
        const root = draft.trim();
        if (!root || busy) return;
        setAdding(false);
        setDraft('');
        void update('addProject', { root }, root).then(() => setScope(root));
      };
      const removeCurrent = () => {
        setConfirmRemove(false);
        void update('removeProject', { root: scope }, PROFILE_SCOPE).then(() => setScope(PROFILE_SCOPE));
      };
      const children = [];

      children.push(h('div', { className: 'tsm__heading', key: 'heading' },
        h('div', null,
          h('h2', { className: 'tsm__title' }, translate('title')),
        ),
        h('div', { className: 'tsm__meta' }, translate('activeAgents', { count: catalog ? catalog.activeAgents : 0 })),
      ));

      children.push(h('div', { className: 'tsm__scope', key: 'scope' },
        h('label', { htmlFor: `${NS}-scope` }, translate('scopeLabel')),
        h('select', {
          id: `${NS}-scope`,
          className: 'tsm__select',
          value: scope,
          disabled: busy,
          onChange: (event) => setScope(event.target.value),
        },
          h('option', { value: PROFILE_SCOPE }, translate('profileScope')),
          projects.map((project) => h('option', { key: project.root, value: project.root },
            `${project.root}${project.agents > 0 ? ` · ${project.agents}` : ''}`)),
        ),
        adding
          ? h(React.Fragment, null,
              h('input', {
                className: 'tsm__search tsm__search--path',
                type: 'text',
                value: draft,
                placeholder: translate('addProjectPrompt'),
                'aria-label': translate('addProjectPrompt'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submitAdd();
                  if (event.key === 'Escape') { setAdding(false); setDraft(''); }
                },
              }),
              h('button', { className: 'tsm__action', type: 'button', disabled: busy || !draft.trim(), onClick: submitAdd }, translate('confirmAdd')),
              h('button', { className: 'tsm__action', type: 'button', onClick: () => { setAdding(false); setDraft(''); } }, translate('cancel')),
            )
          : h('button', {
              className: 'tsm__action',
              type: 'button',
              disabled: busy,
              onClick: () => { setAdding(true); setDraft(''); },
            }, translate('addProject')),
        projectScope && currentProject && currentProject.configured
          ? (confirmRemove
              ? h(React.Fragment, null,
                  h('span', { className: 'tsm__hint' }, translate('removeProjectConfirm')),
                  h('button', { className: 'tsm__action tsm__danger', type: 'button', disabled: busy, onClick: removeCurrent }, translate('confirmRemove')),
                  h('button', { className: 'tsm__action', type: 'button', onClick: () => setConfirmRemove(false) }, translate('cancel')),
                )
              : h('button', {
                  className: 'tsm__action',
                  type: 'button',
                  disabled: busy,
                  onClick: () => setConfirmRemove(true),
                }, translate('removeProject')))
          : null,
      ));

      children.push(h('div', { className: 'tsm__toolbar', key: 'toolbar' },
        h('div', { className: 'tsm__segments', role: 'group', 'aria-label': translate('title') },
          h('button', { type: 'button', 'aria-pressed': tab === 'tools', disabled: busy, onClick: () => setTab('tools') }, translate('tools')),
          h('button', { type: 'button', 'aria-pressed': tab === 'skills', disabled: busy, onClick: () => setTab('skills') }, translate('skills')),
          h('button', { type: 'button', 'aria-pressed': tab === 'plugins', disabled: busy, onClick: () => setTab('plugins') }, translate('plugins')),
        ),
        tab === 'plugins'
          ? null
          : h('input', {
              className: 'tsm__search',
              type: 'search',
              value: query,
              placeholder: translate('search'),
              'aria-label': translate('search'),
              onChange: (event) => setQuery(event.target.value),
            }),
        tab === 'plugins'
          ? h('button', {
              className: 'tsm__refresh',
              type: 'button',
              disabled: busy || loading || !projectScope,
              onClick: () => update('refreshProjectPlugins', { scope }),
            }, translate('reloadPlugins'))
          : h(React.Fragment, null,
              h('button', { className: 'tsm__action', type: 'button', disabled: busy || bulkScope.length === 0, title: bulkTitle('enableAll'), onClick: () => update('setAll', { scope, kind: tab, enabled: true, names: bulkScope.map((entry) => entry.name) }) }, translate('enableAll')),
              h('button', { className: 'tsm__action', type: 'button', disabled: busy || bulkScope.length === 0, title: bulkTitle('disableAll'), onClick: () => update('setAll', { scope, kind: tab, enabled: false, names: bulkScope.map((entry) => entry.name) }) }, translate('disableAll')),
              projectScope
                ? h('button', { className: 'tsm__action', type: 'button', disabled: busy || bulkScope.length === 0, onClick: () => update('clearAll', { scope, kind: tab, names: bulkScope.map((entry) => entry.name) }) }, translate('clearOverrides'))
                : null,
            ),
        h('button', { className: 'tsm__refresh', type: 'button', disabled: busy || loading, onClick: () => load(scope) }, translate('refresh')),
        h('div', { className: 'tsm__count' }, tab === 'plugins'
          ? String(catalog && catalog.plugins ? catalog.plugins.length : 0)
          : catalog ? translate('enabledCount', { enabled: enabledCount, total: entries.length }) : translate('loading')),
      ));

      if (error) children.push(h('div', { className: 'tsm__status tsm__error', role: 'alert', key: 'error' }, `${translate('errorLabel')}: ${error}`));
      else children.push(h('div', { className: 'tsm__status', 'aria-live': 'polite', key: 'status' }, busy ? translate('saving') : loading ? translate('loading') : ''));

      if (tab === 'plugins') {
        if (!projectScope) {
          children.push(h('p', { className: 'tsm__help', key: 'profile-plugins' }, translate('pluginHelpProfile')));
        } else {
          children.push(h('p', { className: 'tsm__help', key: 'project-plugins' },
            translate('pluginHelpProject', { dir: catalog && catalog.pluginDir ? catalog.pluginDir : '' })));
          const plugins = catalog ? catalog.plugins : [];
          if (plugins.length === 0) {
            children.push(h('div', { className: 'tsm__empty', key: 'no-plugins' }, translate('pluginEmpty')));
          } else {
            children.push(h('div', { className: 'tsm__list', key: 'plugin-list' }, plugins.map((plugin) => {
              const status = !plugin.enabled
                ? translate('pluginDisabled')
                : plugin.status === 'mounted'
                  ? translate('pluginMounted')
                  : plugin.status === 'failed'
                    ? translate('pluginFailed')
                    : translate('pluginAvailable');
              return h('div', { className: 'tsm__row', key: plugin.name },
                h('div', { className: 'tsm__main' },
                  h('h3', { className: 'tsm__name' }, plugin.name),
                  h('p', { className: 'tsm__description' }, plugin.path),
                  plugin.error ? h('div', { className: 'tsm__policy tsm__error' }, plugin.error) : null,
                ),
                h('div', { className: 'tsm__controls' },
                  h('span', { className: 'tsm__hint' }, status),
                  h('label', { className: 'tsm__toggle' },
                    h('input', {
                      type: 'checkbox',
                      checked: plugin.enabled,
                      disabled: busy,
                      onChange: (event) => update('setPluginEnabled', { scope, name: plugin.name, enabled: event.target.checked }),
                    }),
                    h('span', null, plugin.enabled ? translate('stateEnabled') : translate('stateDisabled')),
                  ),
                ),
              );
            })));
          }
        }
      } else if (!loading && tab === 'tools' && entries.length === 0) {
        children.push(h('div', { className: 'tsm__empty', key: 'no-tools' }, translate('noTools')));
      } else if (!loading && visible.length === 0) {
        children.push(h('div', { className: 'tsm__empty', key: 'empty' }, translate('empty')));
      } else {
        children.push(h('div', { className: 'tsm__list', key: 'list' }, visible.map((entry) => {
          const policy = [];
          if (tab === 'skills' && !entry.modelPolicy) policy.push(h('span', { key: 'model' }, translate('modelPolicy')));
          if (tab === 'skills' && !entry.userPolicy) policy.push(h('span', { key: 'user' }, translate('userPolicy')));
          const controls = projectScope
            ? [
                h('select', {
                  key: 'override',
                  className: 'tsm__select tsm__select--override',
                  disabled: busy,
                  value: entry.override === null ? 'inherit' : entry.override ? 'enabled' : 'disabled',
                  onChange: (event) => {
                    const value = event.target.value;
                    void update('setOverride', {
                      scope,
                      kind: tab,
                      name: entry.name,
                      value: value === 'inherit' ? null : value === 'enabled',
                    });
                  },
                },
                  h('option', { value: 'inherit' }, translate('inherit')),
                  h('option', { value: 'enabled' }, translate('overrideEnabled')),
                  h('option', { value: 'disabled' }, translate('overrideDisabled')),
                ),
                h('span', { key: 'default', className: 'tsm__hint' },
                  translate('profileDefault', { state: entry.baseEnabled ? translate('stateEnabled') : translate('stateDisabled') })),
              ]
            : [
                h('label', { key: 'toggle', className: 'tsm__toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: entry.enabled,
                    disabled: busy,
                    onChange: (event) => update('setEnabled', { scope: PROFILE_SCOPE, kind: tab, name: entry.name, enabled: event.target.checked }),
                  }),
                  h('span', null, entry.enabled ? translate('stateEnabled') : translate('stateDisabled')),
                ),
              ];
          return h('div', { className: 'tsm__row', key: entry.name },
            h('div', { className: 'tsm__main' },
              h('h3', { className: 'tsm__name' }, entry.name),
              entry.description ? h('p', { className: 'tsm__description' }, entry.description) : null,
              entry.provider ? h('div', { className: 'tsm__policy' }, h('span', null, entry.provider)) : null,
              policy.length ? h('div', { className: 'tsm__policy' }, policy) : null,
            ),
            h('div', { className: 'tsm__controls' },
              ...controls,
              tab === 'skills' && projectScope
                ? h('button', {
                    className: 'tsm__action',
                    type: 'button',
                    disabled: busy,
                    title: translate('keepOnly'),
                    onClick: () => update('setOnly', { scope, kind: 'skills', name: entry.name }),
                  }, translate('keepOnly'))
                : null,
            ),
          );
        })));
      }

      return h(React.Fragment, null,
        h('style', { 'data-style-owner': NS }, CSS),
        h('main', { className: 'tsm' }, children),
      );
    }

    function apply(ctx) {
      const slots = ctx.get('slots');
      localeService = ctx.get('locale');
      if (localeService && typeof localeService.register === 'function') {
        try {
          const disposeLocale = localeService.register(NS, { zh: L.zh, en: L.en });
          const bound = localeService.bind(NS);
          translate = (key, params) => {
            const result = bound(key, params);
            if (result !== key) return result;
            const language = (localeService.getLocale().active || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
            let text = L[language][key] || L.en[key] || key;
            if (params) text = String(text).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
            return text;
          };
          ctx.effect(() => disposeLocale, `${NS}.locale`);
        } catch (error) {
          console.error(`${NS}: locale registration failed`, error);
        }
      }
      slots.inject('settings.plugins.tab', () => slots.register({
        name: 'settings.plugins.tab',
        id: NS,
        order: 20,
        label: () => translate('title'),
      }, () => h(SettingsPage, null)));
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
