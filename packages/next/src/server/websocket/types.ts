// File: packages/next/src/server/websocket/types.ts

import type { IncomingMessage as HttpIncomingMessage } from 'http'
import type { WebSocket, WebSocketServer as WebSocketServerType } from 'ws'

// Awaitable utility type
type Awaitable<T> = T | Promise<T>

// Type for the function optionally returned by a connection handler, called on client disconnect.
export type OnSocketClose = () => Awaitable<unknown>

// Type for the connection handler function returned by SOCKET
export type ConnectionHandler = (
  // The individual WebSocket client that has connected.
  client: WebSocket,
  // The initial HTTP request that initiated the WebSocket upgrade.
  request: HttpIncomingMessage
) => Awaitable<OnSocketClose | void | unknown>

// Defines the signature for a WebSocket handler function that can be exported
// from a Next.js App Router API route file under the name `SOCKET`.
// This function is called ONCE when the server starts up, not for each connection.
export type SocketHandler = (
  // The WebSocketServer instance managing all connections for this route
  wss: WebSocketServerType
) => Awaitable<ConnectionHandler>

// Interface for the structure of a route module that might contain a SOCKET handler.
// This is used by `route-handler.ts` to safely access the `SOCKET` export,
// considering potential wrapping by the Next.js compiler or different export styles.
export interface RouteModuleWithPossibleSocketHandler {
  // Common App Router structure: `export default <...>`. The resolved default
  // might have a `routeModule.userland` structure.
  default?:
    | Promise<RouteModuleWithPossibleSocketHandler> // Handle async default exports
    | RouteModuleWithPossibleSocketHandler // Handle direct object default exports

  // Standard Next.js App Router structure for route handlers
  routeModule?: {
    userland?: {
      SOCKET?: SocketHandler // The target export key
      // other HTTP methods like GET, POST etc. might also be here
      [key: string]: unknown
    }
  }

  // Alternative structures sometimes used or found in module objects
  handlers?: {
    SOCKET?: SocketHandler
    // other HTTP methods
    [key: string]: unknown
  }

  // Direct export of SOCKET (less common with standard App Router conventions but possible)
  SOCKET?: SocketHandler
}
