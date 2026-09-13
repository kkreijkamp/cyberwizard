/**
 * Scene: Recursion & the Call Lens — a subgraph that calls itself, and the
 * navigation tools for watching every layer of the recursion compute.
 */

import type { GraphDocument } from '../core/serialize'
import { NUMBER } from '../core/types'
import { SceneBuilder } from './kit'

export function recursionLens(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'A subgraph that calls itself',
    [
      '**Factorial** is a *definition* whose interior contains an instance of',
      'itself: `n! = n × (n−1)!`, stopping at `n ≤ 1`.',
      '',
      '**Go inside:** double-click the Factorial node. Then double-click the',
      'self-instance *inside*: you step one recursion layer deeper, and every',
      'well shows **that call\'s** values.',
      '',
      '- The dropdown next to the breadcrumb jumps straight to any layer.',
      '- **Esc** steps back out one layer, then navigates up as usual.',
      '- Try the input 6 below → 6 layers deep, 720 at the top.',
    ].join('\n'),
    'Subgraphs',
    [380, 330],
  )

  const fact = b.subgraph('Factorial', { inputs: [['n', NUMBER]], outputs: [['result', NUMBER]] })

  // n ≤ 1?  — the base-case test.
  const lessEq = fact.node('math/less-eq', [300, 200], 'n ≤ 1?')
  const oneA = fact.config('io/number-input', [50, 350], { value: 1 }, 'one')
  fact.panelIn('n', lessEq, 'a')
  fact.link(oneA, 'number', lessEq, 'b')

  // Select (lazy): then = 1, else = n × (n−1)!.
  const select = fact.node('flow/select', [900, 300], 'base or recurse')
  const oneB = fact.config('io/number-input', [600, 150], { value: 1 }, 'then: 1')
  fact.link(lessEq, 'result', select, 'cond')
  fact.link(oneB, 'number', select, 'then')

  // n − 1, fed to the self-instance.
  const subtr = fact.node('math/subtract', [300, 550], 'n − 1')
  const oneC = fact.config('io/number-input', [50, 650], { value: 1 }, 'one')
  fact.panelIn('n', subtr, 'a')
  fact.link(oneC, 'number', subtr, 'b')

  const self = fact.selfInstance([600, 550])
  fact.link(subtr, 'result', self, 'n')

  // n × (n−1)!
  const mul = fact.node('math/multiply', [600, 800], 'n × (n−1)!')
  fact.panelIn('n', mul, 'a')
  fact.link(self, 'result', mul, 'b')
  fact.link(mul, 'result', select, 'else')

  fact.panelOut(select, 'result', 'result')

  fact.note(
    [50, 800],
    'Why the recursion stops',
    [
      '**Select is lazy**: it only evaluates the branch it takes.',
      'At `n ≤ 1` it takes `then`; the `else` branch (which contains the',
      'self-call) *never runs*, so the recursion terminates.',
      '',
      'Watch the wells while lensed on the base layer: `multiply` and the',
      'self-instance show `∅`: they were never demanded there.',
    ].join('\n'),
    'Notes',
    [330, 300],
  )

  fact.note(
    [950, 600],
    'You are inside the definition',
    [
      'Edits here change the definition itself: every call and every',
      'instance follows.',
      '',
      'The breadcrumb (top-left) walks you back out; **Esc** pops one',
      'recursion layer first, then the definition.',
    ].join('\n'),
    'Notes',
    [300, 220],
  )

  const input = b.config('io/number-input', [50, 700], { value: 6 }, 'n')
  const instance = b.instance(fact, [450, 700])
  const watch = b.watch([850, 700], 'n! (click into me)')

  b.link(input, 'number', instance, 'n')
  b.link(instance, 'result', watch, 'value')

  b.group('Compute 6!', [40, 640, 1220, 260], '#6f5630')

  return b.build()
}
