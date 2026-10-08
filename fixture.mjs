// dsh-model-in-use — test fixture.
//
// A DOM good enough to run the shipped `lib/client.js` under Node, built only
// from what that file actually touches. The selector engine understands a tag
// plus `[attr]`, `[attr="v"]` and `[attr$="v"]`, and THROWS on anything else —
// so if the plugin ever starts querying something this fixture cannot express,
// the test fails loudly instead of silently matching nothing.

/** One element node. `text` is the node's own text; textContent is recursive. */
export function el(tag, attrs = {}, children = []) {
  const node = {
    tag,
    attrs: { ...attrs },
    children: [],
    parent: null,
    text: attrs.__text ?? ''
  }
  delete node.attrs.__text
  for (const child of children) {
    child.parent = node
    node.children.push(child)
  }
  Object.defineProperty(node, 'textContent', {
    get() {
      return this.text + this.children.map(child => child.textContent).join('')
    },
    set(value) {
      this.text = String(value)
      this.children = []
    }
  })
  Object.defineProperty(node, 'firstElementChild', {
    get() {
      return this.children[0] ?? null
    }
  })
  Object.defineProperty(node, 'title', {
    get() {
      return this.attrs.title ?? ''
    },
    set(value) {
      this.attrs.title = value
    }
  })
  Object.defineProperty(node, 'id', {
    get() {
      return this.attrs.id ?? ''
    },
    set(value) {
      this.attrs.id = String(value)
    }
  })
  // `dataset.conversationSession` <-> `data-conversation-session`.
  Object.defineProperty(node, 'dataset', {
    get() {
      const attrs = node.attrs
      return new Proxy(
        {},
        {
          get: (_target, name) => attrs[`data-${String(name).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`],
          set: (_target, name, value) => {
            attrs[`data-${String(name).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`] = String(value)
            return true
          },
          has: (_target, name) =>
            `data-${String(name).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}` in attrs
        }
      )
    }
  })
  node.getAttribute = name => (name in node.attrs ? node.attrs[name] : null)
  // `className` / `classList` over the single `class` attribute, split on runs
  // of whitespace, which is what the class selectors above test against.
  const classesOf = () => String(node.attrs.class ?? '').split(/\s+/).filter(Boolean)
  Object.defineProperty(node, 'className', {
    get() {
      return node.attrs.class ?? ''
    },
    set(value) {
      node.attrs.class = String(value)
    }
  })
  Object.defineProperty(node, 'classList', {
    get() {
      return {
        contains: name => classesOf().includes(name),
        add: name => {
          if (!classesOf().includes(name)) node.attrs.class = [...classesOf(), name].join(' ')
        },
        remove: name => {
          node.attrs.class = classesOf()
            .filter(current => current !== name)
            .join(' ')
        }
      }
    }
  })

  node.setAttribute = (name, value) => {
    node.attrs[name] = String(value)
  }
  node.removeAttribute = name => {
    delete node.attrs[name]
  }
  node.hasAttribute = name => name in node.attrs
  node.nodeType = 1
  node.matches = selector => compile(selector)(node)
  node.closest = selector => {
    const match = compile(selector)
    for (let cursor = node; cursor !== null; cursor = cursor.parent) {
      if (match(cursor)) return cursor
    }
    return null
  }
  node.querySelectorAll = selector => {
    const match = compile(selector)
    const found = []
    const walk = current => {
      for (const child of current.children) {
        if (match(child)) found.push(child)
        walk(child)
      }
    }
    walk(node)
    return found
  }
  node.querySelector = selector => node.querySelectorAll(selector)[0] ?? null
  node.append = (...nodes) => {
    for (const child of nodes) {
      child.parent = node
      node.children.push(child)
      FixtureMutationObserver.notify(node, [child], [])
    }
  }
  node.remove = () => {
    const parent = node.parent
    if (parent === null) return
    parent.children = parent.children.filter(child => child !== node)
    node.parent = null
    FixtureMutationObserver.notify(parent, [], [node])
  }
  return node
}

/**
 * Compile the tiny selector subset this fixture supports; throw on the rest.
 * A simple selector is a tag, any number of `.class` names and any number of
 * `[attr]` / `[attr="v"]` / `[attr$="v"]` / `[attr^="v"]` tests, in that order.
 * Anything more (descendant combinators, `:pseudo`, `>`…) throws, so the plugin
 * can never quietly query something this fixture would have matched as empty.
 */
