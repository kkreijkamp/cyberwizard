/**
 * Scene: List Pipelines — Map/Filter with named subgraph definitions, Split
 * and Join, showing lists as first-class values.
 */

import type { GraphDocument } from '../core/serialize'
import { BOOLEAN, STRING } from '../core/types'
import { SceneBuilder } from './kit'

export function listPipelines(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Lists flow through wires too',
    [
      '**Split** turns text into a list; **Map** applies a *subgraph* to every',
      'element; **Filter** keeps elements whose subgraph returns true; **Join**',
      'flattens back to text.',
      '',
      'The subgraphs are picked **by name** in the fn dropdown: "Shout" and',
      '"Long Enough" are definitions living in this document (open them with',
      'a double-click; they\'re ordinary graphs).',
      '',
      'Write your own: collapse any selection into a subgraph and pick it',
      'in a Map; recursion guards and the call lens all work there too.',
    ].join('\n'),
    'Flow',
    [380, 330],
  )

  // "Shout": text → upper-cased text.
  const shout = b.subgraph('Shout', { inputs: [['text', STRING]], outputs: [['text', STRING]] })
  const upper = shout.node('text/to-upper-case', [300, 200])
  shout.panelIn('text', upper, 'text')
  shout.panelOut(upper, 'text', 'text')

  // "Long Enough": text → length > 3.
  const longEnough = b.subgraph('Long Enough', { inputs: [['text', STRING]], outputs: [['ok', BOOLEAN]] })
  const length = longEnough.node('text/length', [300, 200])
  const three = longEnough.config('io/number-input', [50, 350], { value: 3 }, 'three')
  const greater = longEnough.node('math/greater', [550, 250], 'length > 3?')
  longEnough.panelIn('text', length, 'value')
  longEnough.link(length, 'length', greater, 'a')
  longEnough.link(three, 'number', greater, 'b')
  longEnough.panelOut(greater, 'result', 'ok')

  const csv = b.config('io/text-input', [50, 600], { text: 'encryption, is, a, team, sport' }, 'CSV input')
  const split = b.config('text/split', [450, 600], { separator: ', ' })
  const map = b.config('flow/map', [800, 550], { fn: 'Shout' })
  const filter = b.config('flow/filter', [1100, 600], { fn: 'Long Enough' })
  const join = b.config('text/join', [1400, 600], { separator: ' ' })
  const watch = b.watch([1750, 600], 'Result')

  b.link(csv, 'text', split, 'text')
  b.link(split, 'items', map, 'items')
  b.link(map, 'items', filter, 'items')
  b.link(filter, 'items', join, 'items')
  b.link(join, 'text', watch, 'value')

  b.note(
    [1100, 900],
    'Each element is a tiny call',
    [
      'Map/Filter evaluate their subgraph **once per element**: "Shout" runs',
      '5 times here. Those runs are deliberately not recorded in the call',
      'lens (a 10 000-element list would flood it); the wells inside the',
      'definition show the *last* element\'s values.',
    ].join('\n'),
    'Notes',
    [330, 240],
  )

  b.group('CSV → split → map → filter → join', [40, 540, 2120, 300], '#555b66')

  return b.build()
}
