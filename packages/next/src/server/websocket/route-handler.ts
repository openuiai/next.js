import type {
  RouteModuleWithPossibleSocketHandler,
  SocketHandler,
  ConnectionHandler,
} from './types'
import setupDebug from 'next/dist/compiled/debug'

import type { ServerAdapter } from './server-adapter'
import { getRouteMatcher } from '../../shared/lib/router/utils/route-matcher'
import { getRouteRegex } from '../../shared/lib/router/utils/route-regex'
import { isDynamicRoute } from '../../shared/lib/router/utils/is-dynamic'
import type { WebSocketServer } from 'ws'

const debug = setupDebug('next:websocket:route-handler')

// Cache for initialized connection handlers per route
const connectionHandlerCache = new Map<string, ConnectionHandler>()

export function resolvePathToRoute(
  serverAdapter: ServerAdapter,
  requestPath: string
): { filePath: string; routeParams: Record<string, string | string[]> } | null {
  // Get app routes through server adapter
  const appPathRoutes = serverAdapter.getAppRoutes()

  if (!appPathRoutes) {
    debug('app routes unavailable')
    return null
  }

  const apiRouteEntries: [string, [string, any]][] = []
  for (const entry of Object.entries(appPathRoutes)) {
    const pageKey = entry[1][0]
    if (pageKey && typeof pageKey === 'string' && pageKey.endsWith('/route')) {
      apiRouteEntries.push(entry)
    }
  }

  if (apiRouteEntries.length === 0) {
    return null
  }

  const staticEntries: [string, [string, any]][] = []
  const dynamicEntries: [string, [string, any]][] = []

  for (const entry of apiRouteEntries) {
    if (isDynamicRoute(entry[0])) {
      dynamicEntries.push(entry)
    } else {
      staticEntries.push(entry)
    }
  }

  // Check static routes first
  for (const [pagePattern, routeDetails] of staticEntries) {
    const pageKey = routeDetails[0]
    if (pagePattern === requestPath) {
      debug('route resolved:', requestPath, '->', pageKey)
      return { filePath: pageKey, routeParams: {} }
    }
  }

  // Then check dynamic routes
  for (const [pagePattern, routeDetails] of dynamicEntries) {
    const pageKey = routeDetails[0]
    const routeRegex = getRouteRegex(pagePattern)
    const matcher = getRouteMatcher(routeRegex)
    const paramsFromMatcher = matcher(requestPath)

    if (paramsFromMatcher) {
      debug('route resolved:', requestPath, '->', pagePattern)

      const routeParams: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(paramsFromMatcher)) {
        if (value !== undefined) {
          routeParams[key] = value
        }
      }

      return { filePath: pageKey, routeParams }
    }
  }

  return null
}

export async function importRouteModule(
  serverAdapter: ServerAdapter,
  pageKey: string
): Promise<RouteModuleWithPossibleSocketHandler | null> {
  // Ensure page is available (important for development)
  if (serverAdapter.ensurePage) {
    try {
      await serverAdapter.ensurePage(pageKey)
    } catch (err) {
      debug(
        'ensurePage warning:',
        pageKey,
        err instanceof Error ? err.message : err
      )
    }
  }

  let serverModulePath: string | undefined
  try {
    serverModulePath = serverAdapter.resolvePagePath(pageKey)

    if (!serverModulePath) {
      debug('path resolve failed:', pageKey)
      return null
    }

    const routeModule = require(serverModulePath)

    // Check for ESM default interop if necessary
    if (
      routeModule &&
      typeof routeModule === 'object' &&
      routeModule.__esModule &&
      routeModule.default
    ) {
      return routeModule.default as RouteModuleWithPossibleSocketHandler
    }

    return routeModule as RouteModuleWithPossibleSocketHandler
  } catch (error) {
    debug('route module import failed:', pageKey, error)
    return null
  }
}

export async function getSocketHandler(
  routeModule: RouteModuleWithPossibleSocketHandler | null
): Promise<SocketHandler | undefined> {
  if (!routeModule) {
    return undefined
  }

  let resolvedModule: RouteModuleWithPossibleSocketHandler | null = routeModule

  // Resolve promise if default export is a promise
  if (resolvedModule?.default instanceof Promise) {
    try {
      resolvedModule = await resolvedModule.default
    } catch (e) {
      debug('route module promise error:', e)
      resolvedModule = null
    }
  } else if (
    resolvedModule?.default &&
    typeof resolvedModule.default === 'object'
  ) {
    resolvedModule =
      resolvedModule.default as RouteModuleWithPossibleSocketHandler
  }

  if (!resolvedModule) {
    return undefined
  }

  // Check for the SOCKET export in different places
  const socketFunction =
    resolvedModule.routeModule?.userland?.SOCKET ??
    (resolvedModule as any).SOCKET ??
    resolvedModule.handlers?.SOCKET

  if (typeof socketFunction === 'function') {
    return socketFunction
  }

  // If the initial module had a default which was an object,
  // also check the original module structure if SOCKET wasn't found on the resolved object.
  if (
    routeModule.default &&
    typeof routeModule.default === 'object' &&
    routeModule !== resolvedModule
  ) {
    const originalModuleSocketFunction =
      routeModule.routeModule?.userland?.SOCKET ??
      (routeModule as any).SOCKET ??
      routeModule.handlers?.SOCKET

    if (typeof originalModuleSocketFunction === 'function') {
      return originalModuleSocketFunction
    }
  }

  return undefined
}

export async function getOrInitializeConnectionHandler(
  socketHandler: SocketHandler,
  wsServer: WebSocketServer,
  routePath: string,
  routeConfig: Record<string, any>
): Promise<ConnectionHandler | null> {
  // Check if we already have a cached handler for this route
  const cached = connectionHandlerCache.get(routePath)
  if (cached) {
    debug('cached handler found:', routePath)
    return cached
  }

  try {
    // Call the SOCKET handler once during initialization with WebSocketServer
    debug('initializing SOCKET handler:', routePath)
    const connectionHandler = await socketHandler(wsServer)

    if (typeof connectionHandler !== 'function') {
      debug(
        'SOCKET handler invalid return:',
        routePath,
        typeof connectionHandler
      )
      return null
    }

    // Cache the connection handler
    connectionHandlerCache.set(routePath, connectionHandler)
    debug('SOCKET handler ready:', routePath)

    return connectionHandler
  } catch (error) {
    debug('SOCKET handler init failed:', routePath, error)
    return null
  }
}

export function clearConnectionHandlerCache(): void {
  connectionHandlerCache.clear()
}