function compile(selector) {
  const source = String(selector).trim()
  const match = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(source)
  if (match === null) throw new Error(`fixture: unsupported selector "${source}"`)
  const [, tag, classSource, attrSource] = match
  if (tag === undefined && classSource === '' && attrSource === '') {
    throw new Error(`fixture: empty selector "${source}"`)
  }
  const classes = [...classSource.matchAll(/\.([\w-]+)/g)].map(([, name]) => name)
  const tests = []
  for (const [, name, operator, value] of attrSource.matchAll(/\[([\w-]+)(?:([$^]?=)"([^"]*)")?\]/g)) {
    if (operator === undefined) tests.push(node => node.hasAttribute(name))
    else if (operator === '$=') tests.push(node => (node.getAttribute(name) ?? '').endsWith(value))
    else if (operator === '^=') tests.push(node => (node.getAttribute(name) ?? '').startsWith(value))
    else tests.push(node => node.getAttribute(name) === value)
  }
  if (attrSource !== '' && tests.length === 0) throw new Error(`fixture: unsupported selector "${source}"`)
  return node =>
    (tag === undefined || node.tag === tag) &&
    classes.every(name => node.classList.contains(name)) &&
    tests.every(test => test(node))
}

/**
 * Minimal MutationObserver that HONOURS `options`.
 *
 * This matters more than it looks: the plugin's whole liveness story hangs on
 * an observer that watches <body> for a menu appearing deep inside the composer
 * subtree. An observer that ignored `subtree` and fired every callback on
 * demand would make a `{childList:true}` body observer look correct — a green
 * check that could never go red, which is exactly the bug this fixture missed.
 * So: `notify()` delivers a record only to observers whose watched node is the
 * mutation target, or (with `subtree`) one of its ancestors.
 */
class FixtureMutationObserver {
  static live = []
  /** Bumped per `loadClient`, to defeat Node's ES module cache. */
  static loads = 0

  constructor(callback) {
    this.callback = callback
    this.connected = true
    FixtureMutationObserver.live.push(this)
  }

  observe(node, options = {}) {
    this.node = node
    this.options = { childList: options.childList === true, subtree: options.subtree === true }
    // A real MutationObserver is reusable: disconnect() stops delivery but
    // observe() can start it again. The plugin relies on that (it disconnects
    // before re-observing when the root changes), so re-register here.
    this.connected = true
    if (!FixtureMutationObserver.live.includes(this)) FixtureMutationObserver.live.push(this)
  }

  disconnect() {
    this.connected = false
    FixtureMutationObserver.live = FixtureMutationObserver.live.filter(other => other !== this)
  }

  /** Deliver one childList record to every observer that would really see it. */
  static notify(target, addedNodes, removedNodes) {
    for (const observer of [...FixtureMutationObserver.live]) {
      if (!observer.connected) continue
      const watched = observer.node
      if (watched === undefined) continue
      const inScope =
        watched === target || (observer.options.subtree === true && isDescendant(target, watched))
      if (!inScope) continue
      observer.callback([{ type: 'childList', target, addedNodes, removedNodes }], observer)
    }
  }

  static reset() {
    FixtureMutationObserver.live = []
  }
}

/** Is `node` inside `ancestor`'s subtree? */
function isDescendant(node, ancestor) {
  for (let cursor = node.parent; cursor !== null; cursor = cursor.parent) {
    if (cursor === ancestor) return true
  }
  return false
}

/** A Storage good enough for one key, with a working clear() for test resets. */
function createStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => {
      map.set(String(key), String(value))
    },
    removeItem: key => {
      map.delete(String(key))
    },
    clear: () => map.clear()
  }
}

// A real Storage, installed once per process. The collapse memory is the one
// thing the plugin is expected to carry ACROSS a remount, so it must outlive
// `loadClient` — that is the whole point of the persistence check.
globalThis.localStorage ??= createStorage()

/**
 * Dispatch a bubbling event at `target` through the document-level listeners the
 * plugin installed in capture phase.
 *
 * The real plugin listens on `document` with `capture: true`, so it sees the
 * event before the menu's own handlers. The fixture delivers to document
 * listeners directly, which is the same observation point — and `stopPropagation`
 * is a no-op here because the fixture has no other phase to stop.
 */
export function dispatchAt(target, event) {
  const full = {
    ...event,
    target,
    preventDefault: () => {},
    stopPropagation: () => {}
  }
  globalThis.document.dispatchEvent(full)
}

/** A click on `target`, as the menu's own handler would receive it. */
export const clickOn = target => dispatchAt(target, { type: 'click' })

