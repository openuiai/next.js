import { ensureLeadingSlash } from './ensure-leading-slash'
import { isDynamicRoute } from '../router/utils'
import { NormalizeError } from '../utils'

/**
 * Takes a page and transforms it into its file counterpart ensuring that the
 * output is normalized. Note this function is not idempotent because a page
 * `/index` can be referencing `/index/index.js` and `/index/index` could be
 * referencing `/index/index/index.js`. Examples:
 *  - `/` -> `/index`
 *  - `/index/foo` -> `/index/index/foo`
 *  - `/index` -> `/index/index`
 */
export function normalizePagePath(page: string): string {
  let normalized =
    /^\/index(\/|$)/.test(page) && !isDynamicRoute(page)
      ? `/index${page}`
      : page === '/'
        ? '/index'
        : ensureLeadingSlash(page)

  if (process.env.NEXT_RUNTIME !== 'edge') {
    const { posix } = require('path')
    let finalNormalizedPath: string
    const protocolPatternInPath = /^\/https?:\/\//i

    if (protocolPatternInPath.test(normalized)) {
      const match = normalized.match(/^(\/https?:\/\/)(.*)/i)
      if (match) {
        const prefix = match[1]
        const restOfThePath = match[2]
        const tempNormalizedRest = posix.normalize(
          ensureLeadingSlash(restOfThePath)
        )
        const finalRest =
          tempNormalizedRest === '/' &&
          restOfThePath !== '' &&
          !restOfThePath.startsWith('/')
            ? restOfThePath
            : tempNormalizedRest.substring(1)
        finalNormalizedPath = prefix + finalRest.replace(/\/\/+/g, '/')
      } else {
        finalNormalizedPath = posix.normalize(normalized)
      }
    } else {
      finalNormalizedPath = posix.normalize(normalized)
    }

    const originalPosixNormalized = posix.normalize(normalized)
    if (
      originalPosixNormalized !== normalized &&
      !protocolPatternInPath.test(normalized)
    ) {
      throw new NormalizeError(
        `Requested and resolved page mismatch: ${normalized} ${originalPosixNormalized}`
      )
    }
    normalized = finalNormalizedPath
  }
  return normalized
}
