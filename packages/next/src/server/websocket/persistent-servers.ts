import type { Server as HttpServerType } from 'node:http'
import type { WebSocketServer as WebSocketServerTypeWs } from 'ws'
import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:persistent-servers')

export const NextWsHttpServerSymbol = Symbol.for('NextJs_Ws_HttpServer')
export const NextWsWebSocketServerSymbol = Symbol.for(
  'NextJs_Ws_WebSocketServer'
)

export function setHttpServer(server: HttpServerType): void {
  Reflect.set(globalThis, NextWsHttpServerSymbol, server)
}

export function useHttpServer(
  server?: HttpServerType
): HttpServerType | undefined {
  const existing = Reflect.get(globalThis, NextWsHttpServerSymbol) as
    | HttpServerType
    | undefined
  if (existing) return existing
  if (server) {
    setHttpServer(server)
    return server
  }
  return undefined
}

export function setWebSocketServer(wsServer: WebSocketServerTypeWs): void {
  Reflect.set(globalThis, NextWsWebSocketServerSymbol, wsServer)
}

export function useWebSocketServer(
  wsServer?: WebSocketServerTypeWs
): WebSocketServerTypeWs | undefined {
  const existing = Reflect.get(globalThis, NextWsWebSocketServerSymbol) as
    | WebSocketServerTypeWs
    | undefined
  if (existing) return existing
  if (wsServer) {
    setWebSocketServer(wsServer)
    return wsServer
  }
  return undefined
}

export function clearWebSocketServer(): void {
  const existing = Reflect.get(globalThis, NextWsWebSocketServerSymbol) as
    | WebSocketServerTypeWs
    | undefined

  debug('clearWebSocketServer called - existing server:', !!existing)

  if (existing) {
    debug(
      'clearing existing WebSocket server - client count:',
      existing.clients.size
    )

    // Close all connections first
    let clientCount = 0
    existing.clients.forEach((client) => {
      clientCount++
      debug(`terminating client ${clientCount}, readyState:`, client.readyState)
      client.terminate()
    })

    debug('closing WebSocket server')
    // Close the server
    existing.close()

    debug('removing WebSocket server from global')
    // Remove from global
    Reflect.deleteProperty(globalThis, NextWsWebSocketServerSymbol)

    debug('clearWebSocketServer completed')
  } else {
    debug('no existing WebSocket server to clear')
  }
}