/** A keypress on `target` with `key`. */
export const keyOn = (target, key) => dispatchAt(target, { type: 'keydown', key })

/**
 * Install the browser globals `lib/client.js` expects and return the module
 * exports it registers. Loads the shipped file verbatim — no rewriting.
 * @param clientPath - absolute path of lib/client.js.
 */
export async function loadClient(clientPath) {
  FixtureMutationObserver.reset()
  let captured
  globalThis.window = {
    __ModuleLoader__: {
      load: registration => {
        captured = registration
      }
    }
  }
  globalThis.MutationObserver = FixtureMutationObserver
  // A fresh document-level event registry per load: the plugin's capture-phase
  // click/keydown listeners are installed by `apply` and removed by dispose, and
  // each scenario must start from none of them.
  const listeners = []
  globalThis.document = {
    body: el('body'),
    head: el('head'),
    createElement: tag => el(tag),
    querySelectorAll: selector => globalThis.document.body.querySelectorAll(selector),
    addEventListener: (type, handler) => {
      listeners.push({ type, handler })
    },
    removeEventListener: (type, handler) => {
      const at = listeners.findIndex(entry => entry.type === type && entry.handler === handler)
      if (at >= 0) listeners.splice(at, 1)
    },
    dispatchEvent: event => {
      for (const entry of [...listeners]) {
        if (entry.type === event.type) entry.handler(event)
      }
    }
  }
  globalThis.document.body.querySelectorAll = globalThis.document.body.querySelectorAll.bind(
    globalThis.document.body
  )

  const { pathToFileURL } = await import('node:url')
  // Node caches ES module imports by URL, so loading the same client twice
  // would skip the module body and never register again. A unique query keeps
  // each load a fresh evaluation, which is what every scenario needs.
  const url = pathToFileURL(clientPath).href
  await import(`${url}?load=${FixtureMutationObserver.loads}`)
  FixtureMutationObserver.loads += 1
  if (captured === undefined) throw new Error('fixture: client.js did not register with __ModuleLoader__')
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props ?? {}), ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) }
    }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: initial => ({ current: initial }),
    useState: initial => [initial, () => {}],
    useLayoutEffect: () => {}
  }
  const ReactDOM = { createPortal: (children, container) => ({ children, container }) }
  const exports = captured.factory(id => {
    if (id === 'react') return React
    if (id === 'react-dom') return ReactDOM
    throw new Error(`fixture: unsupported client require "${id}"`)
  })
  return { exports, observer: FixtureMutationObserver }
}

/**
 * A stub Cordis context exposing only the faces the plugin uses.
 * @param options - session rows, catalog groups, and the bound dictionaries.
 */
