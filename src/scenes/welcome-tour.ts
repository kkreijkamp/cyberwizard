/**
 * Scene: Welcome Tour — the platform's core ideas in one small graph.
 */

import type { GraphDocument } from '../core/serialize'
import { SceneBuilder } from './kit'

export function welcomeTour(): GraphDocument {
  const b = new SceneBuilder()

  b.note(
    [50, 50],
    'Welcome to CyberWizard 🧙',
    [
      'A node-based data workbench: data **flows through wires** between operations.',
      '',
      '- Every node with a well at its foot shows a **live preview** of its output.',
      '- **Click a well** to inspect the full value, untruncated.',
      '- Nodes recompute **the moment you edit**: change the message below and watch.',
      '- Wires coerce types automatically: a *string* feeding a *bytes* slot converts (UTF-8), a *bytes* feeding a *string* slot hex-dumps, and so on.',
      '',
      '**Click this note** to edit it. Notes are nodes too; they just compute nothing.',
    ].join('\n'),
    'Notes',
    [380, 350],
  )

  b.note(
    [50, 500],
    'Demand-driven, not push',
    [
      'Nothing runs until a **sink** (a Preview or Download) asks for a value.',
      'The Preview on the right pulls; evaluation flows upstream, running only what it needs.',
      '',
      'Unwire a Preview (drag its link off) and its whole branch goes idle:',
      'the wells turn to `∅`. Wire it back and it recomputes.',
    ].join('\n'),
    'Notes',
    [330, 330],
  )

  const input = b.config('io/text-input', [50, 950], { text: 'Hello, Wizard' }, 'Message')

  const sha = b.node('hashing/sha-256', [500, 800])
  const b64 = b.node('encoding/base64-encode', [500, 1100])
  const shaWatch = b.watch([900, 800], 'SHA-256 (hex)')
  const b64Watch = b.watch([900, 1100], 'Base64')

  b.link(input, 'text', sha, 'data')
  b.link(sha, 'hex', shaWatch, 'value')
  b.link(input, 'text', b64, 'data')
  b.link(b64, 'text', b64Watch, 'value')

  b.note(
    [500, 1350],
    'Fan-out is free',
    [
      'One output can feed **many** inputs: the message above drives two branches at once.',
      '',
      'Try it: drag from the message\'s output dot onto empty canvas;',
      'the palette opens pre-filtered to nodes that accept a string.',
    ].join('\n'),
    'Notes',
    [330, 260],
  )

  b.group('Say something', [40, 890, 390, 280], '#47603f')
  b.group('Watch it compute', [490, 740, 830, 660], '#2f5f68')

  return b.build()
}
