/**
 * The plugin's Typert package face: one hand-written host manifest for the
 * single remote method the Web client calls.
 *
 * The manifest is the wire contract. `dsh-typert-loader` only auto-registers a
 * package that exports `./typert` from a resolvable loader entry, so this plugin
 * registers its manifest explicitly in `apply`, which behaves identically for a
 * profile bundle and for a `--patch` overlay mounted by absolute path.
 *
 * Codecs carry both codec generations at once: earlier runtimes read
 * `codec.schema` (a schema with `parse`) while later ones read `codec.create()`
 * (a materializing factory). Both only check `typeof`, so one object satisfies
 * either contract with no version probing.
 *
 * @module dsh-plan-compact-execute/typert
 */
import { z } from 'zod'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import {
  ENDPOINT_ID,
  METHOD_NAME,
  PACKAGE_NAME,
  RESULT_SYMBOL,
  SERVICE_KEY,
  SESSION_ID_SYMBOL,
  SESSION_ID_WIRE,
} from './protocol.js'

/** One codec satisfying both the `schema` and the `create()` codec contracts. */
export function strictCodec(typeSymbol: string, schema: z.ZodType) {
  return { mode: 'strict' as const, typeSymbol, schema, create: () => schema }
}

/** Boundary validation of the wire result: the client trusts these fields. */
export const compactBeforeExecuteResultSchema = z.object({
  outcome: z.enum(['compacted', 'nothing-to-compact']),
  shadowedNodes: z.number().int().nonnegative(),
  shadowedTokens: z.number().int().nonnegative(),
})

/** The plugin's complete host contribution. */
export const TYPERT: TypertContribution = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: ENDPOINT_ID,
      service: SERVICE_KEY,
      namespace: SERVICE_KEY,
      method: METHOD_NAME,
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: SESSION_ID_WIRE,
          wire: SESSION_ID_WIRE,
          source: 'json',
          codec: strictCodec(SESSION_ID_SYMBOL, z.string().min(1)),
        },
      ],
      result: strictCodec(RESULT_SYMBOL, compactBeforeExecuteResultSchema),
    },
  ],
  model: { services: [], events: [], objects: [] },
}