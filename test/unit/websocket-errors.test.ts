/**
 * Unit tests for WebSocket error handling
 */

import { WebSocket } from 'ws'
import {
  WebSocketError,
  RouteNotFoundError,
  HandlerNotFoundError,
  ModuleImportError,
  ConnectionLimitError,
  HandlerExecutionError,
  isWebSocketError,
  getErrorStatusCode,
  getSafeErrorMessage,
  getRecoveryStrategy,
  RecoveryStrategy,
} from '../../packages/next/src/server/websocket/errors'

import { GracefulWebSocketHandler } from '../../packages/next/src/server/websocket/graceful-handler'
import {
  CircuitState,
  RouteCircuitBreaker,
} from '../../packages/next/src/server/websocket/circuit-breaker'

describe('WebSocket Error Handling', () => {
  describe('Error Classes', () => {
    it('should create RouteNotFoundError with correct properties', () => {
      const error = new RouteNotFoundError('/api/nonexistent')

      expect(error).toBeInstanceOf(WebSocketError)
      expect(error.name).toBe('RouteNotFoundError')
      expect(error.code).toBe('ROUTE_NOT_FOUND')
      expect(error.statusCode).toBe(404)
      expect(error.message).toContain('/api/nonexistent')
    })

    it('should create HandlerNotFoundError with correct properties', () => {
      const error = new HandlerNotFoundError('/api/ws/chat')

      expect(error).toBeInstanceOf(WebSocketError)
      expect(error.name).toBe('HandlerNotFoundError')
      expect(error.code).toBe('HANDLER_NOT_FOUND')
      expect(error.statusCode).toBe(400)
      expect(error.message).toContain('/api/ws/chat')
    })

    it('should create ModuleImportError with original error info', () => {
      const originalError = new Error('Module not found')
      originalError.stack = 'Original stack trace'

      const error = new ModuleImportError('/path/to/module', originalError)

      expect(error).toBeInstanceOf(WebSocketError)
      expect(error.name).toBe('ModuleImportError')
      expect(error.code).toBe('MODULE_IMPORT_ERROR')
      expect(error.statusCode).toBe(500)
      expect(error.stack).toContain('Original stack trace')
    })

    it('should create HandlerExecutionError with wrapped error', () => {
      const originalError = new Error('Handler failed')
      const error = new HandlerExecutionError('/api/ws/test', originalError)

      expect(error).toBeInstanceOf(WebSocketError)
      expect(error.name).toBe('HandlerExecutionError')
      expect(error.code).toBe('HANDLER_EXECUTION_ERROR')
      expect(error.message).toContain('/api/ws/test')
      expect(error.message).toContain('Handler failed')
    })
  })

  describe('Error Utilities', () => {
    it('should identify WebSocket errors correctly', () => {
      const wsError = new RouteNotFoundError('/test')
      const regularError = new Error('Regular error')

      expect(isWebSocketError(wsError)).toBe(true)
      expect(isWebSocketError(regularError)).toBe(false)
      expect(isWebSocketError('not an error')).toBe(false)
    })

    it('should return correct status codes', () => {
      expect(getErrorStatusCode(new RouteNotFoundError('/test'))).toBe(404)
      expect(getErrorStatusCode(new HandlerNotFoundError('/test'))).toBe(400)
      expect(getErrorStatusCode(new ModuleImportError('/test'))).toBe(500)
      expect(getErrorStatusCode(new Error('Regular error'))).toBe(500)
    })

    it('should return safe error messages', () => {
      const wsError = new RouteNotFoundError('/api/secret')
      const regularError = new Error('Database password is 123456')

      expect(getSafeErrorMessage(wsError)).toContain('/api/secret')
      expect(getSafeErrorMessage(regularError)).toBe(
        'Database password is 123456'
      )
      expect(getSafeErrorMessage('string error')).toBe(
        'An unexpected error occurred'
      )
    })

    it('should recommend appropriate recovery strategies', () => {
      expect(getRecoveryStrategy(new RouteNotFoundError('/test'))).toBe(
        RecoveryStrategy.CLOSE_CONNECTION
      )

      expect(
        getRecoveryStrategy(new HandlerExecutionError('/test', new Error()))
      ).toBe(RecoveryStrategy.TERMINATE_CONNECTION)

      expect(getRecoveryStrategy(new ConnectionLimitError(100))).toBe(
        RecoveryStrategy.CLOSE_CONNECTION
      )

      expect(getRecoveryStrategy(new Error('Unknown error'))).toBe(
        RecoveryStrategy.TERMINATE_CONNECTION
      )
    })
  })

  describe('Circuit Breaker', () => {
    let circuitBreaker: RouteCircuitBreaker

    beforeEach(() => {
      circuitBreaker = new RouteCircuitBreaker('/api/ws/test', {
        failureThreshold: 3,
        resetTimeout: 1000,
        monitoringWindow: 5000,
        successThreshold: 2,
      })
    })

    it('should start in closed state', () => {
      expect(circuitBreaker.canExecute()).toBe(true)
      expect(circuitBreaker.getStats().state).toBe(CircuitState.CLOSED)
    })

    it('should open after threshold failures', () => {
      // Record failures up to threshold
      circuitBreaker.recordFailure(new Error('Test error'))
      expect(circuitBreaker.canExecute()).toBe(true)

      circuitBreaker.recordFailure(new Error('Test error'))
      expect(circuitBreaker.canExecute()).toBe(true)

      circuitBreaker.recordFailure(new Error('Test error'))
      expect(circuitBreaker.canExecute()).toBe(false)
      expect(circuitBreaker.getStats().state).toBe(CircuitState.OPEN)
    })

    it('should transition to half-open after reset timeout', (done) => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(new Error('Test error'))
      }
      expect(circuitBreaker.canExecute()).toBe(false)

      // Wait for reset timeout
      setTimeout(() => {
        expect(circuitBreaker.canExecute()).toBe(true)
        expect(circuitBreaker.getStats().state).toBe(CircuitState.HALF_OPEN)
        done()
      }, 1100)
    })

    it('should close after successful operations in half-open state', (done) => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure(new Error('Test error'))
      }

      // Wait for half-open
      setTimeout(() => {
        expect(circuitBreaker.canExecute()).toBe(true) // Enters half-open

        // Record successful operations
        circuitBreaker.recordSuccess()
        circuitBreaker.recordSuccess()

        expect(circuitBreaker.getStats().state).toBe(CircuitState.CLOSED)
        done()
      }, 1100)
    })

    it('should provide accurate statistics', () => {
      circuitBreaker.recordSuccess()
      circuitBreaker.recordFailure(new Error('Test'))
      circuitBreaker.recordSuccess()

      const stats = circuitBreaker.getStats()
      expect(stats.successes).toBe(2)
      expect(stats.failures).toBe(1)
      expect(stats.totalRequests).toBe(3)
      expect(stats.lastSuccessTime).toBeTruthy()
      expect(stats.lastFailureTime).toBeTruthy()
    })
  })

  describe('Graceful Handler', () => {
    let mockWebSocket: Partial<WebSocket>
    let mockSocket: any

    beforeEach(() => {
      mockWebSocket = {
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        terminate: jest.fn(),
        once: jest.fn(),
      }

      mockSocket = {
        destroyed: false,
        end: jest.fn(),
        destroy: jest.fn(),
        once: jest.fn(),
        remoteAddress: '127.0.0.1',
      }
    })

    it('should close WebSocket gracefully', async () => {
      const closePromise = GracefulWebSocketHandler.closeWebSocketGracefully(
        mockWebSocket as WebSocket,
        { code: 1000, reason: 'Test close' }
      )

      // Simulate close event
      const onceCall = (mockWebSocket.once as jest.Mock).mock.calls.find(
        (call) => call[0] === 'close'
      )
      if (onceCall) {
        onceCall[1]() // Execute the close callback
      }

      await closePromise

      expect(mockWebSocket.close).toHaveBeenCalledWith(1000, 'Test close')
    })

    it('should handle WebSocket already closed', async () => {
      mockWebSocket.readyState = WebSocket.CLOSED

      await GracefulWebSocketHandler.closeWebSocketGracefully(
        mockWebSocket as WebSocket
      )

      expect(mockWebSocket.close).not.toHaveBeenCalled()
    })

    it('should timeout and terminate if close takes too long', async () => {
      jest.useFakeTimers()

      const closePromise = GracefulWebSocketHandler.closeWebSocketGracefully(
        mockWebSocket as WebSocket,
        { timeout: 1000 }
      )

      // Fast-forward time
      jest.advanceTimersByTime(1000)

      await closePromise

      expect(mockWebSocket.terminate).toHaveBeenCalled()

      jest.useRealTimers()
    })

    it('should execute handler safely and catch errors', async () => {
      const context = {
        pathname: '/api/ws/test',
        socket: mockSocket,
        request: {} as any,
        startTime: Date.now(),
      }

      const failingHandler = async () => {
        throw new Error('Handler failed')
      }

      await expect(
        GracefulWebSocketHandler.executeHandlerSafely(failingHandler, context)
      ).rejects.toThrow(HandlerExecutionError)
    })

    it('should return result from successful handler execution', async () => {
      const context = {
        pathname: '/api/ws/test',
        socket: mockSocket,
        request: {} as any,
        startTime: Date.now(),
      }

      const successHandler = async () => 'success'

      const result = await GracefulWebSocketHandler.executeHandlerSafely(
        successHandler,
        context
      )

      expect(result).toBe('success')
    })
  })
})