export function stubCtx({ rows, groups, dictionaries, defaultSelection = { provider: 'p', model: 'm' }, blockedSessions = [], residentDirectories = [], stubbornSessions = [] }) {
  const listListeners = new Set()
  const catalogListeners = new Set()
  let listSnapshot = { ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])) }
  let catalogSnapshot = { value: { default: defaultSelection, groups }, status: 'ready', error: null }
  const disposers = []
  const slotEntries = []

  // A stub per-session model directory, shaped like the real
  // ModelDirectory: `select` lives on a prototype shared by every directory
  // (which is what the plugin's effort hook keys on), the store exposes the
  // live `current` selection, and the catalog answers `reasoningFor`.
  const directoryCalls = []
  const directories = new Map()
  const blockedDirectories = new Set(blockedSessions)
  const stubbornDirectories = new WeakSet()
  const directoryProto = {
    select(selection) {
      // Mirror ModelDirectory.select(): the target is published as `pending`
      // before the Host settles, and the store notifies at that point.
      directoryCalls.push(selection)
      this.store.set({ ...this.store.getSnapshot(), status: 'selecting', pending: selection })
      // A "stubborn" session models a Host round trip that never settles, so a
      // directory's `current` stays exactly what the plugin last wrote.
      if (!stubbornDirectories.has(this)) this.setCurrent(selection)
      return { ok: true, value: undefined }
    }
  }
  const reasoningFor = selection => {
    const group = (catalogSnapshot.value?.groups ?? []).find(g => g.id === selection.provider)
    const model = group?.models?.find(m => m.id === selection.model)
    return model?.reasoning ?? undefined
  }
  const makeDirectory = sessionId => {
    const directory = Object.create(directoryProto)
    // The real store has seven keys, not one. `pending` is what a select()
    // publishes before the Host projection settles, and anything that reads the
    // effective current selection has to go through it.
    let snapshot = {
      current: { ...defaultSelection },
      routable: null,
      groups: [],
      failures: [],
      status: 'ready',
      pending: null,
      error: null
    }
    const listeners = new Set()
    directory.sessionId = sessionId
    directory.listeners = listeners
    if (stubbornSessions.includes(sessionId)) stubbornDirectories.add(directory)
    directory.store = {
      getSnapshot: () => snapshot,
      // The real store is a whole-value set: it REPLACES the state object and
      // notifies synchronously. Identity matters, because that is what makes a
      // substituted value look like a settled one to any reader.
      set: next => {
        snapshot = { ...next }
        for (const listener of listeners) listener()
      },
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    directory.setCurrent = next => {
      // A settled projection supersedes any in-flight target.
      snapshot = { ...snapshot, current: next, pending: null, status: 'ready' }
      for (const listener of listeners) listener()
    }
    directory.catalog = { reasoningFor }
    return directory
  }
  const modelDirectoriesOrigin = {
    live: {
      directories: {
        get values() { return directories.values() }
      }
    },
    catalog: {
      reasoningFor,
      store: {
        getSnapshot: () => catalogSnapshot,
        subscribe: listener => {
          catalogListeners.add(listener)
          return () => catalogListeners.delete(listener)
        }
      }
    },
    directoryFor: sessionId => {
      if (blockedDirectories.has(sessionId)) throw new Error(`fixture: session "${sessionId}" scope is not ready`)
      let directory = directories.get(sessionId)
      if (directory === undefined) {
        directory = makeDirectory(sessionId)
        directories.set(sessionId, directory)
      }
      return directory
    }
  }
  for (const resident of residentDirectories) {
    const sessionId = resident.sessionId ?? resident.id
    const directory = makeDirectory(sessionId)
    if (resident.current !== undefined) directory.setCurrent(resident.current)
    directories.set(sessionId, directory)
  }
  // Cordis exposes Services through a traceable face. String writes land on a
  // short-lived shadow and disappear; the origin symbol is the supported escape
  // hatch used when a plugin must decorate the actual service implementation.
  const modelDirectoriesFace = new Proxy(modelDirectoriesOrigin, {
    get: (target, property, receiver) => property === Symbol.for('cordis.original')
      ? target
      : Reflect.get(target, property, receiver),
    set: (target, property, value, receiver) => typeof property === 'string'
      ? true
      : Reflect.set(target, property, value, receiver)
  })

  const ctx = {
    effect: (fn, _name) => {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    inject: (_names, callback) => callback(ctx),
    locale: {
      register: () => () => {},
      bind: namespace => key => {
        const dict = dictionaries[namespace]
        if (dict === undefined) throw new Error(`fixture: no dictionary for namespace "${namespace}"`)
        if (!(key in dict)) throw new Error(`fixture: missing key "${namespace}:${key}"`)
        return dict[key]
      }
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        const entry = { options, component }
        slotEntries.push(entry)
        return () => {
          const at = slotEntries.indexOf(entry)
          if (at >= 0) slotEntries.splice(at, 1)
        }
      }
    },
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe: listener => {
          listListeners.add(listener)
          return () => listListeners.delete(listener)
        }
      }
    },
    modelDirectories: modelDirectoriesFace,
    /** Move a directory's live selection, as a real select() settlement would. */
    setCurrent: (next, sessionId = 'self') => { directories.get(sessionId)?.setCurrent(next) },
    /** Every selection the directories' select() received, in order. */
    get directoryCalls() { return directoryCalls },
    get slotEntries() { return slotEntries },
    directoryProto,
    /** Make a session scope resolvable without emitting another list change. */
    unblockDirectory: sessionId => { blockedDirectories.delete(sessionId) },
    /** Replace the session snapshot and notify, as a real status change would. */
    setRows: next => {
      listSnapshot = { ids: next.map(row => row.id), byId: Object.fromEntries(next.map(row => [row.id, row])) }
      for (const listener of listListeners) listener()
    },
    /** Replace the catalog snapshot and notify. */
    setGroups: next => {
      catalogSnapshot = { ...catalogSnapshot, value: { ...catalogSnapshot.value, groups: next } }
      for (const listener of catalogListeners) listener()
    },
    dispose: () => {
      for (const disposer of disposers) disposer()
    }
  }
  return ctx
}

/** Drain the microtask queue the plugin schedules its re-sync on. */
export const settle = () => new Promise(resolve => setTimeout(resolve, 0))

