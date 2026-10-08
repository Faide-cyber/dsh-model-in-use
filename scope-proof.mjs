// Harness self-check for dsh-model-in-use.
//
// verify.mjs shows the plugin behaves; negative-proof.mjs shows the fixture
// notices a broken rule. This one checks the fixture itself, because the bug
// that shipped was hidden by the FIXTURE being too forgiving, not by a missing
// assertion:
//
//   * the menu must be a deep descendant of <body>, never a <body> child —
//     otherwise a non-subtree body observer passes by accident;
//   * the observer must honour `subtree` — a non-subtree watcher must NOT be
//     told about a deep insertion;
//   * the selector engine must THROW on anything it cannot express, so a plugin
//     can never quietly query something that matches nothing.
//
// Run: node scope-proof.mjs

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  el,
  loadClient,
  mountComposer,
  openCodexMenu,
  settle,
  stubCtx
} from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, 'lib', 'client.js')

let failures = 0
const check = (label, ok) => {
  if (ok) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}`)
  }
}

// --- 1. the mounted menu is not a <body> child ----------------------------
console.log('1. opening the menu does not mutate <body> directly')
{
  await loadClient(CLIENT)
  mountComposer({ menuId: 'r1-menu' })

  const before = globalThis.document.body.children.length
  openCodexMenu([], { menuId: 'r1-menu' })
  const after = globalThis.document.body.children.length

  check('no new <body> child appeared', before === after)
  check('the menu exists somewhere in the tree', globalThis.document.body.querySelector('div.codexModelSelectMenu') !== null)
  check(
    'the menu is a descendant, not a body child',
    !globalThis.document.body.children.includes(
      globalThis.document.body.querySelector('div.codexModelSelectMenu')
    )
  )
}

// --- 2. the observer honours subtree --------------------------------------
console.log('2. a body observer only sees deep insertions with subtree')
{
  const FixtureObserver = globalThis.MutationObserver
  FixtureObserver.reset()
  const shallow = []
  const deep = []
  new FixtureObserver(records => shallow.push(records)).observe(globalThis.document.body, {
    childList: true
  })
  new FixtureObserver(records => deep.push(records)).observe(globalThis.document.body, {
    childList: true,
    subtree: true
  })

  mountComposer({ menuId: 'r2-menu' })
  const composerBar = globalThis.document.body.querySelector('div.composerBar')
  composerBar.append(el('div', { class: 'codexModelSelectGroups' }))
  await settle()

  check('the subtree observer is told about it', deep.length > 0)
  check(
    'the shallow observer is told about the composer appearing',
    shallow.length > 0
  )

  // Now the discriminating case: a deep insertion with no <body> change.
  const shallowBefore = shallow.length
  const deepBefore = deep.length
  composerBar.append(el('div', { class: 'codexModelSelectMenu', id: 'r2-menu' }))
  await settle()

  check('the subtree observer still sees it', deep.length > deepBefore)
  check('the shallow observer does NOT', shallow.length === shallowBefore)
}

// --- 3. the selector engine refuses what it cannot express -----------------
console.log('3. the fixture rejects selectors it cannot express')
{
  const node = el('div', { class: 'a' })
  const unsupported = [
    'div > .a',
    'div .a',
    'div:first-child',
    'div[class~="a"]',
    'div.a[class="a"]['
  ]

  let threw = 0
  for (const selector of unsupported) {
    try {
      node.querySelectorAll(selector)
    } catch {
      threw += 1
    }
  }
  check(`every unsupported selector threw (${threw}/${unsupported.length})`, threw === unsupported.length)

  // And the supported subset really matches, so the throwing is not the only
  // behaviour: class, attribute and suffix tests must all work.
  const tree = el('div', { class: 'outer' }, [
    el('button', { class: 'codexModelSelectOption', role: 'menuitemradio' }),
    el('button', { class: 'codexModelSelectOption other' }),
    el('div', { id: 'r1-menu' })
  ])
  check('class selector matches', tree.querySelectorAll('button.codexModelSelectOption').length === 2)
  check('attribute selector matches', tree.querySelectorAll('button[role="menuitemradio"]').length === 1)
  check('suffix selector matches', tree.querySelectorAll('div[id$="-menu"]').length === 1)
  check('tag selector matches', tree.querySelectorAll('button').length === 2)
  check('a selector matching nothing returns empty', tree.querySelectorAll('span').length === 0)
}

// --- 4. the plugin's own selectors are all expressible ---------------------
console.log('4. every selector the plugin uses is expressible by the fixture')
{
  const source = await import('node:fs').then(fs => fs.readFileSync(CLIENT, 'utf8'))
  const selectors = [...source.matchAll(/'([a-z]+(?:\.[\w-]+)+|\[[^\]]+\]|\w+\[[^\]]+\])'/g)].map(
    ([, value]) => value
  )
  const candidates = [...new Set(selectors)]
  let bad = []
  for (const selector of candidates) {
    try {
      el('div').querySelectorAll(selector)
    } catch {
      bad.push(selector)
    }
  }
  check(
    `all ${candidates.length} literal selectors compile${bad.length === 0 ? '' : ` (bad: ${bad.join(', ')})`}`,
    bad.length === 0
  )
}

console.log(
  failures === 0
    ? '\nscope-proof: the fixture is shaped like the real DOM and refuses the rest'
    : `\nscope-proof: ${failures} check(s) FAILED`
)
process.exit(failures === 0 ? 0 : 1)
