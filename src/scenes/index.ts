/**
 * Example scenes: guided, annotated graphs that teach the platform and
 * demonstrate cryptographic ideas. Each builds to a plain GraphDocument and
 * loads through the ordinary restore path (ui/scenes).
 */

import type { GraphDocument } from '../core/serialize'
import { welcomeTour } from './welcome-tour'

export interface Scene {
  id: string
  title: string
  /** One line shown in the picker. */
  description: string
  build: () => GraphDocument
}

export const SCENES: readonly Scene[] = [
  {
    id: 'welcome-tour',
    title: 'Welcome Tour',
    description: 'The platform in five minutes: wires, previews, coercion, demand-driven evaluation.',
    build: welcomeTour,
  },
]
