// dsh-model-in-use — client half.
//
// Inside the composer's model menu this does three things:
//
//   1. every model another *running* conversation is using gets a cyan running
//      dot in the check cell, with the explanation on hover (non-exclusive: the
//      row stays selectable);
//   2. every provider group gets a collapse toggle, one icon at the top of the
//      pane folds or unfolds them all, and which groups the user collapsed is
//      remembered in localStorage;
//   3. the reasoning effort a user picks for a model is remembered, and picking
//      that model again restores it instead of silently falling back to the
//      model's own default.
//
// Why DOM decoration instead of a slot: `conversation.input.model` is a `single`
// slot, and its live occupant is dsh-codex-subscription's CodexModelSelect
// (priority -10, which shadows the shipped ModelSelect). Neither exposes a
// per-row extension point, so this plugin attaches data attributes and injects
// one stylesheet. Both markers are CSS (`::after`), which React never
// reconciles — the rows and headings themselves are left untouched.
//
// The row DOM carries no provider/model ids, so a row is resolved through the
// shared catalog by the two strings the component renders: the group title (the
// raw `group.name`, not a localized label) and the model name.
//
// The tooltip lives on the row's NAME SPAN, never on the row button itself.
// That is deliberate: freecodego's menu decorator claims a section only when it
// finds `button[role="menuitemradio"][title]`, and it would then fight this
// plugin for the same heading (two chevrons, two collapse states). Keeping
// `title` off the button leaves that gate shut and this decorator alone.
//
// Scope note: this decorates the composer dropdown only, and it only knows the
// CodexModelSelect DOM. If dsh-codex-subscription is disabled and the shipped
// ModelSelect takes the slot, the menu is simply left undecorated.

