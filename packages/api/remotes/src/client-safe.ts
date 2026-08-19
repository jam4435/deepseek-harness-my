/** Browser-safe RPC helpers shared by Client contributions. */

import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'

/** Maximum sessions the Host may return from one session-search request. */
export const SESSION_SEARCH_RESULT_LIMIT = 20

/**
 * Convert a rejected transport operation into the regular unary-result failure.
 * @param error - transport rejection caught by a Client caller.
 * @returns the result branch rendered alongside Host-side errors.
 */
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
  }
}
