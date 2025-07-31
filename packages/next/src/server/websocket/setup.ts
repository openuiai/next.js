// File: packages/next/src/server/websocket/setup.ts

import type { IncomingMessage } from 'http'
import type { Socket as NetSocket } from 'net'
import { WebSocketServer, type WebSocket } from 'ws'

import * as Log from '../../build/output/log'
import setupDebug from 'next/dist/compiled/debug'
import type NextNodeServer from '../next-server'
import { createServerAdapter, getWebSocketConfig } from './server-adapter'
import { getConnectionTracker } from './connection-tracker'
import { resolveWebSocketRoute, isWebSocketSupported } from './route-resolver'
import { GracefulWebSocketHandler } from './graceful-handler'
import { getWebSocketServerOptions, getRouteConfig } from './config'
import { getOrInitializeConnectionHandler } from './route-handler'
import {
  initializeHealthMonitor,
  setupHealthCheckEndpoint,
  getHealthMonitor,
} from './health-check'
import { rateLimiterManager } from './rate-limiter'
import { initializeConnectionPool, getConnectionPool } from './performance'
import { getMemoryManager } from './memory-manager'
import {
  useHttpServer,
  useWebSocketServer,
  clearWebSocketServer,
} from './persistent-servers'

const debug = setupDebug('next:websocket:setup')
import { clearConnectionHandlerCache } from './route-handler'

// Centralized error handler for WebSocket connections
function handleConnectionError(
  error: unknown,
  connectionId: string,
  pathname: string,
  context: string
): void {
  const errorMessage = error instanceof Error ? error.message : String(error)

  // Log the error with context
  debug(
    `${context} error:`,
    pathname,
    'connection id:',
    connectionId,
    'error:',
    errorMessage
  )

  // Report to health monitor if available
  const healthMonitor = getHealthMonitor()
  if (healthMonitor) {
    healthMonitor.recordError()
  }

  // Log to Next.js error system
  Log.error(`WebSocket ${context}:`, pathname, errorMessage)
}

// Track servers that already have WebSocket listeners to prevent duplicates
const serverListenerMap = new WeakMap<
  any,
  {
    handler: Function
    wsServer: WebSocketServer
  }
>()

// Cleanup function to remove WebSocket listeners and clean up resources
function cleanupWebSocketServer(httpServer: any, wsServer: WebSocketServer) {
  const existingSetup = serverListenerMap.get(httpServer)
  if (existingSetup) {
    httpServer.removeListener('upgrade', existingSetup.handler)
    serverListenerMap.delete(httpServer)
  }

  // Clear connection handler cache
  clearConnectionHandlerCache()

  // Close WebSocket server
  wsServer.close(() => {
    debug('WebSocket closed')
  })
}

