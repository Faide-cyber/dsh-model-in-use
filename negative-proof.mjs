// Negative proof for dsh-model-in-use.
//
// A check that cannot fail is not a check. Each variant below takes the SHIPPED
// lib/client.js, breaks exactly one rule by string replacement, and requires the
// fixture to notice. If a variant passes, the fixture is not biting and the
// corresponding rule in verify.mjs is decoration.
//
// The last variant is the bug this plugin actually shipped with: a <body>
// observer without `subtree` never sees the menu open inside the composer.
//
// Run: node negative-proof.mjs

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  loadClient,
  mountComposer,
  openCodexMenu,
  codexRowFor,
  clickOn,
  settle,
  stubCtx
} from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, 'lib', 'client.js')
const SOURCE = readFileSync(CLIENT, 'utf8')

const DICTS = {
  'dsh-model-in-use': {
    inUse: '其他会话正在使用中',
    expandGroup: '展开此提供商的模型',
    collapseGroup: '收起此提供商的模型'
  }
}
const GROUPS = [
  {
    id: 'deepseek-account',
    name: 'DeepSeek Account',
    models: [
      {
        id: 'v41-flash',
        name: 'DeepSeek-V41-Flash',
        description: 'tunable thinking budget',
        reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
      },
      { id: 'v4-pro', name: 'DeepSeek-V4-Pro', description: 'thinking always on · 16K default' }
    ]
  },
  {
    id: 'workbuddyai',
    name: 'WorkBuddy AI',
    models: [
      {
        id: 'hy3',
        name: 'Hy3 · x0.00',
        description: '32K context',
        reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium', name: 'Medium' }, { id: 'ultra', name: 'Ultra' }] }
      },
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

/**
 * Each variant: a unique source snippet, a replacement, the state it runs
 * against, and `probe` — how to read the DOM once that rule is broken, plus
 * `brokenValue`, what the DOM shows in that case. A variant is CAUGHT when the
 * fixture reproduces exactly that, which proves the fixture can see the rule and
 * that verify.mjs's expectation of the opposite is a real constraint rather
 * than decoration.
 */
const marked = name => codexRowFor(name)?.hasAttribute('data-dsh-model-in-use') === true
const collapsed = name =>
  codexRowFor(name)?.closest('section.codexModelSelectGroup')?.getAttribute('data-dsh-group-collapsed') ?? null
const headingFor = name =>
  codexRowFor(name)?.closest('section.codexModelSelectGroup')?.querySelector('div.codexModelSelectGroupTitle') ?? null

const EFFORT_KEY = 'dsh-model-in-use:model-efforts'
const storedEffort = model =>
  JSON.parse(globalThis.localStorage.getItem(EFFORT_KEY) ?? 'null')?.[model] ?? undefined
const dirOf = ctx => ctx.modelDirectories.directoryFor('self')

const VARIANTS = [
  {
    label: 'a running conversation stops counting (running check removed)',
    from: 'if (!row.running) continue',
    to: 'if (false) continue',
    rows: [session('self', A), session('other', B, { running: false })],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: true
  },
  {
    label: 'a subagent conversation starts counting',
    from: "if (row.origin === 'subagent' || row.parentId !== undefined) continue",
    to: 'if (false) continue',
    rows: [session('self', A), session('child', B, { origin: 'subagent' })],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: true
  },
  {
    label: 'the current conversation marks its own model',
    from: 'if (row === undefined || row.id === selfId) continue',
    to: 'if (row === undefined) continue',
    rows: [session('self', B)],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: true
  },
  {
    label: 'a session with no projection uses lastUsed instead of the live pick',
    from: 'row.projectionValues?.modelSelection?.next ?? fallback',
    to: 'row.projectionValues?.modelSelection?.lastUsed ?? fallback',
    rows: [
      session('self', A),
      {
        id: 'fresh',
        running: true,
        projectionValues: { modelSelection: { lastUsed: C, next: B } }
      }
    ],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: false
  },
  {
    label: 'the row name is read off the whole copy block (name + description)',
    from: "button.querySelector(NAME_SELECTOR)?.textContent ?? ''",
    to: "button.querySelector('span.codexModelSelectOptionCopy')?.textContent ?? ''",
    rows: [session('self', A), session('other', B)],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: false
  },
  {
    // The bug this plugin actually shipped with. The menu is rendered inside
    // the composer subtree, not portaled, so a non-subtree <body> watch never
    // sees it appear.
    label: 'the body observer loses subtree (menu opening goes unnoticed)',
    from: 'bodyObserver.observe(root, { childList: true, subtree: true })',
    to: 'bodyObserver.observe(root, { childList: true })',
    rows: [session('self', A), session('other', B)],
    probe: () => marked('Hy3 · x0.00'),
    brokenValue: false
  },
  {
    // The collapse is applied through the heading's own attributes and one CSS
    // rule. Letting the heading lose its toggle leaves the state unreadable —
    // which is what a collapse that "does nothing" looks like from outside.
    label: 'the group heading is never stamped as a toggle',
    from: "heading.setAttribute('data-dsh-group-toggle', '')",
    to: 'void 0',
    rows: [session('self', A)],
    probe: () => headingFor('Hy3 · x0.00')?.hasAttribute('data-dsh-group-toggle') === true,
    brokenValue: false
  },
  {
    label: 'the remembered collapse is written but never read back',
    from: 'applyCollapsed(section, heading, collapsed[key] === true)',
    to: 'applyCollapsed(section, heading, false)',
    rows: [session('self', A)],
    probe: () => collapsed('Hy3 · x0.00'),
    brokenValue: 'false',
    // This one is only visible after a remount with the state already stored.
    seedCollapsed: { workbuddyai: true }
  },
  {
    // The remembered key must be the provider id, not the heading's display
    // name: the name is localized (the built-in account route renders as
    // "DeepSeek 账号" in Chinese), so a text key silently forgets every collapse
    // the first time the UI language changes.
    label: 'the collapse key is the heading text instead of the provider id',
    from: 'const key = groupKeyOf(section, reactId)',
    to: 'const key = heading.textContent',
    rows: [session('self', A)],
    probe: () => collapsed('Hy3 · x0.00'),
    brokenValue: 'false',
    // Stored under the id, then rendered under a different display name — a
    // language switch, exactly.
    seedCollapsed: { workbuddyai: true },
    renameGroups: { workbuddyai: 'WorkBuddy 国内' }
  },
  {
    // The group-level dot is what keeps a running model visible once its group is
    // collapsed. Without the flag the heading has nothing to draw from, and a
    // collapsed group goes silent about the conversation running inside it.
    label: 'a group holding a running model is never flagged',
    from: "if (anyInUse) section.setAttribute('data-dsh-group-in-use', 'true')",
    to: "if (false) section.setAttribute('data-dsh-group-in-use', 'true')",
    rows: [session('self', A), session('other', B)],
    probe: () =>
      codexRowFor('Hy3 · x0.00')
        ?.closest('section.codexModelSelectGroup')
        ?.getAttribute('data-dsh-group-in-use') ?? null,
    brokenValue: null
  },
  {
    // ...and the flag must be cleared again, or a group keeps advertising a
    // conversation that has already stopped.
    label: 'the group flag is never cleared when the model stops running',
    from: "else section.removeAttribute('data-dsh-group-in-use')",
    to: 'else void 0',
    rows: [session('self', A), session('other', B)],
    // The sibling stops running before the probe: the flag must go with it.
    thenRows: [session('self', A), session('other', B, { running: false })],
    probe: () =>
      codexRowFor('Hy3 · x0.00')
        ?.closest('section.codexModelSelectGroup')
        ?.getAttribute('data-dsh-group-in-use') ?? null,
    brokenValue: 'true'
  },
  {
    // The regression the user actually reported, after the first fix shipped:
    // relative colour syntax INHERITS the origin colour's alpha when the alpha
    // channel is omitted, so `rgb(from … r g b)` is still translucent and the
    // sticky heading keeps bleeding the scrolled row text through it. The `/ 1`
    // is the entire fix, and dropping it is a one-character edit that no DOM
    // assertion can see — so the probe reads the injected stylesheet itself.
    label: 'the sticky heading drops the pinned alpha (text bleeds through again)',
    // Anchored on the CSS declaration line, not the bare `r g b / 1)`: that
    // fragment also appears in the explanatory comment above it, and the
    // ambiguity guard below would (correctly) refuse to run.
    from: "'background:rgb(from var(--dsw-alias-bg-layer-2,#2c2c2e) r g b / 1)'",
    to: "'background:rgb(from var(--dsw-alias-bg-layer-2,#2c2c2e) r g b)'",
    rows: [session('self', A)],
    probe: () => {
      const css = globalThis.document.head.children[0]?.textContent ?? ''
      return /background:rgb\(from var\(--dsw-alias-bg-layer-2[^)]*\)\s*r g b \/ 1\)/.test(css)
    },
    brokenValue: false
  },
  {
    // The service-level half: a restated effort must be recorded, or the
    // model-switch restore in the same hook would never have anything to work
    // from.
    label: 'an effort restatement is never written down',
    from: 'if (efforts[key] !== selection.reasoningEffort) {',
    to: 'if (false) {',
    rows: [session('self', A)],
    drive: async ctx => {
      ctx.setCurrent({ ...A, reasoningEffort: 'low' })
      await dirOf(ctx).select({ ...A, reasoningEffort: 'high' })
    },
    probe: ctx => storedEffort(A.model),
    brokenValue: undefined
  },
  {
    // The discriminator that took the longest to get right. `chooseEffort`
    // always sends the CURRENT model, so a level picked on the model already in
    // use is a same-model selection — exactly like the "provider default" entry
    // next to it. The only thing telling them apart is the level itself, so if
    // the edit test is dropped, that pick stops being recorded and the memory
    // never exists for the later switch to restore.
    label: 'a same-model level choice is not treated as an edit',
    from: "const isEdit = typeof selection.reasoningEffort === 'string' &&",
    to: 'const isEdit = false &&',
    rows: [session('self', A)],
    drive: async ctx => {
      ctx.setCurrent({ ...A, reasoningEffort: 'low' })
      await dirOf(ctx).select({ ...A, reasoningEffort: 'high' })
    },
    probe: ctx => storedEffort(A.model),
    brokenValue: undefined
  },
  {
    label: 'a remembered effort is never restored on a model switch',
    from: 'selection = { ...selection, reasoningEffort: remembered }',
    to: 'void 0',
    seedEfforts: { 'v41-flash': 'high' },
    rows: [session('self', A)],
    drive: async ctx => {
      ctx.setCurrent({ ...B, reasoningEffort: 'medium' })
      await dirOf(ctx).select({ ...A, reasoningEffort: 'low' })
    },
    probe: ctx => ctx.directoryCalls[0]?.reasoningEffort,
    brokenValue: 'low'
  },
  {
    // ModelDirectory exposes the pending target before its durable projection
    // settles; ignoring it misclassifies a quick A→B→A click as same-model.
    label: 'a pending target is ignored during a quick A→B→A switch',
    from: 'const current = snapshot.pending ?? snapshot.current',
    to: 'const current = snapshot.current',
    seedEfforts: { 'v41-flash': 'high' },
    rows: [session('self', A)],
    drive: async ctx => {
      const directory = dirOf(ctx)
      ctx.setCurrent({ ...A, reasoningEffort: 'low' })
      directory.store.getSnapshot().pending = { ...B }
      await directory.select({ ...A, reasoningEffort: 'low' })
    },
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: 'low'
  },
  {
    // The target starts on the official default, but model-bound memory should
    // override that default before the selection reaches the Host.
    label: 'a fresh session ignores its model-bound effort memory',
    from: "if (typeof remembered !== 'string' || !supported(directory.catalog, current, remembered)) return",
    to: 'return',
    seedEfforts: { 'v41-flash': 'high' },
    rows: [session('new-session', A)],
    drive: async ctx => {
      const fresh = ctx.modelDirectories.directoryFor('new-session')
      ctx.setCurrent({ ...A, reasoningEffort: 'low' }, 'new-session')
      await fresh.select({ ...A, reasoningEffort: 'low' })
    },
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: 'low'
  },
  {
    label: 'a session scope that becomes ready after its list notification misses the resolver hook',
    from: "          hookSelect(directory)\n          return directory",
    to: "          return directory",
    seedEfforts: { 'hy3': 'ultra' },
    rows: [],
    blockedSessions: ['new-session'],
    drive: async ctx => {
      ctx.setRows([session('new-session', A)])
      await settle()
      ctx.unblockDirectory('new-session')
      const fresh = ctx.modelDirectories.directoryFor('new-session')
      ctx.setCurrent({ ...A, reasoningEffort: 'low' }, 'new-session')
      await fresh.select({ ...B, reasoningEffort: 'medium' })
    },
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: 'medium'
  },
  {
    label: 'existing durable selections never seed missing model effort memory',
    from: '          if (changed) writeEfforts(efforts)',
    to: '          void changed',
    rows: [session('self', { ...B, reasoningEffort: 'ultra' })],
    probe: () => storedEffort(B.model),
    brokenValue: undefined
  },
  {
    // Seeding from durable projections is a one-time catch-up per session, not
    // a continuous mirror: once a session has been looked at, a later projection
    // change must not write a fresh binding behind the user's back.
    label: 'a session seeds its model-bound effort more than once',
    from: '            if (learnedSessions.has(id)) continue',
    to: '            if (false) continue',
    rows: [session('self', { ...A, reasoningEffort: 'high' })],
    drive: async ctx => {
      ctx.setRows([session('self', { ...A, reasoningEffort: 'high' })])
      await settle()
      // The same session now reports a different model, unbound so far.
      ctx.setRows([session('self', { ...B, reasoningEffort: 'ultra' })])
      await settle()
    },
    probe: () => storedEffort(B.model),
    brokenValue: 'ultra'
  },
  {
    label: 'an unsupported remembered level is restored without the support check',
    from: 'supported(host.catalog, selection, remembered)',
    to: 'true',
    seedEfforts: { 'v41-flash': 'ultra' },
    rows: [session('self', A)],
    drive: async ctx => {
      ctx.setCurrent({ ...B, reasoningEffort: 'medium' })
      await dirOf(ctx).select({ ...A, reasoningEffort: 'low' })
    },
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: 'ultra'
  },
  {
    label: 'a blank directory cached before apply is omitted from effort reconciliation',
    from: '          for (const directory of modelDirectories.live?.directories?.values ?? []) hookSelect(directory)',
    to: '          void modelDirectories.live',
    seedEfforts: { 'v41-flash': 'high' },
    rows: [],
    residentDirectories: [{ id: 'blank', current: { ...A, reasoningEffort: 'low' } }],
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: undefined
  },
  {
    // A correction the host did not take comes back through the store
    // notification. Without the once-per-target guard the same select is
    // re-issued on every notification — an unbounded RPC loop against a host
    // that already refused that level.
    label: 'a rejected correction is re-issued on every notification',
    from: '            if (attemptedReconciles.get(directory) === attemptKey) return',
    to: '            if (false) return',
    seedEfforts: { 'v41-flash': 'high' },
    rows: [],
    residentDirectories: [{ id: 'blank', current: { ...A, reasoningEffort: 'low' } }],
    drive: async ctx => {
      // Put the directory back on the default it refused to leave, as a failed
      // select would: the store notifies, and reconciliation runs again.
      ctx.setCurrent({ ...A, reasoningEffort: 'low' }, 'blank')
      await settle()
    },
    probe: ctx => ctx.directoryCalls.length,
    brokenValue: 2
  },
  {
    // The bug this revision fixed. One model is reachable under several provider
    // ids (`workbuddyai` / `workbuddyai-cn` both serve deepseek-v4.1-flash), and
    // the binding must survive that id change. A provider-qualified key writes
    // the level under one id and reads it back under the other as a miss.
    label: 'the effort binding is read back qualified by provider id',
    from: '              const remembered = rememberedEffort(selection.model)',
    to: '                  const remembered = rememberedEffort(`${selection.provider}[SEP]${selection.model}`)'.replace('[SEP]', '\\u0000'),
    groups: [
      {
        id: 'workbuddyai',
        name: 'WorkBuddy AI',
        models: [{
          id: 'deepseek-v4.1-flash',
          name: 'F',
          reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
        }]
      },
      {
        id: 'workbuddyai-cn',
        name: 'WorkBuddy AI CN',
        models: [{
          id: 'deepseek-v4.1-flash',
          name: 'F',
          reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }
        }]
      }
    ],
    rows: [session('self', { provider: 'workbuddyai', model: 'deepseek-v4.1-flash' })],
    drive: async ctx => {
      const directory = dirOf(ctx)
      const GLOBAL = { provider: 'workbuddyai', model: 'deepseek-v4.1-flash' }
      const CN = { provider: 'workbuddyai-cn', model: 'deepseek-v4.1-flash' }
      ctx.setCurrent({ ...GLOBAL, reasoningEffort: 'low' })
      await directory.select({ ...GLOBAL, reasoningEffort: 'high' })
      // Same model, other provider id: the bound level must come back.
      ctx.setCurrent({ ...CN, reasoningEffort: 'low' })
      await directory.select({ ...GLOBAL, reasoningEffort: 'low' })
    },
    probe: ctx => ctx.directoryCalls.at(-1)?.reasoningEffort,
    brokenValue: 'low'
  },
  {
    // The read-side substitution is what makes the label correct on the FIRST
    // paint. Demoted to a microtask (the shape the plugin had before), the
    // directory's `current` still holds the provider default when the picker
    // renders, so the composer paints "Low" and jumps to "High" once the Host
    // answers. The stubborn directory never lets the Host answer, freezing that
    // first paint so the fixture can observe it.
    label: 'the remembered level is not substituted before the first paint',
    from: '          substituteEffort(directory)\n          queueMicrotask(() => reconcileDirectory(directory))',
    to: '          queueMicrotask(() => reconcileDirectory(directory))',
    rows: [],
    seedEfforts: { 'v41-flash': 'high' },
    residentDirectories: [{ id: 'blank', current: { ...A, reasoningEffort: 'low' } }],
    stubbornSessions: ['blank'],
    probe: ctx => ctx.modelDirectories.directoryFor('blank').store.getSnapshot().current?.reasoningEffort,
    brokenValue: 'low'
  },
  {
    // The substitution writes the remembered level into `current`, so
    // reconciliation must read the Host's UNTOUCHED answer instead. Reading the
    // store back makes the correction look already applied and silently drops the
    // write-through — the composer would show a level the Host never accepted.
    label: 'the write-through reads back its own substitution and is suppressed',
    from: '            const current = projectedSelections.get(directory) ?? directory.store.getSnapshot().current',
    to: '            const current = directory.store.getSnapshot().current',
    rows: [],
    seedEfforts: { 'v41-flash': 'high' },
    residentDirectories: [{ id: 'blank', current: { ...A, reasoningEffort: 'low' } }],
    probe: ctx => ctx.directoryCalls.some(call => call.reasoningEffort === 'high'),
    brokenValue: false
  },
  {
    // freecodego installs an OWN `select` (bound to whatever method existed at
    // that moment), which shadows the prototype patch. Without wrapping that
    // instance method too, the first Host call goes out with no level and the
    // correction chases it as a second selection — the flicker the user sees,
    // and the 2-5ms `undefined → level` pair in the session event log.
    label: 'an instance-own select bypasses the remembered-level rewrite',
    beforeApply: ctx => {
      const directory = ctx.modelDirectories.directoryFor('self')
      const captured = directory.select.bind(directory)
      directory.select = selection => captured(selection)
    },
    from: "          if (!Object.hasOwn(directory, 'select')) return",
    to: '          if (true) return',
    rows: [session('self', B)],
    seedEfforts: { 'v41-flash': 'high' },
    drive: async ctx => {
      ctx.setCurrent(B)
      await ctx.modelDirectories.directoryFor('self').select({ ...A })
      await settle()
    },
    probe: ctx => ctx.directoryCalls.find(call => call.model === A.model)?.reasoningEffort,
    brokenValue: undefined
  },
  {
    label: 'the hover anchor looks beside itself inside the Slot instead of beside the Slot wrapper',
    from: "const slot = anchor.current?.closest?.('[data-slot=\"sidebar.session.row.hover\"]')",
    to: 'const slot = anchor.current',
    rows: [session('self', A)],
    probe: ctx => String(ctx.slotEntries.find(entry => entry.options.name === 'sidebar.session.row.hover')?.component)
      .includes("closest?.('[data-slot=\"sidebar.session.row.hover\"]')"),
    brokenValue: false
  }
]

let failures = 0

for (const [index, variant] of VARIANTS.entries()) {
  if (!SOURCE.includes(variant.from)) {
    failures += 1
    console.log(`FAIL  variant ${index + 1}: fixture is stale — source no longer contains:`)
    console.log(`        ${variant.from}`)
    continue
  }

  // `String.replace` rewrites only the FIRST occurrence, so a `from` string that
  // also appears inside a comment silently produces a build where the real code
  // is untouched — and the variant then "passes" while testing nothing. That is
  // a fixture bug, not a caught rule, so it fails loudly instead.
  const occurrences = SOURCE.split(variant.from).length - 1
  if (occurrences !== 1) {
    failures += 1
    console.log(`FAIL  variant ${index + 1}: ambiguous anchor — ${occurrences} occurrences of:`)
    console.log(`        ${variant.from}`)
    console.log('        narrow the anchor so the replacement hits the code, not a comment')
    continue
  }

  const broken = SOURCE.replace(variant.from, variant.to)
  const tempPath = join(here, `.negative-proof-${index}.mjs`)
  writeFileSync(tempPath, broken)

  try {
    // A fresh storage per variant, pre-seeded where the variant needs it.
    globalThis.localStorage.clear()
    if (variant.seedCollapsed !== undefined) {
      globalThis.localStorage.setItem(
        'dsh-model-in-use:collapsed-groups',
        JSON.stringify(variant.seedCollapsed)
      )
    }
    if (variant.seedEfforts !== undefined) {
      globalThis.localStorage.setItem(EFFORT_KEY, JSON.stringify(variant.seedEfforts))
    }
    const groups = variant.groups ?? (variant.renameGroups === undefined
      ? GROUPS
      : GROUPS.map(group =>
          variant.renameGroups[group.id] === undefined
            ? group
            : { ...group, name: variant.renameGroups[group.id] }
        ))

    const ctx = stubCtx({
      rows: variant.rows,
      groups,
      dictionaries: DICTS,
      blockedSessions: variant.blockedSessions,
      residentDirectories: variant.residentDirectories,
      stubbornSessions: variant.stubbornSessions
    })
    const { exports } = await loadClient(tempPath)

    // Some rules only matter for state that already exists when the plugin
    // activates (an own `select` installed by another plugin has to be there
    // BEFORE the prototype patch, or it would capture the patched method).
    if (variant.beforeApply !== undefined) variant.beforeApply(ctx)

    // The app's real sequence: the conversation (and its composer) exists
    // first, the plugin activates, and only then does the user open the menu.
    // Opening it inserts descendants deep in the composer — never a new <body>
    // child — so variant 6 cannot pass by accident.
    mountComposer({ menuId: 'r1-menu' })
    exports.apply(ctx)
    openCodexMenu(groups, { menuId: 'r1-menu' })
    await settle()

    // Some rules only show up on a *transition* (a flag that must be cleared),
    // so those variants get a second state before the probe runs. Service-level
    // rules are driven directly through the directory's select().
    if (variant.drive !== undefined) await variant.drive(ctx)
    if (variant.thenRows !== undefined) {
      ctx.setRows(variant.thenRows)
      await settle()
    }

    const observed = variant.probe(ctx)
    if (observed === variant.brokenValue) {
      console.log(`  ok  variant ${index + 1}: caught — ${variant.label}`)
    } else {
      failures += 1
      console.log(`FAIL  variant ${index + 1}: NOT caught — ${variant.label}`)
      console.log(`        expected ${JSON.stringify(variant.brokenValue)}, got ${JSON.stringify(observed)}`)
    }

    ctx.dispose()
  } finally {
    unlinkSync(tempPath)
  }
}

console.log(
  failures === 0
    ? `\nnegative-proof: all ${VARIANTS.length} broken variants were caught`
    : `\nnegative-proof: ${failures} variant(s) NOT caught`
)
process.exit(failures === 0 ? 0 : 1)
