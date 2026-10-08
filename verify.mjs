// Behavioural check for the dsh-model-in-use client half.
//
// It drives the plugin through the fixture in fixture.mjs, which reproduces the
// CodexModelSelect DOM *and* a MutationObserver that honours `subtree`. The
// menu is mounted deep inside the composer subtree on purpose: that is where
// CodexModelSelect really renders it (it is not portaled), and a menu mounted
// as a direct child of <body> is what previously hid the bug where the body
// observer never saw the menu open.
//
// Run: node verify.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  el,
  loadClient,
  mountCodexMenu,
  codexRowFor,
  clickOn,
  keyOn,
  settle,
  stubCtx
} from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, 'lib', 'client.js')

const MENU_ID = 'r1-menu'
const IN_USE = '其他会话正在使用中'
const COLLAPSE_KEY = 'dsh-model-in-use:collapsed-groups'
const EFFORT_KEY = 'dsh-model-in-use:model-efforts'

const DICTS = {
  'dsh-model-in-use': {
    inUse: IN_USE,
    expandGroup: '展开此提供商的模型',
    collapseGroup: '收起此提供商的模型'
  }
}

const GROUPS = [
  {
    id: 'deepseek-account',
    name: 'DeepSeek Account',
    models: [
      { id: 'v41-flash', name: 'DeepSeek-V41-Flash', description: 'tunable thinking budget' },
      { id: 'v4-pro', name: 'DeepSeek-V4-Pro', description: 'thinking always on · 16K default' }
    ]
  },
  {
    id: 'workbuddyai',
    name: 'WorkBuddy AI',
    models: [
      { id: 'hy3', name: 'Hy3 · x0.00', description: '32K context' },
      { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash · x0.00', description: '128K context' }
    ]
  }
]

const A = { provider: 'deepseek-account', model: 'v41-flash' }
const B = { provider: 'workbuddyai', model: 'hy3' }
const C = { provider: 'deepseek-account', model: 'v4-pro' }
const D = { provider: 'workbuddyai', model: 'deepseek-v4.1-flash' }

const session = (id, selection, extra = {}) => ({
  id,
  running: true,
  projectionValues: { modelSelection: { lastUsed: selection, next: selection } },
  ...extra
})

let failures = 0
const check = (label, ok) => {
  if (ok) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}`)
  }
}

const marked = name => codexRowFor(name)?.hasAttribute('data-dsh-model-in-use') === true
// The tooltip deliberately lives on the row's NAME SPAN, never the row button:
// freecodego's menu decorator claims a section only when it finds
// `button[role="menuitemradio"][title]`, and would then fight this plugin for the
// same heading. `rowTitleOf` is the gate that must stay shut.
const titleOf = name =>
  codexRowFor(name)?.querySelector('span.codexModelSelectOptionName')?.getAttribute('title') ?? null
const rowTitleOf = name => codexRowFor(name)?.getAttribute('title') ?? null
const sectionFor = name =>
  codexRowFor(name)?.closest('section.codexModelSelectGroup') ?? null
const collapsedState = name => sectionFor(name)?.getAttribute('data-dsh-group-collapsed') ?? null
const storedEffort = model =>
  JSON.parse(globalThis.localStorage.getItem(EFFORT_KEY) ?? 'null')?.[model] ?? undefined
const headingFor = name =>
  sectionFor(name)?.querySelector('div.codexModelSelectGroupTitle') ?? null

async function start({ rows, groups = GROUPS, mount = true, defaultSelection, keepCollapse = false, blockedSessions, residentDirectories, stubbornSessions }) {
  // The collapse memory is global to the browser, so every scenario except the
  // one that checks persistence starts from an empty store.
  if (!keepCollapse) globalThis.localStorage.clear()
  const ctx = stubCtx({ rows, groups, dictionaries: DICTS, defaultSelection, blockedSessions, residentDirectories, stubbornSessions })
  const { exports } = await loadClient(CLIENT)
  exports.apply(ctx)
  if (mount) mountCodexMenu(groups, { menuId: MENU_ID })
  await settle()
  return ctx
}

// --- 1. the baseline rule -------------------------------------------------
console.log('1. a model running in another conversation is marked')
{
  const ctx = await start({
    rows: [
      session('self', A),
      session('other', B),
      session('idle', C, { running: false }),
      session('child', D, { origin: 'subagent' })
    ]
  })

  check('a running sibling marks its model', marked('Hy3 · x0.00'))
  check('an idle sibling does not', !marked('DeepSeek-V4-Pro'))
  check('a subagent does not', !marked('Deepseek-V4.1-Flash · x0.00'))
  check('an unmarked row carries no tooltip', titleOf('DeepSeek-V4-Pro') === null)
  check('a marked row explains itself', titleOf('Hy3 · x0.00') === `Hy3 · x0.00 · ${IN_USE}`)
  // The tooltip must NOT be on the button: freecodego gates its whole menu
  // decoration on `button[role="menuitemradio"][title]`, and it would then add a
  // second chevron and a second collapse state to the same heading.
  check('the tooltip is not on the row button', rowTitleOf('Hy3 · x0.00') === null)

  ctx.dispose()
}

// --- 1b. the conversation viewing the menu is never marked ----------------
console.log('1b. the current conversation is never marked as in use by itself')
{
  const ctx = await start({ rows: [session('self', A)] })

  check('own model is unmarked', !marked('DeepSeek-V41-Flash'))

  ctx.dispose()
}

// --- 1c. a nested child conversation is not a main conversation -----------
console.log('1c. a child conversation is excluded')
{
  const ctx = await start({ rows: [session('self', A), session('nested', C, { parentId: 'self' })] })

  check('a child does not mark its model', !marked('DeepSeek-V4-Pro'))

  ctx.dispose()
}

// --- 2. the mark follows the data ----------------------------------------
console.log('2. the mark follows model switches and clears on dispose')
{
  const ctx = await start({ rows: [session('self', A), session('other', B)] })

  check('initially marked', marked('Hy3 · x0.00'))

  ctx.setRows([session('self', A), session('other', A)])
  await settle()
  check('cleared when the sibling switches away', !marked('Hy3 · x0.00'))
  check('set when the sibling switches onto it', marked('DeepSeek-V41-Flash'))
  check('the tooltip is restored, not left behind', titleOf('Hy3 · x0.00') === null)

  ctx.dispose()
  check('dispose removes every mark', !marked('DeepSeek-V41-Flash'))
  check('dispose removes the stylesheet', globalThis.document.head.children.length === 0)
}
// --- 3. a blank session falls back to the catalog default -----------------
console.log('3. a session with no projection falls back to the catalog default')
{
  const ctx = await start({
    rows: [
      session('self', A),
      { id: 'fresh', running: true, projectionValues: undefined }
    ],
    defaultSelection: A
  })

  check('the catalog default is treated as in use', marked('DeepSeek-V41-Flash'))

  ctx.setRows([{ id: 'fresh', running: false, projectionValues: undefined }])
  await settle()
  check('and clears the moment it stops running', !marked('DeepSeek-V41-Flash'))

  ctx.dispose()
}

// --- 4. the menu opens later, deep in the composer subtree ----------------
console.log('4. a menu mounted after the plugin started is decorated')
{
  const ctx = stubCtx({
    rows: [session('self', A), session('other', B)],
    groups: GROUPS,
    dictionaries: DICTS
  })
  const { exports } = await loadClient(CLIENT)
  exports.apply(ctx)
  await settle()

  // Nothing to decorate yet, and no rescan should have been scheduled.
  check('nothing is marked before the menu exists', codexRowFor('Hy3 · x0.00') === undefined)

  // Now open the menu the way the component does: React inserts it deep inside
  // the composer subtree. A body observer without `subtree` never sees this.
  mountCodexMenu(GROUPS, { menuId: MENU_ID })
  await settle()

  check('the late menu is found and decorated', marked('Hy3 · x0.00'))
  check('and only the occupied model', !marked('DeepSeek-V41-Flash'))

  ctx.dispose()
}

// --- 5. the catalog is not ready yet --------------------------------------
console.log('5. a model cannot be mapped before the catalog is ready')
{
  const ctx = await start({
    rows: [session('self', A), session('other', B)],
    groups: []
  })

  check('no rows means nothing is marked', !marked('Hy3 · x0.00'))

  // The catalog arriving is a React re-render: the store changes first, then
  // the DOM follows. Both happen before the next sync can see them.
  ctx.setGroups(GROUPS)
  mountCodexMenu(GROUPS, { menuId: MENU_ID })
  await settle()
  check('the mark appears once the catalog arrives', marked('Hy3 · x0.00'))

  ctx.dispose()
}

// --- 6. one mark per model, not per session --------------------------------
console.log('6. two conversations on the same model are one mark')
{
  const ctx = await start({
    rows: [session('self', A), session('a', B), session('b', B)]
  })

  const markedRows = globalThis.document.body
    .querySelectorAll('button.codexModelSelectOption')
    .filter(button => button.hasAttribute('data-dsh-model-in-use'))

  check('exactly one row is marked', markedRows.length === 1)
  check('and it is the shared model', marked('Hy3 · x0.00'))

  ctx.dispose()
}

// --- 7. effort/speed rows are not model rows ------------------------------
console.log('7. rows outside the model pane are left alone')
{
  const ctx = await start({ rows: [session('self', A), session('other', B)] })

  // The effort submenu reuses the same `option()` factory, so a naive
  // `button[role="menuitemradio"]` selector would mark it too.
  const effort = el('div', { class: 'codexModelSelectSubmenu', role: 'menu' }, [
    el('div', { class: 'codexModelSelectGroups' }, [
      el('section', { class: 'codexModelSelectGroup', role: 'group' }, [
        el('div', { class: 'codexModelSelectGroupTitle', __text: 'WorkBuddy AI' }),
        el('button', { role: 'menuitemradio', class: 'codexModelSelectOption' }, [
          el('span', { class: 'codexModelSelectOptionCopy' }, [
            el('span', { class: 'codexModelSelectOptionName', __text: 'Hy3 · x0.00' })
          ]),
          el('span', { class: 'codexModelSelectCheck' })
        ])
      ])
    ])
  ])
  globalThis.document.body.append(effort)
  await settle()

  const inEffort = effort.querySelectorAll('button.codexModelSelectOption')
  check('the effort pane is not decorated', inEffort.every(button => !button.hasAttribute('data-dsh-model-in-use')))
  // The group-level dot is the same rule: a pane the plugin cannot attribute to a
  // conversation must carry neither the row mark nor the group flag.
  check('the effort pane group is not flagged',
    effort.querySelector('section.codexModelSelectGroup')?.getAttribute('data-dsh-group-in-use') === null)

  ctx.dispose()
}

// --- 8. every group is collapsible, and nothing starts collapsed ----------
console.log('8. every provider group gets a toggle')
{
  const ctx = await start({ rows: [session('self', A)] })

  const headings = globalThis.document.body.querySelectorAll('div.codexModelSelectGroupTitle')
  check('both groups have a toggle', headings.every(heading => heading.hasAttribute('data-dsh-group-toggle')))
  check('the toggle is a button', headings.every(heading => heading.getAttribute('role') === 'button'))
  check('the toggle is reachable by keyboard', headings.every(heading => heading.getAttribute('tabindex') === '0'))
  check('nothing starts collapsed', headings.every(heading =>
    heading.closest('section').getAttribute('data-dsh-group-collapsed') === 'false'
  ))
  check('the heading explains what clicking does',
    headingFor('Hy3 · x0.00')?.getAttribute('title') === '收起此提供商的模型')

  // A group is identified by its provider id, taken from aria-labelledby — the
  // heading TEXT is the display name and would forget the state on a language
  // switch.
  check('the group key is the provider id',
    sectionFor('Hy3 · x0.00')?.getAttribute('data-dsh-group-key') === 'workbuddyai')

  ctx.dispose()
}

// --- 9. toggling collapses only its own group ----------------------------
console.log('9. toggling a group collapses only that group')
{
  const ctx = await start({ rows: [session('self', A)] })

  clickOn(headingFor('Hy3 · x0.00'))
  await settle()

  check('the clicked group collapses', collapsedState('Hy3 · x0.00') === 'true')
  check('the other group is untouched', collapsedState('DeepSeek-V41-Flash') === 'false')
  check('the heading now offers to expand',
    headingFor('Hy3 · x0.00')?.getAttribute('title') === '展开此提供商的模型')

  clickOn(headingFor('Hy3 · x0.00'))
  await settle()
  check('clicking again expands it', collapsedState('Hy3 · x0.00') === 'false')

  keyOn(headingFor('DeepSeek-V4-Pro'), 'Enter')
  await settle()
  check('Enter toggles too', collapsedState('DeepSeek-V4-Pro') === 'true')

  keyOn(headingFor('DeepSeek-V4-Pro'), 'Escape')
  await settle()
  check('any other key is ignored', collapsedState('DeepSeek-V4-Pro') === 'true')

  ctx.dispose()
}

// --- 10. the collapse state is remembered across a remount ----------------
console.log('10. the collapsed set survives the plugin being reloaded')
{
  const first = await start({ rows: [session('self', A)] })
  clickOn(headingFor('Hy3 · x0.00'))
  await settle()
  check('collapsed before the reload', collapsedState('Hy3 · x0.00') === 'true')
  check('and it was written down', JSON.parse(globalThis.localStorage.getItem(COLLAPSE_KEY))?.workbuddyai === true)
  first.dispose()

  // A fresh plugin instance with the same browser storage: exactly what a page
  // reload is. The menu is rebuilt from scratch.
  const second = await start({ rows: [session('self', A)], keepCollapse: true })
  check('still collapsed after the reload', collapsedState('Hy3 · x0.00') === 'true')
  check('the group that was never touched is not', collapsedState('DeepSeek-V41-Flash') === 'false')
  check('and it is not marked as in use', !marked('Hy3 · x0.00'))
  second.dispose()
}

// --- 11. unreadable storage must not break the menu ----------------------
console.log('11. a throwing localStorage leaves the menu working')
{
  globalThis.localStorage.clear()
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('SecurityError: storage is blocked')
    },
    setItem: () => {
      throw new Error('SecurityError: storage is blocked')
    },
    clear: () => {}
  }

  const ctx = await start({ rows: [session('self', A)] })
  check('groups are still decorated', headingFor('Hy3 · x0.00')?.hasAttribute('data-dsh-group-toggle') === true)
  clickOn(headingFor('Hy3 · x0.00'))
  await settle()
  check('toggling still works in memory', collapsedState('Hy3 · x0.00') === 'true')

  ctx.dispose()
  globalThis.localStorage = real
}

// --- 12. a collapsed group still announces its running model ------------
console.log('12. a group with a model in use is dotted at the group level')
{
  const ctx = await start({ rows: [session('self', A), session('other', B)] })

  const workbuddy = sectionFor('Hy3 · x0.00')
  const deepseek = sectionFor('DeepSeek-V41-Flash')
  check('the group holding the running model is flagged',
    workbuddy?.getAttribute('data-dsh-group-in-use') === 'true')
  check('the current conversation also flags its model group',
    deepseek?.getAttribute('data-dsh-group-in-use') === 'true')

  // The dot is a `::before` on the heading (CSS), so the flag is the whole
  // observable contract. It must survive the group being collapsed — that is
  // the point: collapsing hides the rows, so the heading is the only place the
  // running model can still be announced.
  clickOn(headingFor('Hy3 · x0.00'))
  await settle()
  check('the flag survives collapsing', workbuddy?.getAttribute('data-dsh-group-in-use') === 'true')

  ctx.setRows([session('self', A), session('other', A)])
  await settle()
  check('the group now holding it is flagged', deepseek?.getAttribute('data-dsh-group-in-use') === 'true')

  ctx.dispose()
}

// --- 13. the in-use flag never leaks onto the wrong section --------------
console.log('13. the group flag is per group, not per menu')
{
  const ctx = await start({ rows: [session('self', A), session('other', D)] })

  const flagged = globalThis.document.body
    .querySelectorAll('section.codexModelSelectGroup')
    .filter(section => section.getAttribute('data-dsh-group-in-use') === 'true')

  check('the current and other model groups are flagged', flagged.length === 2)
  check('and it is the workbuddy group', flagged.includes(sectionFor('Deepseek-V4.1-Flash · x0.00')) && flagged.includes(sectionFor('Hy3 · x0.00')))
  check('the model in use in that group is marked', marked('Deepseek-V4.1-Flash · x0.00'))
  check('its sibling is not', !marked('Hy3 · x0.00'))

  ctx.dispose()
}

// --- 14. the injected stylesheet still carries the layout fixes ----------
console.log('14. the stylesheet keeps the rules that fix the reported glitches')
{
  // Two of the reported glitches (groups touching, sticky heading text bleeding
  // through the rows) are pure CSS: no DOM assertion can see them, because the
  // fixture has no layout engine. What CAN be pinned is that the rules are still
  // there — deleting one is exactly how the glitch comes back.
  const ctx = await start({ rows: [session('self', A)] })
  const css = globalThis.document.head.children[0]?.textContent ?? ''

  check('the model group list is a flex column with a real gap',
    /div\.codexModelSelectGroups\{[^}]*display:flex[^}]*gap:4px/.test(css))
  check('the old DOM-adjacency margin is neutralized',
    /section\.codexModelSelectGroup\+section\.codexModelSelectGroup\{margin-top:0\}/.test(css))
  // The `/ 1` is the whole fix: relative colour syntax inherits the origin's
  // alpha when alpha is omitted, so `rgb(from … r g b)` is STILL translucent and
  // the sticky heading keeps bleeding the row text through. An assertion that
  // only matched the `rgb(from …` prefix stayed green while exactly that bug
  // shipped, so this one requires the pinned alpha.
  check('the sticky heading forces its own background opaque',
    /background:rgb\(from var\(--dsw-alias-bg-layer-2[^)]*\)\s*r g b \/ 1\)/.test(css))
  check('and the alpha is pinned, not inherited from the origin colour',
    !/background:rgb\(from var\(--dsw-alias-bg-layer-2[^)]*\)\s*r g b\)/.test(css))
  check('and keeps a fallback first', /background:var\(--dsw-alias-bg-layer-2/.test(css))
  check('the dot colour is the requested green', css.includes('background:#3cc400'))
  check('the group dot only shows when flagged',
    /section\[data-dsh-group-in-use="true"\]>div\.codexModelSelectGroupTitle\[data-dsh-group-toggle\]::before/.test(css))
  check('the group dot does not recolour the heading text',
    !/section\[data-dsh-group-in-use="true"\][^{]*\{[^}]*color:/.test(css))

  ctx.dispose()
}

// --- 15. a remembered reasoning effort follows its model ------------------
console.log('15. the reasoning effort chosen for a model is remembered and restored')
const EFFORT_GROUPS = [
  {
    id: 'deepseek-account',
    name: 'DeepSeek Account',
    models: [
      { id: 'v41-flash', name: 'F', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
      { id: 'v4-pro', name: 'P', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }
    ]
  },
  {
    id: 'workbuddyai',
    name: 'WorkBuddy AI',
    models: [
      { id: 'hy3', name: 'H', reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium', name: 'Medium' }, { id: 'ultra', name: 'Ultra' }] } }
    ]
  }
]
{
  const ctx = await start({ rows: [session('self', A)], groups: EFFORT_GROUPS })
  const dir = ctx.modelDirectories.directoryFor('self')
  const calls = () => ctx.directoryCalls
  // The plugin's contract: the same provider+model is an effort restatement
  // (record), a different one is a model switch (restore what that target
  // model remembered, validated against its own effort list).
  ctx.setCurrent({ ...A, reasoningEffort: 'low' })
  await dir.select({ ...A, reasoningEffort: 'high' })
  check('restating an effort writes it down',
    storedEffort(A.model) === 'high')

  ctx.setCurrent({ ...A, reasoningEffort: 'high' })
  await dir.select({ ...A, reasoningEffort: 'low' })
  check('choosing the model default explicitly writes it down',
    storedEffort(A.model) === 'low')

  await dir.select({ ...A })
  check('choosing the provider default keeps the binding for the next pick',
    storedEffort(A.model) === 'low')

  ctx.setCurrent({ ...B, reasoningEffort: 'medium' })
  await dir.select({ ...C, reasoningEffort: 'low' })
  check('a model with no memory keeps the caller\'s default',
    calls().at(-1)?.reasoningEffort === 'low')
  check('the switch itself recorded nothing', storedEffort(C.model) === undefined)

  ctx.setCurrent({ ...A, reasoningEffort: 'low' })
  await dir.select({ ...A, reasoningEffort: 'high' })
  ctx.setCurrent({ ...C, reasoningEffort: 'low' })
  await dir.select({ ...A, reasoningEffort: 'low' })
  check('switching back to that model restores its remembered effort',
    calls().at(-1)?.reasoningEffort === 'high')

  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'ultra' }))
  await dir.select({ ...A, reasoningEffort: 'low' })
  check('a level the target model does not offer is not restored',
    calls().at(-1)?.reasoningEffort === 'low')

  ctx.dispose()
  check('the hook is undone on dispose',
    ctx.directoryProto.__dshOriginalSelect === undefined)
  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'high' }))
  const afterDispose = ctx.modelDirectories.directoryFor('after-dispose')
  afterDispose.setCurrent({ ...C, reasoningEffort: 'low' })
  await afterDispose.select({ ...A, reasoningEffort: 'low' })
  check('the resolver hook is also undone on dispose',
    calls().at(-1)?.reasoningEffort === 'low')
}

// --- 15b. an effort row that is already effective still records intent ------
console.log('15b. clicking the already-effective default binds the model')
{
  const ctx = await start({ rows: [session('self', A)], groups: EFFORT_GROUPS })
  ctx.setCurrent({ ...A, reasoningEffort: 'low' })
  const menu = globalThis.document.body.querySelector('div.codexModelSelectMenu')
  const low = el('button', { type: 'button', role: 'menuitemradio', class: 'codexModelSelectOption' }, [
    el('span', { class: 'codexModelSelectOptionCopy' }, [
      el('span', { class: 'codexModelSelectOptionName', __text: 'Low' })
    ])
  ])
  menu.append(low)
  clickOn(low)
  check('clicking the already-effective default writes the binding',
    storedEffort(A.model) === 'low')
  ctx.dispose()
}

// --- 15c. the same model under a second provider id keeps its binding ------
console.log('15c. a model served under several provider ids shares one binding')
{
  const TWIN_GROUPS = [
    {
      id: 'workbuddyai',
      name: 'WorkBuddy AI',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'F', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }
      ]
    },
    {
      id: 'workbuddyai-cn',
      name: 'WorkBuddy AI CN',
      models: [
        { id: 'deepseek-v4.1-flash', name: 'F', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }
      ]
    }
  ]
  const GLOBAL = { provider: 'workbuddyai', model: 'deepseek-v4.1-flash' }
  const CN = { provider: 'workbuddyai-cn', model: 'deepseek-v4.1-flash' }
  const ctx = await start({ rows: [session('self', GLOBAL)], groups: TWIN_GROUPS })
  const dir = ctx.modelDirectories.directoryFor('self')

  // Picked under the global id, level high.
  ctx.setCurrent({ ...GLOBAL, reasoningEffort: 'low' })
  await dir.select({ ...GLOBAL, reasoningEffort: 'high' })
  check('the level is stored once, keyed by model',
    Object.keys(JSON.parse(globalThis.localStorage.getItem(EFFORT_KEY) ?? '{}')).length === 1)

  // The same model reached through the CN provider id must restore it.
  ctx.setCurrent({ ...CN, reasoningEffort: 'low' })
  await dir.select({ ...GLOBAL, reasoningEffort: 'low' })
  check('the same model under another provider id restores the same level',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'high')

  // And the CN conversation now follows the provider default: the binding stays.
  await dir.select({ ...CN })
  check('the provider default on the twin keeps the binding',
    storedEffort(GLOBAL.model) === 'high')
  ctx.dispose()
}

// --- 16. a fresh conversation restores the model-bound effort --------------
console.log('16. a fresh conversation restores the remembered effort over the model default')
{
  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'high' }))
  const fresh = await start({
    rows: [session('new-session', A)],
    groups: EFFORT_GROUPS,
    defaultSelection: { ...A, reasoningEffort: 'low' },
    keepCollapse: true
  })
  const dir = fresh.modelDirectories.directoryFor('new-session')
  // The fresh session's own default is `low`; memory says `high`. The plugin
  // corrects the Host, and the label carries the corrected level from the start.
  await settle()
  check('the new session gets the remembered level instead of the official default',
    fresh.directoryCalls.at(-1)?.reasoningEffort === 'high')
  check('and its label shows that level',
    dir.store.getSnapshot().current?.reasoningEffort === 'high')
  fresh.dispose()
}

// --- 17. the effort memory survives a reload, and storage failure is safe --
console.log('17. the effort memory survives a reload and a throwing storage')
{
  const first = await start({ rows: [session('self', A)], groups: EFFORT_GROUPS })
  const dir = first.modelDirectories.directoryFor('self')
  first.setCurrent({ ...A, reasoningEffort: 'low' })
  await dir.select({ ...A, reasoningEffort: 'high' })
  first.dispose()

  const second = await start({ rows: [session('self', A)], groups: EFFORT_GROUPS, keepCollapse: true })
  const dir2 = second.modelDirectories.directoryFor('self')
  second.setCurrent({ ...B, reasoningEffort: 'medium' })
  await dir2.select({ ...A, reasoningEffort: 'low' })
  check('the remembered effort survives the reload',
    second.directoryCalls.at(-1)?.reasoningEffort === 'high')

  globalThis.localStorage.clear()
  const real = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    clear: () => {}
  }
  await dir2.select({ ...A, reasoningEffort: 'low' })
  // The stored level is unreadable, but selection must still go through. The
  // in-memory copy keeps serving the level it last saw, which is deliberate:
  // storage dying must not also erase the memory it already had.
  check('a throwing storage still lets the selection through',
    second.directoryCalls.at(-1)?.provider === 'deepseek-account')
  second.dispose()
  globalThis.localStorage = real
}

// --- 18. existing sessions seed memory; later sessions are hooked ----------
console.log('18. existing selections seed memory and a later conversation restores A → B → A')
{
  const existingA = session('existing-a', { ...A, reasoningEffort: 'high' })
  const existingB = session('existing-b', { ...B, reasoningEffort: 'ultra' })
  const ctx = await start({
    rows: [existingA, existingB],
    groups: EFFORT_GROUPS,
    blockedSessions: ['existing-a', 'existing-b', 'new-session']
  })

  check('an existing A selection seeds its model-bound effort',
    storedEffort(A.model) === 'high')
  check('an existing B selection seeds its model-bound effort',
    storedEffort(B.model) === 'ultra')

  // This conversation did not exist when apply() ran. The sessions-list
  // lifecycle subscription must hook its directory rather than relying on a
  // writable shadow of the Cordis Service method.
  ctx.setRows([existingA, existingB, session('new-session', A)])
  await settle()
  // The list notification happened before this session scope was ready, so the
  // eager hook missed it. The resolver-origin hook must catch the first later
  // directoryFor() call made by the composer.
  ctx.unblockDirectory('new-session')
  const fresh = ctx.modelDirectories.directoryFor('new-session')
  ctx.setCurrent({ ...A, reasoningEffort: 'low' }, 'new-session')
  await fresh.select({ ...B, reasoningEffort: 'medium' })
  check('the later conversation restores B instead of its model default',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'ultra')
  ctx.setCurrent({ ...B, reasoningEffort: 'ultra' }, 'new-session')
  await fresh.select({ ...A, reasoningEffort: 'low' })
  check('switching back restores A instead of its model default',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'high')

  // ModelDirectory marks B as pending before its Host projection settles. If
  // the user immediately clicks A, the durable current snapshot is still A;
  // the hook must classify the pending B as the effective current model.
  ctx.setCurrent({ ...A, reasoningEffort: 'low' }, 'new-session')
  fresh.store.set({ ...fresh.store.getSnapshot(), pending: { ...B } })
  await fresh.select({ ...A, reasoningEffort: 'low' })
  check('a quick A→B→A click restores A from the pending target',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'high')

  ctx.unblockDirectory('existing-a')
  const existingADirectory = ctx.modelDirectories.directoryFor('existing-a')
  ctx.setCurrent({ ...A, reasoningEffort: 'high' }, 'existing-a')
  await existingADirectory.select({ ...A })
  ctx.setRows([session('existing-a', { ...A, reasoningEffort: 'low' }), existingB, session('new-session', A)])
  await settle()
  check('choosing provider default keeps the binding against a later projection',
    storedEffort(A.model) === 'high')

  const hover = ctx.slotEntries.find(entry => entry.options.name === 'sidebar.session.row.hover')
  check('the sidebar hover contribution uses the declared Slot', hover !== undefined)
  check('the Slot resolves full model name and human effort label by session id',
    hover?.component({ sessionId: 'existing-b' })?.props?.['data-dsh-hover-model-label'] === 'H Ultra')

  ctx.dispose()
  check('the sidebar hover contribution unloads with the plugin', ctx.slotEntries.length === 0)
}

// --- 19. resident blank directories reconcile without a model-row select ----
console.log('19. a resident blank conversation restores its model-bound effort')
{
  globalThis.localStorage.clear()
  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'high' }))
  const current = { ...A, reasoningEffort: 'low' }
  const ctx = await start({
    rows: [],
    groups: EFFORT_GROUPS,
    defaultSelection: current,
    residentDirectories: [{ id: 'blank', current }],
    keepCollapse: true,
    mount: false
  })
  const directory = ctx.modelDirectories.directoryFor('blank')
  check('a directory cached before apply is found through the live registry',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'high')
  check('same-model close-only does not leave the blank composer on its default',
    directory.store.getSnapshot().current?.reasoningEffort === 'high')

  const css = document.head.querySelector('style[id="dsh-model-in-use-style"]')?.textContent ?? ''
  check('the hover card grows to keep its running detail on one line',
    css.includes('body>div:has([data-dsh-hover-model]){width:max-content'))
  check('the hover model is separated by the requested green dot',
    css.includes('.dsh-model-in-use-hover-model::before') && css.includes('background:#3cc400'))

  const calls = ctx.directoryCalls.length
  // One correction attempt per (directory, target level). A store that comes
  // back on the default anyway — a select the host refused, or any external
  // change — must not have the same correction re-issued against the host on
  // every notification, which is an unbounded RPC loop.
  directory.setCurrent(current)
  await settle()
  check('a correction the host did not take is not re-issued forever',
    ctx.directoryCalls.length === calls)

  ctx.dispose()
  directory.setCurrent(current)
  await settle()
  check('disposing removes resident-directory reconciliation', ctx.directoryCalls.length === calls)
}

// --- 20. the label is already correct on the FIRST paint ------------------
// The composer's label renders `current.reasoningEffort`. `select()` publishes
// only `pending` until the Host settles, so without a read-side substitution the
// first paint shows the provider default and jumps when the RPC answers. This
// scenario never lets the Host settle, which is the strongest form of that race:
// if the level is visible here, it was visible before any answer arrived.
console.log('20. a remembered level is visible before the Host answers')
{
  globalThis.localStorage.clear()
  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'high' }))
  const current = { ...A, reasoningEffort: 'low' }
  const ctx = await start({
    rows: [],
    groups: EFFORT_GROUPS,
    defaultSelection: current,
    residentDirectories: [{ id: 'blank', current }],
    stubbornSessions: ['blank'],
    keepCollapse: true,
    mount: false
  })
  const directory = ctx.modelDirectories.directoryFor('blank')
  check('the first paint already carries the remembered level',
    directory.store.getSnapshot().current?.reasoningEffort === 'high')
  check('and the store was published, not left as the provider default',
    directory.store.getSnapshot().status !== 'ready' || directory.store.getSnapshot().current?.reasoningEffort === 'high')

  // The write-through must still be issued against the Host: the substitution
  // only changes what is DISPLAYED. A substitution mistaken for the Host's own
  // answer would silently drop the correction.
  await settle()
  check('the substitution does not suppress the write-through to the Host',
    ctx.directoryCalls.at(-1)?.reasoningEffort === 'high')

  ctx.dispose()
}

// --- 21. an instance-own select does not dodge the rewrite -----------------
// freecodego installs `directory.select = captured.bind(directory)` as an OWN
// property while capturing whatever `select` existed at that moment. An own
// property shadows the prototype patch, so its captured method is the
// unrewritten one: unless the wrapper is rewritten in front of it, the first
// Host call goes out without a level and the correction has to chase it as a
// second selection (the flicker, and the 2-5ms `undefined → level` pair).
console.log('21. an instance-own select still carries the remembered level')
{
  globalThis.localStorage.clear()
  globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify({ [A.model]: 'high' }))
  const ctx = stubCtx({
    rows: [session('self', B)],
    groups: EFFORT_GROUPS,
    dictionaries: DICTS,
    defaultSelection: B
  })
  // Exactly freecodego's shape, installed BEFORE the plugin applies.
  const directory = ctx.modelDirectories.directoryFor('self')
  const captured = directory.select.bind(directory)
  directory.select = selection => captured(selection)

  const { exports } = await loadClient(CLIENT)
  exports.apply(ctx)
  await settle()

  ctx.setCurrent(B)
  await directory.select({ ...A })
  await settle()

  const calls = ctx.directoryCalls.filter(call => call.model === A.model)
  check('the first call already carries the remembered level',
    calls.length > 0 && calls[0].reasoningEffort === 'high')
  check('and no second call is needed to correct it', calls.length === 1)

  ctx.dispose()
}

console.log(
  failures === 0 ? '\nverify: all checks passed' : `\nverify: ${failures} check(s) FAILED`
)
process.exit(failures === 0 ? 0 : 1)