// Sets up the WebSocket server and attaches it to the Next.js HTTP server.
// This function is called during the NextNodeServer initialization.
// @param nextServer The Next.js server instance.
export function setupWebSocketServer(nextServer: NextNodeServer): void {
  debug('ws setup starting')

  // Clear any stale state from previous server instances
  debug('clearing stale websocket state')
  clearWebSocketServer()
  clearConnectionHandlerCache()

  // Debug: Log initial state
  const initialStats = getMemoryManager().getMemoryStats()
  debug(
    'initial state - app heap usage:',
    `${(initialStats.heapUsed / 1024 / 1024).toFixed(2)}MB (${initialStats.percentage.toFixed(1)}% of ${(initialStats.heapTotal / 1024 / 1024).toFixed(0)}MB allocated heap)`,
    'ws connections:',
    initialStats.connectionCount
  )

  // Check if WebSocket support is available
  if (!isWebSocketSupported(nextServer)) {
    debug('WebSocket support unavailable')
    return
  }

  const config = getWebSocketConfig(nextServer)
  if (!config.enabled) {
    debug('WebSocket disabled')
    return
  }

  const serverAdapter = createServerAdapter(nextServer)
  const httpServer = useHttpServer(serverAdapter.getHttpServer())

  if (httpServer === undefined) {
    // TODO: throw error
    return
  }

  // Check if WebSocket listener already exists for this server
  const existingSetup = serverListenerMap.get(httpServer)
  if (existingSetup) {
    debug('ws listener exists')
    return
  }

  // Check existing listeners in development
  if (process.env.NODE_ENV === 'development') {
    const existingListeners = httpServer.listeners('upgrade')
    if (existingListeners.length > 0) {
      debug('existing upgrade listeners:', existingListeners.length)
    }
  }

  const wsServerOptions = getWebSocketServerOptions(config)
  const wsServer = useWebSocketServer(new WebSocketServer(wsServerOptions))
  // Increase max listeners to prevent warnings
  if (wsServer) {
    wsServer.setMaxListeners(20)
  }
  if (!wsServer) {
    Log.error('WebSocketServer init failed')
    return
  }

  // Initialize performance optimizations
  const connectionPool = initializeConnectionPool(
    config.maxConnections,
    config.timeout || 300000 // Use timeout or default 5 minutes for idle cleanup
  )

  // Initialize memory management
  const memoryManager = getMemoryManager()

  // Initialize health monitoring if enabled
  if (config.monitoring.metrics || config.monitoring.healthCheck?.enabled) {
    initializeHealthMonitor(config, wsServer)

    if (config.monitoring.healthCheck?.enabled) {
      setupHealthCheckEndpoint(config, httpServer)
    }
  }

  // The primary upgrade handler attached to the HTTP server.
  const handleUpgrade = async (
    request: IncomingMessage,
    socket: NetSocket,
    head: Buffer
  ) => {
    const requestUrl = request.url || '/'
    debug('ws upgrade:', requestUrl)

    const tracker = getConnectionTracker()

    // Check for rapid duplicate requests
    // if (tracker.isRapidDuplicate(requestUrl, socket)) {
    //   debug('duplicate request blocked')
    //   return
    // }

    // Check if this socket is already being processed
    if (tracker.isSocketActive(socket)) {
      debug('socket busy, ignoring upgrade')
      return
    }

    // Mark this socket as being processed
    tracker.markSocketActive(socket)

    const parsedUrl = new URL(
      requestUrl,
      `ws://${request.headers.host || 'localhost'}`
    )
    const pathname = parsedUrl.pathname

    // Create connection context for error handling
    // const connectionContext = {
    //   pathname,
    //   socket,
    //   request,
    //   startTime: Date.now()
    // }

    // Exclude Next.js internal paths like HMR
    if (pathname.startsWith('/_next/')) {
      tracker.markSocketInactive(socket)
      return
    }

    // Check rate limiting for this route
    const routeConfig = getRouteConfig(config, pathname)
    if (routeConfig.rateLimit) {
      const rateLimit = rateLimiterManager.checkRateLimit(
        pathname,
        routeConfig,
        request,
        socket
      )
      if (!rateLimit.allowed) {
        debug(`Rate limit exceeded for ${pathname}: ${rateLimit.message}`)
        socket.destroy() // Rate limit exceeded - close immediately
        tracker.markSocketInactive(socket)
        return
      }
    }

    // Resolve the WebSocket route
    const routeResolution = await resolveWebSocketRoute(nextServer, pathname)
    if (!routeResolution) {
      debug('no ws route found for:', pathname)
      socket.destroy()
      tracker.markSocketInactive(socket)
      return
    }

    const { handler: socketHandler, routeParams } = routeResolution

    // Get route configuration
    const currentRouteConfig = getRouteConfig(config, pathname)

    // Get or initialize the connection handler for this route
    const connectionHandler = await getOrInitializeConnectionHandler(
      socketHandler,
      wsServer,
      pathname,
      currentRouteConfig
    )

    if (!connectionHandler) {
      Log.error('connection handler init failed:', pathname)
      socket.destroy()
      tracker.markSocketInactive(socket)
      return
    }

    // If we found a connection handler, delegate the upgrade to the 'ws' library
    wsServer.handleUpgrade(
      request,
      socket,
      head,
      async (clientWebSocket: WebSocket, httpRequest: IncomingMessage) => {
        // Generate unique connection ID
        const connectionId = crypto.randomUUID()
        debug(
          'ws connected to route:',
          pathname,
          'connection id:',
          connectionId
        )

        // Check memory usage before accepting connection
        if (!memoryManager.isMemoryUsageAcceptable()) {
          debug('memory high, rejecting connection')
          await GracefulWebSocketHandler.closeWebSocketGracefully(
            clientWebSocket,
            {
              code: 1013,
              reason: 'Server overloaded',
            }
          )
          return
        }

        // Add to connection pool
        if (
          !connectionPool.addConnection(connectionId, clientWebSocket, pathname)
        ) {
          debug('connection pool full')
          await GracefulWebSocketHandler.closeWebSocketGracefully(
            clientWebSocket,
            {
              code: 1013,
              reason: 'Server at capacity',
            }
          )
          return
        }

        try {
          // Call the connection handler function
          const cleanupFunction = await connectionHandler(
            clientWebSocket,
            httpRequest
          )

          // Always attach close handler for cleanup
          clientWebSocket.once('close', (code, reason) => {
            debug(
              'ws disconnected:',
              pathname,
              'connection id:',
              connectionId,
              'code:',
              code,
              'reason:',
              reason?.toString()
            )

            // Prevent double cleanup
            if (tracker.isConnectionCleanedUp(connectionId)) {
              debug('connection already cleaned up:', connectionId)
              return
            }
            tracker.markConnectionCleanedUp(connectionId)

            // Remove from connection tracker
            tracker.markSocketInactive(socket)

            // Run user cleanup function if provided
            if (typeof cleanupFunction === 'function') {
              try {
                cleanupFunction()
              } catch (e) {
                handleConnectionError(e, connectionId, pathname, 'cleanup')
              }
            }
          })

          // Note: Connection pool cleanup is handled automatically by setupConnectionHandlers()

          // Add error handler to track connection errors
          clientWebSocket.on('error', (error) => {
            handleConnectionError(error, connectionId, pathname, 'connection')
          })

          // Add heartbeat to detect dead connections
          const heartbeatInterval = setInterval(() => {
            if (clientWebSocket.readyState === clientWebSocket.OPEN) {
              debug('sending ping to:', connectionId)
              clientWebSocket.ping()
            } else {
              debug(
                'connection not open, clearing heartbeat:',
                connectionId,
                'state:',
                clientWebSocket.readyState
              )
              clearInterval(heartbeatInterval)
            }
          }, 30000) // 30 second heartbeat

          // Clear heartbeat on close
          clientWebSocket.once('close', () => {
            if (!tracker.isConnectionCleanedUp(connectionId)) {
              clearInterval(heartbeatInterval)
            }
          })

          if (
            typeof cleanupFunction !== 'function' &&
            cleanupFunction !== undefined &&
            cleanupFunction !== null
          ) {
            debug(
              `Connection handler for ${pathname} returned non-function value: ${typeof cleanupFunction}`
            )
          }
        } catch (e) {
          handleConnectionError(e, connectionId, pathname, 'handler')
          clientWebSocket.terminate()
        }

        // Connection tracking is automatically cleaned up when socket closes
      }
    )
  }

  // Add a unique identifier to the handler for detection
  Object.defineProperty(handleUpgrade, 'name', { value: 'nextWsHandleUpgrade' })

  // Store the handler reference for cleanup
  serverListenerMap.set(httpServer, {
    handler: handleUpgrade,
    wsServer,
  })

  // Attach our custom upgrade handler to the HTTP server
  httpServer.on('upgrade', handleUpgrade)
  debug('ws upgrade listener ready')

  // Set up cleanup when the server closes
  httpServer.on('close', () => {
    debug('cleaning up WebSocket server')
    cleanupWebSocketServer(httpServer, wsServer)
  })
}