// ---------------------------------------------------------------------------
// The CodexModelSelect DOM, shared by every script so the shape cannot drift.
// ---------------------------------------------------------------------------

/** One row, exactly as dsh-codex-subscription's `option()` factory builds it. */
export function codexOption(name, description) {
  const copy = el('span', { class: 'codexModelSelectOptionCopy' }, [
    el('span', { class: 'codexModelSelectOptionName', __text: name })
  ])
  if (description !== undefined) {
    copy.append(el('span', { class: 'codexModelSelectOptionDescription', __text: description }))
  }
  return el(
    'button',
    { type: 'button', role: 'menuitemradio', 'aria-checked': 'false', class: 'codexModelSelectOption' },
    [copy, el('span', { class: 'codexModelSelectCheck' })]
  )
}

/**
 * One group section, exactly as dsh-codex-subscription builds it: the raw
 * `group.name` title plus one row per model, with the section labelled by the
 * heading it contains.
 *
 * `aria-labelledby` is `${reactId}-${group.id}` and the heading's id is the same
 * string — that is the only place the provider id survives in the DOM (the
 * heading's *text* is the provider's display name, which this plugin must not
 * key its remembered collapse state on, or a language switch would forget it).
 * @param group - catalog-shaped group.
 * @param reactId - the React `useId()` prefix; the menu's id is `${reactId}-menu`.
 */
export function codexGroupSection(group, reactId = 'r1') {
  const titleId = `${reactId}-${group.id}`
  return el('section', { class: 'codexModelSelectGroup', role: 'group', 'aria-labelledby': titleId }, [
    el('div', { class: 'codexModelSelectGroupTitle', id: titleId, __text: group.name }),
    ...group.models.map(model => codexOption(model.name, model.description))
  ])
}

/**
 * Mount the composer with the model menu CLOSED.
 *
 * This is the state the app is in while the user chats: the conversation's
 * element exists, the trigger exists, the menu does not. Adding this element to
 * <body> is a body childList mutation — it happens once, when the conversation
 * loads, long before any menu opens.
 */
export function mountComposer({ menuId = 'r1-menu', sessionId = 'self' } = {}) {
  const body = globalThis.document.body
  body.children = []
  const composerBar = el('div', { class: 'composerBar' }, [
    el('button', {
      type: 'button',
      class: 'codexModelSelectTrigger',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': menuId
    })
  ])
  body.append(
    el('div', { 'data-conversation-session': sessionId }, [
      el('div', { class: 'conversationBody' }, [
        el('div', { class: 'composerSeat' }, [composerBar])
      ])
    ])
  )
  return composerBar
}

/**
 * Open the menu by inserting it into the ALREADY MOUNTED composer.
 *
 * The nesting is the whole point. CodexModelSelect is the `conversation.input
 * .model` slot's content, so its menu lands deep inside the composer subtree —
 * it is not portaled to <body>. Opening it therefore adds descendants without
 * changing <body>'s direct children, and a `{childList:true}`-only body
 * observer never sees it. A fixture that instead appends a fresh session div to
 * <body> would hand that broken observer a body mutation and let it pass.
 *
 * @param groups - catalog-shaped groups, rendered top to bottom.
 * @param menuId - the id the trigger's `aria-controls` points at.
 * @param composerBar - where to insert; defaults to the last mounted composer.
 */
export function openCodexMenu(groups, { menuId = 'r1-menu', composerBar } = {}) {
  const host =
    composerBar ??
    globalThis.document.body.querySelector('div.composerBar')
  if (host === null || host === undefined) {
    throw new Error('fixture: openCodexMenu needs a mounted composer (call mountComposer first)')
  }
  const reactId = menuId.replace(/-menu$/, '')
  host.append(
    el('div', { class: 'codexModelSelectMenu', id: menuId, role: 'menu' }, [
      el('div', { class: 'codexModelSelectSubmenu', role: 'menu' }, [
        el(
          'div',
          { class: 'codexModelSelectGroups scrollable' },
          groups.map(group => codexGroupSection(group, reactId))
        )
      ])
    ])
  )
}

/** Mount the composer and open the menu in one step (an already-open menu). */
export function mountCodexMenu(groups, options = {}) {
  const composerBar = mountComposer(options)
  openCodexMenu(groups, { ...options, composerBar })
  return composerBar
}

/** The row button whose option name is `name`. */
export function codexRowFor(name) {
  return globalThis.document.body
    .querySelectorAll('button.codexModelSelectOption')
    .find(button => button.querySelector('span.codexModelSelectOptionName')?.textContent === name)
}