window.__ModuleLoader__.load({
  id: 'dsh-model-in-use',
  factory: require => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const module = { exports: {} }

    const NS = 'dsh-model-in-use'
    const zh = {
      inUse: '其他会话正在使用中',
      expandGroup: '展开此提供商的模型',
      collapseGroup: '收起此提供商的模型',
      expandAll: '全部展开',
      collapseAll: '全部折叠',
      sortByName: '名称排序',
      sortByCatalog: '默认排序',
      tokensPerSecond: '{tps} tok/s',
      speedHint: '这一轮对话的输出速度'
    }
    const en = {
      inUse: 'In use by another conversation',
      expandGroup: 'Expand provider models',
      collapseGroup: 'Collapse provider models',
      expandAll: 'Expand all groups',
      collapseAll: 'Collapse all groups',
      sortByName: 'Sort by name',
      sortByCatalog: 'Catalog order',
      tokensPerSecond: '{tps} tok/s',
      speedHint: 'Output speed of this turn'
    }

    // Structure only — stable class names, no build-specific CSS-module hashes.
    // `codexModelSelectGroups` exists only in the model pane, which is what
    // keeps the effort/speed/verbosity rows (same `option()` factory, same
    // `role="menuitemradio"`) out of scope.
    const MENU_SELECTOR = 'div.codexModelSelectMenu'
    const GROUPS_SELECTOR = 'div.codexModelSelectGroups'
    const SECTION_SELECTOR = 'section.codexModelSelectGroup'
    const TITLE_SELECTOR = 'div.codexModelSelectGroupTitle'
    const TOGGLE_SELECTOR = 'div.codexModelSelectGroupTitle[data-dsh-group-toggle]'
    const NAME_SELECTOR = 'span.codexModelSelectOptionName'
    const ROW_SELECTOR = 'button.codexModelSelectOption'
    const TRIGGER_SELECTOR = 'button.codexModelSelectTrigger'
    const ALL_SELECTOR = 'div[data-dsh-collapse-all]'
    const LABEL_SELECTOR = 'span[data-dsh-collapse-label]'
    const SORT_SELECTOR = 'span[data-dsh-sort]'

    const STYLE_ID = 'dsh-model-in-use-style'
    const COLLAPSE_KEY = 'dsh-model-in-use:collapsed-groups'
    const EFFORT_KEY = 'dsh-model-in-use:model-efforts'
    const SORT_KEY = 'dsh-model-in-use:sort-by-name'

    // The row is `display:flex; gap:8px; padding:6px 8px` with an 18px check cell
    // as its last child, so the check cell is centred 8 + 18/2 = 17px from the
    // row's right edge. A 6px dot at `right:14px` has its centre exactly there.
    // A row can legitimately carry the checkmark AND this dot, and stacking them
    // is unreadable — so a checked row's dot steps out into the 8px gap in front
    // of the cell (`right:27px`, centring it 4px into that gap) and the two sit
    // side by side. `pointer-events:none` keeps the menu's outside-mousedown
    // handler and the row's own click untouched.
    //
    // The group chevron and the group's own in-use dot are the heading's `::after`
    // and `::before`, so neither adds a node React could reconcile away — only
    // the section's state attributes. The heading is a flex row so those two can
    // sit at opposite ends; the chevron is pushed right by `margin-left:auto`
    // rather than `justify-content:space-between`, because the heading's text is
    // a bare text node (an anonymous flex item) and space-between would shove it
    // into the middle once the dot makes a third item.
    //
    // ponytail: both dot offsets are measured against the shipped CSS module; if
    // the row's padding, gap or check cell ever change size, re-measure (or
    // switch to injecting a flex item, which needs the component to expose a
    // slot).
    const DOT_COLOR = '#3cc400'

    const CSS = [
      // The shipped gap is `section + section { margin-top: 4px }`, i.e. it keys
      // off DOM adjacency. freecodego reorders these sections with the CSS `order`
      // property and never moves the nodes, so the margin lands on whichever pair
      // happens to be adjacent in the DOM rather than the pair the user sees —
      // which is why two groups end up flush against each other. A flex column
      // with `gap` spaces the items in their *visual* order, so it is correct no
      // matter what `order` values are in play. The old margin is neutralized to
      // avoid adding it twice.
      // `max-height:none` + `flex:1 1 auto` is what keeps the bottom of the list
      // reachable. The shipped submenu is `max-height:360px; overflow:hidden`,
      // while the scroller inside it is a fixed `max-height:352px` block — so the
      // fixed row we add above it pushes the last rows past the submenu's edge,
      // where `overflow:hidden` clips them for good. Scrolling cannot recover
      // them: the scroller itself is taller than the box that shows it. Making
      // the submenu a flex column and letting the scroller take the leftover
      // height moves the overflow back into the scroller, which does scroll.
      'div.codexModelSelectGroups{display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-height:0;max-height:none}',
      'div.codexModelSelectGroups>section.codexModelSelectGroup{flex:0 0 auto}',
      'section.codexModelSelectGroup+section.codexModelSelectGroup{margin-top:0}',
      // The submenu is painted with `--dsw-alias-bg-layer-2` too, so a glass skin
      // makes it translucent and the rows behind it show through. Pin alpha to 1
      // exactly like the sticky heading below; the same `/ 1` argument applies.
      'div.codexModelSelectSubmenu{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#2c2c2e);background:rgb(from var(--dsw-alias-bg-layer-2,#2c2c2e) r g b / 1)}',
      // One row above the scroller folds or unfolds every group at once. It sits
      // beside the scrolling list rather than inside it, so it never scrolls away
      // and needs no background to hide rows passing under it. Its box model is
      // copied from a provider row — same padding, font and line-height, chevron
      // as a `margin-left:auto` flex item — so its chevron lands on the same x
      // and y as the provider chevrons right below it. Unlike v0.1.2 it shows its
      // wording instead of leaving it in a tooltip alone.
      'div[data-dsh-collapse-all]{',
      'display:flex;align-items:center;gap:8px;',
      'padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;',
      'cursor:pointer;user-select:none;',
      'color:var(--dsw-alias-label-tertiary)',
      '}',
      'div[data-dsh-collapse-all]:hover{color:var(--dsw-alias-label-secondary)}',
      // A single chevron pointing at the movement a click will make: up to fold
      // everything away, down to unfold it. v0.1.2 stacked two of them. It is the
      // row's last flex item, so the sort switch's `margin-left:auto` pushes the
      // pair to the right edge and the chevron lands exactly where the provider
      // headings' chevrons do.
      'div[data-dsh-collapse-all]::after{',
      'content:"";flex:0 0 auto;width:5px;height:5px;',
      'border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;',
      'transform:rotate(45deg);transition:transform 120ms',
      '}',
      'div[data-dsh-collapse-all][data-dsh-all="collapsed"]::after{transform:rotate(-45deg)}',
      // The sort switch rides in the same row. `margin-left:auto` is the whole
      // layout: it pushes itself and the chevron after it to the right edge.
      'span[data-dsh-sort]{flex:0 0 auto;margin-left:auto;text-decoration:underline;text-underline-offset:2px}',
      'button[data-dsh-model-in-use]{position:relative}',
      'button[data-dsh-model-in-use]::after{',
      'content:"";position:absolute;right:14px;top:50%;width:6px;height:6px;',
      'margin-top:-3px;border-radius:50%;pointer-events:none;',
      `background:${DOT_COLOR}`,
      '}',
      'button[data-dsh-model-in-use][aria-checked="true"]::after{right:27px}',
      // The heading is `position:sticky` on top of the rows that scroll under it,
      // and the base rule paints it with `--dsw-alias-bg-layer-2`. A glass skin
      // makes that token translucent, so the row text shows straight through the
      // heading and the two read as one smeared line. Re-state the same colour at
      // full opacity: `rgb(from … r g b / 1)` keeps the skin's hue but pins alpha
      // to 1, so the heading stays opaque under any skin. The first declaration is
      // the untouched fallback for an engine without relative colour syntax.
      //
      // The `/ 1` is load-bearing. Omitting alpha does NOT mean 1 — relative
      // colour syntax inherits the ORIGIN colour's alpha, so `rgb(from … r g b)`
      // reproduces the very translucency this rule exists to remove, and the text
      // still bleeds through. (Spec/MDN: omitted alpha defaults to the origin's.)
      'div.codexModelSelectGroupTitle[data-dsh-group-toggle]{',
      'display:flex;align-items:center;cursor:pointer;user-select:none;',
      'background:var(--dsw-alias-bg-layer-2,#2c2c2e);',
      'background:rgb(from var(--dsw-alias-bg-layer-2,#2c2c2e) r g b / 1)',
      '}',
      'div.codexModelSelectGroupTitle[data-dsh-group-toggle]:hover{',
      'color:var(--dsw-alias-label-secondary)',
      '}',
      'div.codexModelSelectGroupTitle[data-dsh-group-toggle]::after{',
      'content:"";flex:0 0 auto;margin-left:auto;width:5px;height:5px;',
      'border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;',
      'transform:rotate(45deg);transition:transform 120ms',
      '}',
      'section[data-dsh-group-collapsed="true"]>div.codexModelSelectGroupTitle[data-dsh-group-toggle]::after{',
      'transform:rotate(-45deg)',
      '}',
      // A group whose own models are in use gets the dot in front of its heading.
      // Deliberately no `color` here: the heading keeps its tertiary label colour,
      // only the dot is coloured.
      'section[data-dsh-group-in-use="true"]>div.codexModelSelectGroupTitle[data-dsh-group-toggle]::before{',
      'content:"";flex:0 0 auto;width:6px;height:6px;margin-right:6px;border-radius:50%;',
      `background:${DOT_COLOR}`,
      '}',
      'section[data-dsh-group-collapsed="true"]>button.codexModelSelectOption{',
      'display:none!important',
      '}',
      'body>div:has([data-dsh-hover-model]){width:max-content;min-width:244px;max-width:calc(100vw - 16px)}',
      'div:has(>[data-dsh-hover-model]){flex-wrap:nowrap;white-space:nowrap}',
      'div:has(>[data-dsh-hover-model])>*{flex-shrink:0}',
      '.dsh-model-in-use-hover-model{display:inline-flex;align-items:center;gap:6px;flex:none;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-model-in-use-hover-model::before{content:"";width:6px;height:6px;border-radius:50%;background:#3cc400;flex:none}',
      // The rate joins the turn's own action line, so it borrows that line's
      // metrics: the same 28px cell and secondary font the usage chip beside it
      // uses. `tabular-nums` keeps the digits from shifting as the number
      // changes, and `flex:none` stops a long reply from squeezing it.
      '[data-dsh-turn-speed]{box-sizing:border-box;height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsw-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;flex:none;padding:6px 8px;display:inline-flex}'
    ].join('')

    module.exports.inject = ['sessions', 'locale', 'slots']

    module.exports.apply = ctx => {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-in-use: dictionaries')

      // `modelDirectories` is provided by the model-selection plugin. Waiting on
      // it (instead of declaring it in `inject`) keeps this plugin activating
      // even if that package is ever absent — the decorator simply never starts.
      ctx.inject(['modelDirectories'], scope => {
        // Bound once; translation happens per call against the live dictionary,
        // so ordering against the model-selection package does not matter.
        const t = ctx.locale.bind(NS)

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        // The client half is evaluated from a script the Web boot injects, which
        // can run before <body> exists. <head> is always parsed by then, and the
        // observer below hangs off <body> once it appears for the same reason.
        ;(document.head ?? document.documentElement).append(style)

        const observers = new Map()
        let scheduled = false

        /** The conversation whose menu is open, read off the trigger it points at. */
        const selfIdOf = groupsEl => {
          const menuId = groupsEl.closest(MENU_SELECTOR)?.id
          if (menuId === undefined || menuId === '') return undefined
          for (const trigger of document.querySelectorAll(TRIGGER_SELECTOR)) {
            if (trigger.getAttribute('aria-controls') !== menuId) continue
            return trigger.closest('[data-conversation-session]')?.dataset.conversationSession
          }
          return undefined
        }

        /**
         * The selection a conversation row carries, or `undefined` when it has
         * none. `next` and `lastUsed` are `null` in that case — not merely
         * absent — and `??` only skips the property it reads, so a null PAIR
         * survives it and every `=== undefined` guard downstream misses. That
         * is how a `null.reasoningEffort` throw used to abort the whole wiring.
         */
        const selectionOf = row =>
          row?.projectionValues?.modelSelection?.next
          ?? row?.projectionValues?.modelSelection?.lastUsed
          ?? undefined

        /** Every model another running main conversation is holding right now. */
        const inUseKeys = selfId => {
          const keys = new Set()
          const list = ctx.sessions.list.getSnapshot()
          const fallback = scope.modelDirectories.catalog.store.getSnapshot().value?.default
          for (const id of list.ids) {
            const row = list.byId[id]
            if (row === undefined || row.id === selfId) continue
            // Subagent conversations are not conversations the user is running.
            if (row.origin === 'subagent' || row.parentId !== undefined) continue
            if (!row.running) continue
            const selection = selectionOf(row) ?? fallback
            if (selection === undefined || selection === null) continue
            keys.add(`${selection.provider}\u0000${selection.model}`)
          }
          return keys
        }

        /** (group name, model name) -> (provider, model id), from the shared catalog. */
        const keyByLabel = () => {
          const groups = scope.modelDirectories.catalog.store.getSnapshot().value?.groups ?? []
          const byLabel = new Map()
          for (const group of groups) {
            for (const model of group.models ?? []) {
              byLabel.set(`${group.name}\u0000${model.name}`, `${group.id}\u0000${model.id}`)
            }
          }
          return byLabel
        }

        // ------------------------------------------------------------------
        // The in-use dot
        // ------------------------------------------------------------------

        const unmark = button => {
          button.removeAttribute('data-dsh-model-in-use')
          // CodexModelSelect never sets a title on the name span, so clearing is
          // the whole restore — no original to remember.
          button.querySelector(NAME_SELECTOR)?.removeAttribute('title')
        }

        const mark = (button, name) => {
          button.setAttribute('data-dsh-model-in-use', '')
          const label = button.querySelector(NAME_SELECTOR)
          if (label !== null) label.title = `${name} · ${t('inUse')}`
        }

        // ------------------------------------------------------------------
        // The collapsible provider groups
        // ------------------------------------------------------------------

        // A group's identity for the remembered state is its provider id, read
        // off `aria-labelledby` (the component stamps `${reactId}-${group.id}`
        // there and `${reactId}-menu` on the menu, so the prefix is knowable
        // without guessing where the provider id's own dashes are). Reading it
        // from the attribute rather than the heading's text keeps the memory
        // stable across a language switch.
        const groupKeyOf = (section, reactId) => {
          const labelled = section.getAttribute('aria-labelledby') ?? ''
          if (reactId === '' || !labelled.startsWith(`${reactId}-`)) return labelled
          return labelled.slice(reactId.length + 1)
        }

        const readCollapsed = () => {
          try {
            const parsed = JSON.parse(globalThis.localStorage?.getItem(COLLAPSE_KEY) ?? 'null')
            return parsed !== null && typeof parsed === 'object' ? parsed : {}
          } catch {
            // A blocked or full storage must never stop the menu working.
            return {}
          }
        }

        const writeCollapsed = value => {
          try {
            globalThis.localStorage?.setItem(COLLAPSE_KEY, JSON.stringify(value))
          } catch {
            // Best effort: the toggle still applies, it just is not remembered.
          }
        }

        const collapsed = readCollapsed()

        const readSort = () => {
          try {
            return globalThis.localStorage?.getItem(SORT_KEY) === 'name'
          } catch {
            return false
          }
        }

        const writeSort = value => {
          try {
            globalThis.localStorage?.setItem(SORT_KEY, value ? 'name' : 'catalog')
          } catch {
            // Best effort: the order still applies, it just is not remembered.
          }
        }

        // `order` on the section, never a moved node: React re-renders the list
        // from its own model and would put the nodes straight back. Only this one
        // declaration is touched, so an inline style from elsewhere survives.
        let sortByName = readSort()
        const setOrder = (section, order) => {
          const current = section.getAttribute('style') ?? ''
          const stripped = current.replace(/(?:^|;)\s*order:[^;]*/g, '').replace(/^;/, '')
          const next = order === '' ? stripped : `${stripped}${stripped === '' ? '' : ';'}order:${order}`
          if (next === '') section.removeAttribute('style')
          else section.setAttribute('style', next)
        }

        const applyCollapsed = (section, heading, collapsedNow) => {
          if (section.getAttribute('data-dsh-group-collapsed') !== String(collapsedNow)) {
            section.setAttribute('data-dsh-group-collapsed', String(collapsedNow))
          }
          const hint = t(collapsedNow ? 'expandGroup' : 'collapseGroup')
          if (heading.getAttribute('title') !== hint) heading.setAttribute('title', hint)
        }

        const stampGroup = (section, reactId) => {
          const heading = section.querySelector(TITLE_SELECTOR)
          if (heading === null) return
          const key = groupKeyOf(section, reactId)
          if (key === '') return
          if (section.getAttribute('data-dsh-group-key') !== key) {
            section.setAttribute('data-dsh-group-key', key)
          }
          if (!heading.hasAttribute('data-dsh-group-toggle')) {
            heading.setAttribute('data-dsh-group-toggle', '')
            heading.setAttribute('role', 'button')
            heading.setAttribute('tabindex', '0')
          }
          applyCollapsed(section, heading, collapsed[key] === true)
        }

        /**
         * The row above the scroller: it folds or unfolds every group at once and
         * carries the sort switch. It goes beside the scrolling list, not inside
         * it, so it stays put while the groups scroll. `syncGroups` re-asserts it
         * on every scan, so a re-render that drops it brings it straight back.
         */
        const syncToggleAll = groupsEl => {
          let all = groupsEl.parentNode?.querySelector(ALL_SELECTOR) ?? null
          if (all === null) {
            all = document.createElement('div')
            all.setAttribute('data-dsh-collapse-all', '')
            const host = groupsEl.parentNode
            if (host === null || host === undefined) groupsEl.insertBefore(all, groupsEl.firstElementChild)
            else host.insertBefore(all, groupsEl)
          }
          // React never owns this node, so its two hit areas are created here and
          // kept if a re-render ever drops them. The row itself is a plain
          // container: the label and the sort switch are the two buttons, since a
          // button inside a button is not a thing screen readers can describe.
          let label = all.querySelector(LABEL_SELECTOR)
          if (label === null) {
            label = document.createElement('span')
            label.setAttribute('data-dsh-collapse-label', '')
            label.setAttribute('role', 'button')
            label.setAttribute('tabindex', '0')
            all.append(label)
          }
          let sort = all.querySelector(SORT_SELECTOR)
          if (sort === null) {
            sort = document.createElement('span')
            sort.setAttribute('data-dsh-sort', '')
            sort.setAttribute('role', 'button')
            sort.setAttribute('tabindex', '0')
            all.append(sort)
          }
          // Every group already folded means the next click unfolds; anything
          // else — including a pane whose groups have not rendered yet — folds.
          const anyExpanded = [...groupsEl.querySelectorAll(SECTION_SELECTOR)].some(
            section => section.getAttribute('data-dsh-group-collapsed') !== 'true'
          )
          const state = anyExpanded ? 'expanded' : 'collapsed'
          if (all.getAttribute('data-dsh-all') !== state) all.setAttribute('data-dsh-all', state)
          // Both labels name the action a click makes, not the current state.
          const hint = t(anyExpanded ? 'collapseAll' : 'expandAll')
          if (all.getAttribute('title') !== hint) all.setAttribute('title', hint)
          if (all.getAttribute('aria-label') !== hint) all.setAttribute('aria-label', hint)
          if (label.textContent !== hint) label.textContent = hint
          const sortHint = t(sortByName ? 'sortByCatalog' : 'sortByName')
          if (sort.getAttribute('title') !== sortHint) sort.setAttribute('title', sortHint)
          if (sort.textContent !== sortHint) sort.textContent = sortHint
        }

        /**
         * Re-order the groups without moving a single node: React owns the DOM
         * order, so the CSS `order` property does the work. `catalog` order means
         * no order at all — every section gets its declaration cleared.
         */
        const syncSort = groupsEl => {
          const sections = [...groupsEl.querySelectorAll(SECTION_SELECTOR)]
          if (!sortByName) {
            for (const section of sections) setOrder(section, '')
            return
          }
          const ranked = sections
            .map(section => ({
              section,
              name: (section.querySelector(TITLE_SELECTOR)?.textContent ?? '').trim()
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
          ranked.forEach((entry, index) => setOrder(entry.section, String(index)))
        }

        /** Toggle one group, or every group, or the sort order. */
        const onToggle = event => {
          const target = event.target
          if (target === null || target === undefined || typeof target.closest !== 'function') return
          if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
          const sort = target.closest(SORT_SELECTOR)
          if (sort !== null) {
            const host = sort.closest(ALL_SELECTOR)
            const groupsEl = host?.parentNode?.querySelector(GROUPS_SELECTOR) ?? null
            if (groupsEl === null) return
            event.preventDefault()
            event.stopPropagation()
            sortByName = !sortByName
            writeSort(sortByName)
            syncSort(groupsEl)
            syncToggleAll(groupsEl)
            return
          }
          const all = target.closest(ALL_SELECTOR)
          if (all !== null) {
            // The icon is a sibling of the scrolling list, not a descendant, so
            // the list is found through the shared parent.
            const groupsEl = all.parentNode?.querySelector(GROUPS_SELECTOR) ?? null
            if (groupsEl === null) return
            // Same reason as a heading: the menu routes clicks through this
            // subtree, and this must never read as a model being picked.
            event.preventDefault()
            event.stopPropagation()
            const sections = [...groupsEl.querySelectorAll(SECTION_SELECTOR)]
            const fold = sections.some(
              section => section.getAttribute('data-dsh-group-collapsed') !== 'true'
            )
            for (const section of sections) {
              const sectionHeading = section.querySelector(TITLE_SELECTOR)
              const key = section.getAttribute('data-dsh-group-key')
              if (sectionHeading === null || key === null || key === '') continue
              collapsed[key] = fold
              applyCollapsed(section, sectionHeading, fold)
            }
            writeCollapsed(collapsed)
            syncToggleAll(groupsEl)
            return
          }
          const heading = target.closest(TOGGLE_SELECTOR)
          if (heading === null) return
          const section = heading.closest(SECTION_SELECTOR)
          if (section === null) return
          // The heading is a plain div, so nothing else wants this event — but
          // the menu routes its own clicks through the same subtree, so it is
          // stopped before anything above can read it as a selection.
          event.preventDefault()
          event.stopPropagation()
          const key = section.getAttribute('data-dsh-group-key')
          if (key === null || key === '') return
          const next = section.getAttribute('data-dsh-group-collapsed') !== 'true'
          collapsed[key] = next
          writeCollapsed(collapsed)
          applyCollapsed(section, heading, next)
          // Folding the last open group turns the all-icon into "unfold", and
          // unfolding one turns it back.
          const groupsEl = section.closest(GROUPS_SELECTOR)
          if (groupsEl !== null) syncToggleAll(groupsEl)
        }

        document.addEventListener('click', onToggle, true)
        document.addEventListener('keydown', onToggle, true)

        // ------------------------------------------------------------------
        // Per-model reasoning-effort memory
        // ------------------------------------------------------------------

        // Most paths that pick a model or an effort funnel through
        // `directory.select(selection)` on the model-selection plugin's
        // per-session directory. The one exception is Codex's close-only click
        // on an effort that is already effective; `chooseEffort()` intentionally
        // omits `select()` there, so the small DOM listener below records that
        // explicit intent. Service-level interception remains the authority for
        // actual selections and commands.
        //
        // Model rows may omit their effort. A remembered value
        // must override the catalog default even when a fresh session already has this
        // model as its current selection. Any explicit same-model choice that changes the effective level
        // is an effort edit to record, including the official default; switching models also checks memory.
        //
        // The binding is per MODEL, not per provider: one model is commonly
        // reachable under several provider ids (`workbuddyai` and
        // `workbuddyai-cn` both serve `deepseek-v4.1-flash`), and a
        // provider-qualified key silently misses its own entry when that id
        // changes. Choosing "provider default" does NOT forget the binding — it
        // applies the default to this conversation only, so the model keeps its
        // level the next time it is picked.
        const readEfforts = () => {
          try {
            const parsed = JSON.parse(globalThis.localStorage?.getItem(EFFORT_KEY) ?? 'null')
            return parsed !== null && typeof parsed === 'object' ? parsed : {}
          } catch {
            // A blocked or full storage must never block a selection.
            return {}
          }
        }

        /** The live copy of the memory. It is a *fallback*, not the authority:
         * the storage is read on every lookup so an entry written by another
         * window (or a test) is honoured, and this copy is what serves the
         * lookup while the storage is unreadable or refuses the write. */
        const efforts = readEfforts()
        /** True while the storage holds an older copy than this page does. */
        let storageStale = false

        const writeEfforts = () => {
          try {
            globalThis.localStorage?.setItem(EFFORT_KEY, JSON.stringify(efforts))
            storageStale = false
          } catch {
            // The selection proceeds, it just is not remembered — yet. The
            // in-memory copy still serves `rememberedEffort`, so the binding
            // survives within this page; only a restart would lose it. The flag
            // is what makes a later selection retry the write even when the
            // value it would store has not changed since.
            storageStale = true
          }
        }
        const hookedPrototypes = new Set()
        // A directory can carry its own `select` (freecodego's echo wrapper
        // installs one). An own property shadows the prototype patch, and such a
        // wrapper captured whatever `select` existed *before* this plugin
        // arrived — so the remembered level must be substituted in front of it
        // too, or the first Host call goes out without a level and the
        // correction has to chase it as a second selection.
        const hookedInstances = new Map()
        const hookedDirectories = new Map()
        const reconcilingDirectories = new WeakSet()
        // One reconcile attempt per (directory, target level). A rejected select
        // updates the store, which notifies the subscription and would re-enter
        // here — retrying the same value forever against a host that refuses it.
        // Recording the attempt breaks that loop; a different model or level is a
        // different key and is still allowed through.
        const attemptedReconciles = new WeakMap()
        const learnedSessions = new Set()
        const menuSessions = new Map()
        let disposed = false

        /** The memory key for one model. Provider-independent on purpose — see above. */
        const effortKey = model => model

        /** The stored level for one model, or undefined.
         * Reads the storage first so an entry written by another window is
         * seen too, and falls back to the in-memory copy when the storage is
         * unreadable (then the writes above are what kept it accurate). */
        const rememberedEffort = model => {
          const key = effortKey(model)
          const inMemory = efforts[key]
          try {
            const parsed = JSON.parse(globalThis.localStorage?.getItem(EFFORT_KEY) ?? 'null')
            if (parsed !== null && typeof parsed === 'object') {
              const value = parsed[key]
              if (typeof value === 'string') return value
              // An empty object is a storage that has not been written yet, not
              // an authoritative "nothing is remembered": the write above can
              // fail (evicted, quota, denied) and this read would then erase a
              // level this session already learned.
              if (Object.keys(parsed).length > 0) return undefined
            }
          } catch { /* unreadable */ }
          return typeof inMemory === 'string' ? inMemory : undefined
        }

        const supported = (catalog, selection, effort) =>
          catalog?.reasoningFor?.(selection)?.efforts?.some(level => level.id === effort) === true

        // `chooseEffort()` closes without calling directory.select() when the
        // clicked level is already effective. Capture that explicit click so the
        // model can still be bound to its official default.
        const rememberEffortClick = (directory, label) => {
          const current = directory?.store?.getSnapshot?.().current
          const reasoning = current === undefined || current === null
            ? undefined
            : directory.catalog?.reasoningFor?.(current)
          if (reasoning === undefined) return
          const level = reasoning.efforts?.find(item => (item.name ?? item.label ?? item.id) === label)
          if (current === undefined || current === null) return
          const key = effortKey(current.model)
          if (level === undefined) {
            // The unmatched effort option is the provider-default row: this
            // conversation follows the provider, and the binding is left alone.
            return
          }
          if (efforts[key] !== level.id) {
            efforts[key] = level.id
            writeEfforts()
          }
        }

        // The label renders `current.reasoningEffort`, but `select()` publishes
        // only `pending` until the Host projection settles — so a directory whose
        // durable selection carries no level would paint the provider default and
        // jump a moment later. Substitute the remembered level into `current` as
        // soon as a projection arrives, so the very first paint is already right.
        //
        // `projectedSelections` keeps the Host's own answer, which
        // `reconcileDirectory` must read: the substitution makes `current` look
        // settled, and without the raw copy the correction would look like it had
        // already been accepted and would never be sent.
        const projectedSelections = new WeakMap()
        // `store.set` notifies synchronously, so the subscription re-enters here
        // with the value just written. That echo must not overwrite the Host's
        // raw answer recorded above, or the correction below would read its own
        // optimistic value, decide it was already accepted, and never be sent.
        const substitutingDirectories = new WeakSet()
        const substituteEffort = directory => {
          if (substitutingDirectories.has(directory)) return
          // A write-through is in flight: `current` already carries the optimistic
          // value and `projectedSelections` holds the Host's raw answer, so this
          // notification adds nothing and must not overwrite the raw copy.
          if (reconcilingDirectories.has(directory)) return
          const snapshot = directory.store?.getSnapshot?.()
          const current = snapshot?.current
          if (current === undefined || current === null) return
          projectedSelections.set(directory, current)
          // A failed select leaves `current` as the last optimistic value; keeping
          // the substitution up would show a level the Host refused.
          if (snapshot.status === 'error') return
          const remembered = rememberedEffort(current.model)
          if (typeof remembered !== 'string' || current.reasoningEffort === remembered) return
          if (!supported(directory.catalog, current, remembered)) return
          // A level the Host already refused is not asserted a second time. While
          // the write-through is in flight the substitution stays up, so the label
          // cannot flicker back to the default during the round trip.
          const attemptKey = `${current.model}\u0000${remembered}`
          if (attemptedReconciles.get(directory) === attemptKey && !reconcilingDirectories.has(directory)) return
          if (typeof directory.store.set !== 'function') return
          substitutingDirectories.add(directory)
          try {
            directory.store.set({ ...snapshot, current: { ...current, reasoningEffort: remembered } })
          } finally {
            substitutingDirectories.delete(directory)
          }
        }

        // A blank composer can already own a ModelDirectory before this plugin
        // applies, and Codex deliberately turns a click on its already-current
        // model into close-only (no select call). Make model↔effort binding an
        // invariant of each live directory instead of depending on that click:
        // whenever its current selection becomes ready, reconcile an official
        // default to the remembered supported level through the original method.
        const reconcileDirectory = directory => {
          if (disposed || reconcilingDirectories.has(directory)) return
          try {
            const current = projectedSelections.get(directory) ?? directory.store.getSnapshot().current
            if (current === undefined || current === null) return
            const remembered = rememberedEffort(current.model)
            if (typeof remembered !== 'string' || !supported(directory.catalog, current, remembered)) return
            const reasoning = directory.catalog?.reasoningFor?.(current)
            const currentEffort = current.reasoningEffort ?? reasoning?.defaultEffort
            if (currentEffort === remembered) return
            // Already tried this exact correction and the host did not take it:
            // leave it alone rather than re-issuing the same rejected select.
            const attemptKey = `${current.model}\u0000${remembered}`
            if (attemptedReconciles.get(directory) === attemptKey) return
            // The prototype hook is the only reliable way to reach the original
            // method: the plugin shadows `directoryFor` on the service origin,
            // so this.directoryFor may be its own wrapper.
            const select = Object.getPrototypeOf(directory)?.__dshOriginalSelect
            if (typeof select !== 'function') return
            attemptedReconciles.set(directory, attemptKey)
            reconcilingDirectories.add(directory)
            Promise.resolve(select.call(directory, { ...current, reasoningEffort: remembered }))
              .catch(() => {})
              .finally(() => reconcilingDirectories.delete(directory))
          } catch {
            // Loading/removed directories simply get another chance on update.
          }
        }

        // The single place a payload is rewritten, shared by the prototype patch
        // and by any instance-own `select`. Keeping it in one function is what
        // makes the first Host call carry the remembered level no matter which
        // `select` upstream happens to reach.
        const rewriteSelection = (host, selection) => {
          try {
            // Upstream reaches `select` with three intents and two related
            // shapes:
            //   * `chooseModel` sends the target model
            //     `{ provider, model }`;
            //   * `chooseEffort` always sends the *current* model, with a
            //     level for a real choice and none for "provider default".
            // A same-model string is an explicit effort choice when it
            // actually changes the effective level, including a choice that
            // equals the model default. A different model's no-level selection is the
            // model-row payload, not an edit — keep it available for the
            // remembered target-model override.
            const snapshot = host.store.getSnapshot()
            // `select()` marks a target as pending before the Host projection settles.
            // Use that target as the effective current model so a quick A→B→A sequence
            // cannot compare the third click with the stale A projection.
            const current = snapshot.pending ?? snapshot.current
            const sameModel = current?.provider === selection.provider && current?.model === selection.model
            const defaultEffort = host.catalog?.reasoningFor?.(selection)?.defaultEffort
            const currentEffort = current?.reasoningEffort ?? defaultEffort
            const isEdit = typeof selection.reasoningEffort === 'string' &&
              (sameModel
                ? currentEffort !== selection.reasoningEffort
                : selection.reasoningEffort !== defaultEffort)
            const key = effortKey(selection.model)
            if (isEdit) {
              // An explicit level is the user's edit: remember it.
              if (efforts[key] !== selection.reasoningEffort) {
                efforts[key] = selection.reasoningEffort
                writeEfforts()
              }
            } else if (sameModel && selection.reasoningEffort === undefined) {
              // Same model, no level: the effort submenu's provider default.
              // This conversation follows the provider, but the binding stays
              // — picking the model again later restores its own level.
            } else if (!sameModel) {
              // A model switch (or a fresh session not yet on this model):
              // apply the level bound to the target model.
              const remembered = rememberedEffort(selection.model)
              if (typeof remembered === 'string' && supported(host.catalog, selection, remembered)) {
                selection = { ...selection, reasoningEffort: remembered }
              }
            }
            // Whatever the shape, a selection is the moment to catch up on a
            // write the storage refused earlier. The value is often *already*
            // in the live copy (so no branch above would write), and the branch
            // that would care differs by shape — a model switch never reaches
            // the edit branch at all. One retry point here covers every shape.
            if (storageStale) writeEfforts()
          } catch {
            // Degradation: the untouched selection goes through as-is.
          }
          return selection
        }

        // freecodego (and anything shaped like it) installs an own `select` on the
        // directory, bound to whatever `select` existed when it ran. An own
        // property shadows the prototype patch, so that captured method is the
        // *unrewritten* one and the first Host call would go out without a level —
        // the correction then chases it as a second selection, which is the
        // flicker and the visible pair. Re-check on every store notification
        // because the wrapper is installed lazily, after this plugin applies.
        const hookInstanceSelect = directory => {
          if (!Object.hasOwn(directory, 'select')) return
          const own = directory.select
          if (typeof own !== 'function') return
          const previous = hookedInstances.get(directory)
          if (previous !== undefined && previous.wrapper === own) return
          const wrapper = function (selection) {
            return own.call(this, rewriteSelection(this, selection))
          }
          hookedInstances.set(directory, { original: own, wrapper })
          directory.select = wrapper
        }

        const hookSelect = (directory, track = true) => {
          const proto = Object.getPrototypeOf(directory)
          if (proto === null || typeof proto.select !== 'function') return
          if (!hookedPrototypes.has(proto)) {
            const select = proto.select
            proto.__dshOriginalSelect = select
            hookedPrototypes.add(proto)
            proto.select = function (selection) {
              return select.call(this, rewriteSelection(this, selection))
            }
          }
          hookInstanceSelect(directory)
          if (!track || hookedDirectories.has(directory)) return
          // Subscribe before the synchronous substitution so the echo of its own
          // write re-enters below, not here.
          const unsubscribe = directory.store?.subscribe?.(() => {
            // The wrapper can appear at any time (freecodego installs it from a
            // render-time effect), so a directory that gains one after being
            // hooked must be caught here — otherwise its next Host call loses
            // the remembered level again.
            hookInstanceSelect(directory)
            substituteEffort(directory)
            // The echo of the substitution's own write must not start the
            // write-through: this listener already runs it right below, and
            // letting the nested notification do it too would issue the same
            // correction twice.
            if (!substitutingDirectories.has(directory)) reconcileDirectory(directory)
          })
          hookedDirectories.set(directory, typeof unsubscribe === 'function' ? unsubscribe : () => {})
          // `directoryFor` is called by the picker's render path, before React
          // first reads the store. Substituting here is what makes the label
          // correct on the very first paint; anything scheduled later shows the
          // provider default first and jumps once the Host answers.
          substituteEffort(directory)
          queueMicrotask(() => reconcileDirectory(directory))
        }

        const modelDirectoriesFace = scope.modelDirectories
        const modelDirectories = modelDirectoriesFace[Symbol.for('cordis.original')] ?? modelDirectoriesFace

        // A Cordis Service face is a traceable proxy. Writing `directoryFor` to
        // that face only writes a disposable shadow, so later callers never see
        // the hook. Patch the service origin instead: every directory, including
        // one created after a new session scope becomes ready, is intercepted at
        // the resolver that creates it.
        const ownDirectoryFor = Object.getOwnPropertyDescriptor(modelDirectories, 'directoryFor')
        const directoryFor = modelDirectories.directoryFor
        const hookedDirectoryFor = function (sessionId) {
          const directory = directoryFor.call(this, sessionId)
          hookSelect(directory)
          return directory
        }
        Object.defineProperty(modelDirectories, 'directoryFor', {
          configurable: true,
          writable: true,
          value: hookedDirectoryFor
        })

        // Existing rows are hooked eagerly; the resolver above is the lifecycle
        // authority for rows whose session scope is not ready yet.
        const hookDirectories = () => {
          for (const directory of modelDirectories.live?.directories?.values ?? []) hookSelect(directory)
          for (const id of ctx.sessions.list.getSnapshot().ids) {
            try { hookSelect(directoryFor.call(modelDirectories, id), false) } catch { /* unavailable session */ }
          }
        }

        // Existing conversations may already carry an explicit effort from
        // before this feature was installed. Seed only missing model keys from
        // those durable projections; later user edits are recorded by hookSelect.
        const learnMissingEfforts = () => {
          let changed = false
          const list = ctx.sessions.list.getSnapshot()
          const catalogReady = modelDirectories.catalog.store.getSnapshot().status === 'ready'
          for (const id of list.ids) {
            if (learnedSessions.has(id)) continue
            const row = list.byId[id]
            if (row === undefined) continue
            if (row.origin === 'subagent' || row.parentId !== undefined) {
              learnedSessions.add(id)
              continue
            }
            const selection = selectionOf(row)
            if (selection === undefined || !catalogReady) continue
            learnedSessions.add(id)
            if (typeof selection.reasoningEffort !== 'string') continue
            const key = effortKey(selection.model)
            if (typeof rememberedEffort(selection.model) === 'string') continue
            if (!supported(modelDirectories.catalog, selection, selection.reasoningEffort)) continue
            efforts[key] = selection.reasoningEffort
            changed = true
          }
          if (changed) writeEfforts()
        }

        hookDirectories()
        learnMissingEfforts()

        // ------------------------------------------------------------------
        // Wiring
        // ------------------------------------------------------------------

        const syncGroups = groupsEl => {
          const menuId = groupsEl.closest(MENU_SELECTOR)?.id ?? ''
          const reactId = menuId.replace(/-menu$/, '')
          const selfId = selfIdOf(groupsEl)
          if (menuId !== '' && selfId !== undefined && selfId !== '') menuSessions.set(menuId, selfId)

          // Groups are decorated regardless of whether the conversation can be
          // named — collapsing has nothing to do with which session is looking.
          for (const section of groupsEl.querySelectorAll(SECTION_SELECTOR)) {
            stampGroup(section, reactId)
          }
          // Before the row, so it can read the labels the sections just got.
          syncSort(groupsEl)
          // After the headings, so the icon can read the states they just took.
          syncToggleAll(groupsEl)

          const sections = groupsEl.querySelectorAll(SECTION_SELECTOR)
          if (selfId === undefined || selfId === '') {
            for (const section of sections) {
              section.removeAttribute('data-dsh-group-in-use')
              for (const button of section.querySelectorAll(ROW_SELECTOR)) unmark(button)
            }
            return
          }
          const inUse = inUseKeys(selfId)
           const own = ctx.sessions.list.getSnapshot().byId?.[selfId]
           const ownSelection = own?.running ? (selectionOf(own) ?? catalogDefault()) : undefined
           const ownKey = ownSelection?.provider === undefined || ownSelection?.model === undefined
             ? undefined
             : `${ownSelection.provider}\u0000${ownSelection.model}`
          const byLabel = keyByLabel()
          for (const section of sections) {
            const group = section.querySelector(TITLE_SELECTOR)?.textContent ?? ''
            // A collapsed group hides its rows, so the group itself has to carry
            // the news that one of its models is in use — otherwise collapsing a
            // group is how you lose sight of a running conversation. The heading
            // text is deliberately left its normal colour; only the dot is added.
            let anyInUse = false
            for (const button of section.querySelectorAll(ROW_SELECTOR)) {
              const name = button.querySelector(NAME_SELECTOR)?.textContent ?? ''
              const key = byLabel.get(`${group}\u0000${name}`)
              if (key === undefined || (!inUse.has(key) && key !== ownKey)) {
                unmark(button)
                continue
              }
              anyInUse = true
              if (inUse.has(key)) mark(button, name)
               else unmark(button)
            }
            if (anyInUse) section.setAttribute('data-dsh-group-in-use', 'true')
            else section.removeAttribute('data-dsh-group-in-use')
          }
        }

        const modelLabelFor = row => {
          const selection = selectionOf(row) ?? scope.modelDirectories.catalog.store.getSnapshot().value?.default
          if (selection === undefined || selection === null) return undefined
          const groups = scope.modelDirectories.catalog.store.getSnapshot().value?.groups ?? []
          const model = groups.find(group => group.id === selection.provider)?.models?.find(item => item.id === selection.model)
          if (model === undefined) return undefined
          const effortId = selection.reasoningEffort ?? model.reasoning?.defaultEffort
          const effort = model.reasoning?.efforts?.find(level => level.id === effortId)?.name ?? effortId
          // The model's own name is used exactly as the catalog writes it (its
          // internal `·` keeps its own spacing). The effort is one plain field:
          // separated by a space: `Deepseek-V4.1-Flash · x0.00 Low`.
          return effort === undefined ? model.name : `${model.name} ${effort}`
        }

        // One turn can be served by several assistant steps (a tool call in the
        // middle splits it), and each step records its own decode window:
        // `firstTokenTime` -> `completedTime`. The rate of the turn is therefore
        // the sum of every step's output tokens over the sum of their decode
        // time — never the whole session's running total, which is a different
        // number and does not move from turn to turn.
        const turnSpeedOf = (nodes, messageId) => {
          let turn
          for (const node of nodes) {
            if (node?.kind === 'assistant' && node.messageId === messageId) turn = node.turn
          }
          if (turn === undefined) return undefined
          let tokens = 0
          let ms = 0
          for (const node of nodes) {
            if (node?.kind !== 'assistant' || node.turn !== turn) continue
            const timing = node.timing
            const output = node.usage?.outputTokens
            if (timing === undefined || timing === null) continue
            if (typeof timing.firstTokenTime !== 'number') continue
            if (typeof timing.completedTime !== 'number') continue
            if (typeof output !== 'number' || !(output >= 0)) continue
            tokens += output
            ms += Math.max(0, timing.completedTime - timing.firstTokenTime)
          }
          if (!(tokens > 0) || !(ms > 0)) return undefined
          const tps = Math.max(0, tokens / (ms / 1000))
          // Same rounding as the host's own readout: whole numbers once past
          // ten, one decimal below it, where a whole number would read as 0.
          return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10)
        }

        // The seat renders on the turn's own action line — the same row as the
        // copy button and the usage chip — so it needs no DOM seam of its own:
        // the framework hands the component `messageId` plus the same chat hooks
        // the host uses, and React keeps the node where the host would put it.
        const TurnSpeed = props => {
          const useChat = props?.useChat
          let nodes
          try {
            // One hook call, always, before any early return: the seat is
            // re-rendered by the host and a conditional hook would desync.
            nodes = typeof useChat === 'function' ? useChat(snapshot => snapshot?.legacy?.nodes) : undefined
          } catch {
            return null
          }
          const messageId = props.messageId
          if (typeof messageId !== 'string' || messageId === '') return null
          if (!Array.isArray(nodes)) return null
          const speed = turnSpeedOf(nodes, messageId)
          return React.createElement('span', {
            'data-dsh-turn-speed': '',
            title: speed === undefined ? '' : t('speedHint'),
            // The formatted rate is also carried as a prop so the harness can
            // read it without running a browser: the fixture's React stub calls
            // the hook directly and never mounts.
            'data-dsh-turn-speed-rate': speed === undefined ? '' : t('tokensPerSecond', { tps: speed })
          }, speed === undefined ? null : t('tokensPerSecond', { tps: speed }))
        }

        const HoverModel = ({ sessionId }) => {
          // The workspace owns the card and exposes this list Slot immediately
          // before its native status rows. The hidden anchor gives us a stable,
          // session-id-based seam; a React portal adds only the label to the native
          // “running” row, preserving its own dot/wording without editing its DOM.
          const list = React.useSyncExternalStore(
            listener => ctx.sessions.list.subscribe(listener),
            () => ctx.sessions.list.getSnapshot()
          )
          React.useSyncExternalStore(
            listener => modelDirectories.catalog.store.subscribe(listener),
            () => modelDirectories.catalog.store.getSnapshot()
          )
          const row = list.byId?.[sessionId]
          const label = modelLabelFor(row)
          const anchor = React.useRef(null)
          const [status, setStatus] = React.useState(null)
          React.useLayoutEffect(() => {
            const slot = anchor.current?.closest?.('[data-slot="sidebar.session.row.hover"]')
            let next = row?.running && row.pendingInteraction === undefined && label !== undefined
              ? slot?.nextElementSibling
              : null
            while (next !== null && next !== undefined && !String(next.className ?? '').includes('_hoverStatus')) {
              next = next.nextElementSibling
            }
            setStatus(current => current === next ? current : (next ?? null))
          }, [row?.running, row?.pendingInteraction, label])
          return React.createElement('span', {
            ref: anchor,
            hidden: true,
            'data-dsh-hover-model-anchor': '',
            'data-dsh-hover-model-label': label ?? ''
          }, status === null ? null : ReactDOM.createPortal(
            React.createElement('span', {
              'data-dsh-hover-model': '',
              className: 'dsh-model-in-use-hover-model'
            }, label),
            status
          ))
        }

        ctx.effect(() => ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
          name: 'sidebar.session.row.hover',
          id: 'dsh-model-in-use',
          order: 100
        }, HoverModel)), 'dsh-model-in-use: sidebar hover model')

        // The turn tail's own action line: the host renders this list right after
        // the copy button and before the usage chip, on the row that already
        // carries the turn's clock. No portal, no DOM surgery — the framework
        // hands over `messageId` and the chat hooks.
        ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-model-in-use:speed',
          order: 10,
          locale: NS
        }, TurnSpeed)), 'dsh-model-in-use: turn decode rate')

        const onModelRowClick = event => {
          const row = event.target?.closest?.(ROW_SELECTOR)
          if (row === null || row === undefined) return
          const groupsEl = row.closest(GROUPS_SELECTOR)
          const selfId = groupsEl === null ? undefined : selfIdOf(groupsEl)
          if (selfId === undefined || selfId === '') return
          const groupTitle = row.closest(SECTION_SELECTOR)?.querySelector(TITLE_SELECTOR)?.textContent ?? ''
          const name = row.querySelector(NAME_SELECTOR)?.textContent ?? ''
          const selection = keyByLabel().get(`${groupTitle}\u0000${name}`)
          if (selection === undefined) return
          const directory = modelDirectories.directoryFor(selfId)
          // A wrapper installed after the last store notification would still be
          // the own property React reaches next; this capture-phase listener runs
          // before that handler, so the rewrite is in place for this click.
          hookInstanceSelect(directory)
          const current = directory.store.getSnapshot().current
          const [provider, model] = selection.split('\u0000')
          // Codex turns a click on the already-current model into close-only, so
          // this is the only path that can still correct the level. The guard is
          // the same pair Codex compares: a provider-changing click does reach
          // `select`, and firing here as well would race its effort-less payload.
          if (current?.provider !== provider || current.model !== model) return
          const remembered = rememberedEffort(model)
          if (typeof remembered !== 'string' || current.reasoningEffort === remembered || !supported(directory.catalog, { provider, model }, remembered)) return
          directory.select({ provider, model, reasoningEffort: remembered })
        }

        const onEffortClick = event => {
          const option = event.target?.closest?.('button.codexModelSelectOption[role="menuitemradio"]')
          if (option === null || option === undefined || option.closest(GROUPS_SELECTOR) !== null) return
          const menu = option.closest(`${MENU_SELECTOR}[id]`) ?? option.closest('[role="menu"][id]')
          const sessionId = menu === null || menu === undefined ? undefined : menuSessions.get(menu.id)
          if (sessionId === undefined) return
          let directory
          try { directory = modelDirectories.directoryFor(sessionId) } catch { return }
          const label = option.querySelector(NAME_SELECTOR)?.textContent?.trim()
          if (label === undefined || label === '') return
          rememberEffortClick(directory, label)
        }

        const schedule = () => {
          if (scheduled) return
          scheduled = true
          queueMicrotask(() => {
            scheduled = false
            scan()
          })
        }

        // Only the model pane carries `codexModelSelectGroups`, so watching each
        // live pane catches re-renders inside an open menu. Menus appearing and
        // disappearing are handled by the <body> observer below.
        const scan = () => {
          watchRoot()
          // A client reload, or anything that replaces <head>, drops the style
          // element while the attributes it drives stay on the nodes — the dots
          // and arrows merely vanish. Re-assert it on every scan.
          if (!document.getElementById(STYLE_ID)) (document.head ?? document.documentElement).append(style)
          const live = new Set(document.querySelectorAll(GROUPS_SELECTOR))
          for (const groupsEl of live) {
            if (observers.has(groupsEl)) continue
            const observer = new MutationObserver(schedule)
            observer.observe(groupsEl, { childList: true, subtree: true, characterData: true })
            observers.set(groupsEl, observer)
          }
          for (const [groupsEl, observer] of observers) {
            if (live.has(groupsEl)) continue
            observer.disconnect()
            observers.delete(groupsEl)
          }
          for (const groupsEl of live) syncGroups(groupsEl)
        }

        // The menu is NOT portaled: CodexModelSelect renders it inline, deep
        // inside the composer subtree. So <body> has to be watched with
        // `subtree`, or a menu opening is invisible and nothing is ever marked.
        // A bare subtree watch would also fire on every streamed token, so the
        // records are filtered down to mutations that add or remove a model
        // pane; everything else is ignored before it can reach `scan`.
        const paneTouched = records => {
          for (const record of records) {
            for (const node of [...record.addedNodes, ...record.removedNodes]) {
              if (node.nodeType !== 1) continue
              if (node.matches(GROUPS_SELECTOR) || node.querySelector(GROUPS_SELECTOR) !== null) return true
            }
          }
          return false
        }
        const bodyObserver = new MutationObserver(records => {
          if (paneTouched(records)) schedule()
        })
        let observedRoot
        const watchRoot = () => {
          const root = document.body ?? document.documentElement
          if (root === undefined || root === observedRoot) return
          bodyObserver.disconnect()
          bodyObserver.observe(root, { childList: true, subtree: true })
          observedRoot = root
        }

        scan()
        document.addEventListener('click', onModelRowClick, true)
        document.addEventListener('click', onEffortClick, true)

        // Usage changes without any DOM mutation: a conversation starts or stops
        // running, switches model, or the shared catalog loads. A new session also
        // gets its directory hook here before its picker can submit a switch.
        // Substitution runs first and unconditionally: a catalog that only just
        // became ready is exactly when the remembered level can be painted.
        const reconcileDirectories = () => {
          for (const directory of hookedDirectories.keys()) {
            substituteEffort(directory)
            reconcileDirectory(directory)
          }
        }
        // `schedule()` runs first on both subscriptions: nothing this plugin
        // derives from a row should be able to leave the menu undecorated.
        const unsubscribeSessions = ctx.sessions.list.subscribe(() => {
          schedule()
          hookDirectories()
          learnMissingEfforts()
          reconcileDirectories()
        })
        const unsubscribeCatalog = scope.modelDirectories.catalog.store.subscribe(() => {
          schedule()
          learnMissingEfforts()
          reconcileDirectories()
        })

        ctx.effect(() => () => {
          disposed = true
          for (const unsubscribe of hookedDirectories.values()) unsubscribe()
          hookedDirectories.clear()
          if (modelDirectories.directoryFor === hookedDirectoryFor) {
            if (ownDirectoryFor === undefined) delete modelDirectories.directoryFor
            else Object.defineProperty(modelDirectories, 'directoryFor', ownDirectoryFor)
          }
          for (const proto of hookedPrototypes) {
            if (proto.__dshOriginalSelect !== undefined) proto.select = proto.__dshOriginalSelect
            delete proto.__dshOriginalSelect
          }
          hookedPrototypes.clear()
          for (const [directory, entry] of hookedInstances) {
            if (directory.select === entry.wrapper) directory.select = entry.original
          }
          hookedInstances.clear()
          document.removeEventListener('click', onToggle, true)
          document.removeEventListener('keydown', onToggle, true)
           document.removeEventListener('click', onModelRowClick, true)
          bodyObserver.disconnect()
          for (const observer of observers.values()) observer.disconnect()
          observers.clear()
           document.removeEventListener('click', onEffortClick, true)
           menuSessions.clear()
          unsubscribeSessions()
          unsubscribeCatalog()
          for (const button of document.querySelectorAll(ROW_SELECTOR)) unmark(button)
          for (const section of document.querySelectorAll(SECTION_SELECTOR)) {
            section.removeAttribute('data-dsh-group-collapsed')
            section.removeAttribute('data-dsh-group-key')
            section.removeAttribute('data-dsh-group-in-use')
            // Only the `order` this plugin wrote, never anyone else's inline style.
            setOrder(section, '')
          }
          for (const heading of document.querySelectorAll(TOGGLE_SELECTOR)) {
            heading.removeAttribute('data-dsh-group-toggle')
            heading.removeAttribute('role')
            heading.removeAttribute('tabindex')
            heading.removeAttribute('title')
          }
          for (const all of document.querySelectorAll(ALL_SELECTOR)) all.remove()
          style.remove()
        }, 'dsh-model-in-use: menu decorator')
      })
    }

    return module.exports
  }
})
