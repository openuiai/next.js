// Graceful WebSocket connection handling with error recovery

import { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Socket as NetSocket } from 'net'

import * as Log from '../../build/output/log'
import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:graceful-handler')
import {
  RouteNotFoundError,
  HandlerNotFoundError,
  ModuleImportError,
  HandlerExecutionError,
  getRecoveryStrategy,
  getSafeErrorMessage,
  RecoveryStrategy,
} from './errors'
import { circuitBreakerManager } from './circuit-breaker'

export interface ConnectionContext {
  pathname: string
  socket: NetSocket
  request: IncomingMessage
  startTime: number
}

export interface GracefulCloseOptions {
  code?: number
  reason?: string
  timeout?: number
}

// Graceful WebSocket connection manager
export class GracefulWebSocketHandler {
  private static readonly DEFAULT_CLOSE_CODE = 1000 // Normal closure
  private static readonly ERROR_CLOSE_CODE = 1011 // Server error
  private static readonly DEFAULT_CLOSE_TIMEOUT = 5000 // 5 seconds

  // Handle WebSocket upgrade with graceful error handling
  static async handleUpgrade(
    context: ConnectionContext,
    upgradeCallback: (ws: WebSocket, request: IncomingMessage) => Promise<void>
  ): Promise<boolean> {
    const { pathname, socket, request } = context
    const circuitBreaker = circuitBreakerManager.getBreaker(pathname)

    try {
      // Check circuit breaker
      if (!circuitBreaker.canExecute()) {
        debug('circuit breaker open:', pathname)
        this.closeSocketGracefully(socket, {
          code: 503,
          reason: 'Service temporarily unavailable',
        })
        return false
      }

      // Execute the upgrade callback
      await upgradeCallback(null as any, request)

      circuitBreaker.recordSuccess()
      return true
    } catch (error) {
      circuitBreaker.recordFailure(error as Error)
      await this.handleUpgradeError(context, error)
      return false
    }
  }

  // Handle errors during WebSocket connection
  static async handleConnectionError(
    client: WebSocket,
    context: ConnectionContext,
    error: unknown
  ): Promise<void> {
    const { pathname } = context
    const recovery = getRecoveryStrategy(error)
    const errorMessage = getSafeErrorMessage(error)

    Log.error('ws connection error:', pathname, errorMessage)

    switch (recovery) {
      case RecoveryStrategy.CLOSE_CONNECTION:
        await this.closeWebSocketGracefully(client, {
          code: this.ERROR_CLOSE_CODE,
          reason: 'Connection error',
        })
        break

      case RecoveryStrategy.TERMINATE_CONNECTION:
        client.terminate()
        debug('connection terminated:', pathname)
        break

      case RecoveryStrategy.RETRY:
        // For future implementation - could retry connection logic
        debug('retry not implemented:', pathname)
        client.terminate()
        break

      case RecoveryStrategy.IGNORE:
        debug('ignoring error:', pathname)
        break

      default:
        client.terminate()
        break
    }
  }

  // Handle errors during upgrade process
  private static async handleUpgradeError(
    context: ConnectionContext,
    error: unknown
  ): Promise<void> {
    const { pathname, socket } = context
    const recovery = getRecoveryStrategy(error)
    const errorMessage = getSafeErrorMessage(error)

    Log.error('ws upgrade error:', pathname, errorMessage)

    let closeCode = 1011
    let reason = 'Internal server error'

    if (error instanceof RouteNotFoundError) {
      closeCode = 1002 // Protocol error
      reason = 'Route not found'
    } else if (error instanceof HandlerNotFoundError) {
      closeCode = 1002 // Protocol error
      reason = 'Handler not available'
    } else if (error instanceof ModuleImportError) {
      closeCode = 1011 // Server error
      reason = 'Module load error'
    }

    switch (recovery) {
      case RecoveryStrategy.CLOSE_CONNECTION:
        this.closeSocketGracefully(socket, { code: closeCode, reason })
        break

      case RecoveryStrategy.TERMINATE_CONNECTION:
      default:
        socket.destroy()
        debug('socket destroyed:', pathname)
        break
    }
  }

  // Gracefully close a WebSocket connection
  static async closeWebSocketGracefully(
    client: WebSocket,
    options: GracefulCloseOptions = {}
  ): Promise<void> {
    const {
      code = this.DEFAULT_CLOSE_CODE,
      reason = '',
      timeout = this.DEFAULT_CLOSE_TIMEOUT,
    } = options

    return new Promise<void>((resolve) => {
      if (client.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }

      if (client.readyState === WebSocket.CLOSING) {
        // Wait for existing close to complete
        client.once('close', () => resolve())
        return
      }

      // Set up timeout in case close doesn't complete
      const closeTimeout = setTimeout(() => {
        if (client.readyState !== WebSocket.CLOSED) {
          debug('connection close timeout')
          client.terminate()
        }
        resolve()
      }, timeout)

      // Listen for close completion
      client.once('close', () => {
        clearTimeout(closeTimeout)
        resolve()
      })

      // Initiate graceful close
      try {
        client.close(code, reason)
      } catch (error) {
        clearTimeout(closeTimeout)
        debug('connection close error:', error)
        client.terminate()
        resolve()
      }
    })
  }

  // Gracefully close a raw socket connection
  private static closeSocketGracefully(
    socket: NetSocket,
    options: GracefulCloseOptions = {}
  ): void {
    const { timeout = this.DEFAULT_CLOSE_TIMEOUT } = options

    if (socket.destroyed) {
      return
    }

    // Set up timeout in case close doesn't complete
    const closeTimeout = setTimeout(() => {
      if (!socket.destroyed) {
        debug('socket close timeout')
        socket.destroy()
      }
    }, timeout)

    // Listen for close completion
    socket.once('close', () => {
      clearTimeout(closeTimeout)
    })

    socket.once('error', () => {
      clearTimeout(closeTimeout)
    })

    // Initiate graceful close
    try {
      socket.end()
    } catch (error) {
      clearTimeout(closeTimeout)
      debug('socket close error:', error)
      socket.destroy()
    }
  }

  // Create a connection timeout handler
  static createTimeoutHandler(
    client: WebSocket,
    context: ConnectionContext,
    timeoutMs: number
  ): NodeJS.Timeout {
    return setTimeout(() => {
      if (client.readyState === WebSocket.OPEN) {
        debug('connection timeout:', context.pathname)
        this.closeWebSocketGracefully(client, {
          code: 1000,
          reason: 'Connection timeout',
        })
      }
    }, timeoutMs)
  }

  // Wrap handler execution with error handling
  static async executeHandlerSafely<T>(
    handler: () => Promise<T>,
    context: ConnectionContext
  ): Promise<T | null> {
    try {
      return await handler()
    } catch (error) {
      const wrappedError = new HandlerExecutionError(
        context.pathname,
        error as Error
      )
      throw wrappedError
    }
  }
}
