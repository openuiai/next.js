import type {
  MiddlewareConfig,
  MiddlewareMatcher,
} from '../../analysis/get-page-static-info'
import { getModuleBuildInfo } from './get-module-build-info'
import { MIDDLEWARE_LOCATION_REGEXP } from '../../../lib/constants'
import { loadEntrypoint } from '../../load-entrypoint'

export type MiddlewareLoaderOptions = {
  absolutePagePath: string
  page: string
  rootDir: string
  matchers?: string
  preferredRegion: string | string[] | undefined
  middlewareConfig: string
}

// matchers can have special characters that break the loader params
// parsing so we base64 encode/decode the string
export function encodeMatchers(matchers: MiddlewareMatcher[]) {
  return Buffer.from(JSON.stringify(matchers)).toString('base64')
}

export function decodeMatchers(encodedMatchers: string) {
  return JSON.parse(
    Buffer.from(encodedMatchers, 'base64').toString()
  ) as MiddlewareMatcher[]
}

export default async function middlewareLoader(this: any) {
  const {
    absolutePagePath,
    page,
    rootDir,
    matchers: encodedMatchers,
    preferredRegion,
    middlewareConfig: middlewareConfigBase64,
  }: MiddlewareLoaderOptions = this.getOptions()
  const matchers = encodedMatchers ? decodeMatchers(encodedMatchers) : undefined
  const pagePath = this.utils.contextify(
    this.context || this.rootContext,
    absolutePagePath
  )

  const middlewareConfig: MiddlewareConfig = JSON.parse(
    Buffer.from(middlewareConfigBase64, 'base64').toString()
  )
  const buildInfo = getModuleBuildInfo(this._module)
  buildInfo.nextEdgeMiddleware = {
    matchers,
    page:
      page.replace(new RegExp(`/${MIDDLEWARE_LOCATION_REGEXP}$`), '') || '/',
  }
  buildInfo.rootDir = rootDir
  buildInfo.route = {
    page,
    absolutePagePath,
    preferredRegion,
    middlewareConfig,
  }

  // Check if we're compiling for Node.js (apiNode layer)
  const isNodeLayer = this._module?.layer === 'api-node'

  if (isNodeLayer) {
    // For Node.js layer, return a simple module that exports the middleware directly
    return `
      import * as _mod from ${JSON.stringify(pagePath)}

      const mod = { ..._mod }
      const handler = mod.middleware || mod.default

      if (typeof handler !== 'function') {
        throw new Error(
          'The Middleware "${page}" must export a \`middleware\` or a \`default\` function'
        )
      }

      // Export the middleware handler directly for Node.js context
      export const middleware = handler
      export const config = mod.config || {}
      export default handler
    `
  }

  return await loadEntrypoint('middleware', {
    VAR_USERLAND: pagePath,
    VAR_DEFINITION_PAGE: page,
  })
}
