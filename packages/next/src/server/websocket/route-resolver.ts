// High-level route resolution that combines server adapter and route handler

import type NextNodeServer from '../next-server'
import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:route-resolver')
import { createServerAdapter } from './server-adapter'
import {
  resolvePathToRoute,
  importRouteModule,
  getSocketHandler,
} from './route-handler'
import {
  RouteNotFoundError,
  HandlerNotFoundError,
  ModuleImportError,
  ServerNotAvailableError,
} from './errors'
import type { SocketHandler } from './types'

// Result of route resolution
export interface RouteResolutionResult {
  filePath: string
  routeParams: Record<string, string | string[]>
  handler: SocketHandler
}

// High-level function to resolve a WebSocket path to a handler
// This encapsulates the complexity of route resolution and provides
// a clean interface for the setup code
export async function resolveWebSocketRoute(
  nextServer: NextNodeServer,
  pathname: string
): Promise<RouteResolutionResult | null> {
  const serverAdapter = createServerAdapter(nextServer)

  try {
    // Step 1: Resolve the path to a route file
    const routeInfo = resolvePathToRoute(serverAdapter, pathname)
    if (!routeInfo) {
      throw new RouteNotFoundError(pathname)
    }

    // Step 2: Import the route module
    const routeModule = await importRouteModule(
      serverAdapter,
      routeInfo.filePath
    )
    if (!routeModule) {
      throw new ModuleImportError(routeInfo.filePath)
    }

    // Step 3: Extract the SOCKET handler
    const handler = await getSocketHandler(routeModule)
    if (!handler) {
      throw new HandlerNotFoundError(pathname)
    }

    debug('ws route resolved:', pathname)

    return {
      filePath: routeInfo.filePath,
      routeParams: routeInfo.routeParams,
      handler,
    }
  } catch (error) {
    // Re-throw WebSocket-specific errors
    if (
      error instanceof RouteNotFoundError ||
      error instanceof HandlerNotFoundError ||
      error instanceof ModuleImportError
    ) {
      throw error
    }

    // Wrap unexpected errors
    debug('ws route resolve failed:', pathname, error)
    throw new ModuleImportError(pathname, error as Error)
  }
}

// Check if WebSocket support is available and properly configured
export function isWebSocketSupported(nextServer: NextNodeServer): boolean {
  debug('ws support check')

  try {
    debug('creating server adapter')
    const serverAdapter = createServerAdapter(nextServer)

    // Check if we can access the HTTP server
    debug('accessing http server')
    const httpServer = serverAdapter.getHttpServer()
    if (!httpServer) {
      debug('http server not found')
      throw new ServerNotAvailableError('HTTP server not accessible')
    }
    debug('http server found')

    // Check if we can access app routes
    debug('accessing app routes')
    const appRoutes = serverAdapter.getAppRoutes()
    if (!appRoutes) {
      debug('app routes not found')
      throw new ServerNotAvailableError('App routes not accessible')
    }
    debug('app routes found')

    debug('ws support available')
    return true
  } catch (error) {
    debug('ws support check failed')
    if (error instanceof ServerNotAvailableError) {
      debug('error:', error.message)
    } else {
      debug('ws support check error:', error)
    }
    return false
  }
}
