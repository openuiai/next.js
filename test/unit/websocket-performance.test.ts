/**
 * Unit tests for WebSocket performance optimizations
 */

import { WebSocket } from 'ws'
import {
  WebSocketConnectionPool,
  MessageBuffer,
  getConnectionPool,
  initializeConnectionPool,
} from '../../packages/next/src/server/websocket/performance'

import {
  WebSocketMemoryManager,
  getMemoryManager,
} from '../../packages/next/src/server/websocket/memory-manager'

describe('WebSocket Performance', () => {
  describe('WebSocketConnectionPool', () => {
    let pool: WebSocketConnectionPool
    let mockWebSocket: Partial<WebSocket>

    beforeEach(() => {
      pool = new WebSocketConnectionPool(10, 5000) // 10 max connections, 5s idle timeout
      mockWebSocket = {
        readyState: WebSocket.OPEN,
        close: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn(),
        setMaxListeners: jest.fn(),
      }
    })

    afterEach(() => {
      pool.destroy()
    })

    it('should add connections to the pool', () => {
      const success = pool.addConnection(
        'conn1',
        mockWebSocket as WebSocket,
        '/api/ws/test'
      )

      expect(success).toBe(true)

      const stats = pool.getStats()
      expect(stats.total).toBe(1)
      expect(stats.active).toBe(1)
    })

    it('should reject connections when at capacity', () => {
      // Fill the pool to capacity
      for (let i = 0; i < 10; i++) {
        pool.addConnection(
          `conn${i}`,
          mockWebSocket as WebSocket,
          '/api/ws/test'
        )
      }

      // Try to add one more
      const success = pool.addConnection(
        'conn10',
        mockWebSocket as WebSocket,
        '/api/ws/test'
      )

      expect(success).toBe(false)

      const stats = pool.getStats()
      expect(stats.total).toBe(10)
    })

    it('should remove connections from the pool', () => {
      pool.addConnection('conn1', mockWebSocket as WebSocket, '/api/ws/test')

      let stats = pool.getStats()
      expect(stats.total).toBe(1)

      pool.removeConnection('conn1')

      stats = pool.getStats()
      expect(stats.total).toBe(0)
    })

    it('should track connection metadata correctly', () => {
      const mockWs = {
        ...mockWebSocket,
        on: jest.fn((event, callback) => {
          if (event === 'message') {
            // Simulate receiving a message
            setTimeout(() => callback(Buffer.from('test message')), 10)
          }
        }),
      }

      pool.addConnection('conn1', mockWs as WebSocket, '/api/ws/test')

      const stats = pool.getStats()
      expect(stats.total).toBe(1)
    })

    it('should broadcast messages to connections matching path pattern', () => {
      const mockWs1 = {
        ...mockWebSocket,
        send: jest.fn(),
        setMaxListeners: jest.fn(),
      }
      const mockWs2 = {
        ...mockWebSocket,
        send: jest.fn(),
        setMaxListeners: jest.fn(),
      }
      const mockWs3 = {
        ...mockWebSocket,
        send: jest.fn(),
        setMaxListeners: jest.fn(),
      }

      pool.addConnection('conn1', mockWs1 as WebSocket, '/api/ws/chat')
      pool.addConnection('conn2', mockWs2 as WebSocket, '/api/ws/chat/room1')
      pool.addConnection('conn3', mockWs3 as WebSocket, '/api/ws/notifications')

      const sent = pool.broadcast('chat', 'Hello everyone!')

      expect(sent).toBe(2) // Only chat connections should receive the message
      expect(mockWs1.send).toHaveBeenCalledWith('Hello everyone!')
      expect(mockWs2.send).toHaveBeenCalledWith('Hello everyone!')
      expect(mockWs3.send).not.toHaveBeenCalled()
    })

    it('should clean up idle connections', (done) => {
      // Create a pool with very short idle timeout for this test
      const shortTimeoutPool = new WebSocketConnectionPool(10, 50) // 50ms idle timeout

      const mockWs = {
        ...mockWebSocket,
        close: jest.fn(),
        setMaxListeners: jest.fn(),
      }

      shortTimeoutPool.addConnection(
        'conn1',
        mockWs as WebSocket,
        '/api/ws/test'
      )

      // Force cleanup after idle timeout has passed
      setTimeout(() => {
        const cleaned = shortTimeoutPool.cleanupIdleConnections()
        expect(cleaned).toBe(1)
        expect(mockWs.close).toHaveBeenCalledWith(1000, 'Idle timeout')
        shortTimeoutPool.destroy()
        done()
      }, 100)
    })

    it('should provide accurate performance metrics', () => {
      pool.addConnection('conn1', mockWebSocket as WebSocket, '/api/ws/test')
      pool.removeConnection('conn1')

      const metrics = pool.getPerformanceMetrics()

      expect(metrics).toHaveProperty('connectionRate')
      expect(metrics).toHaveProperty('disconnectionRate')
      expect(metrics).toHaveProperty('messageRate')
    })

    it('should reset metrics', () => {
      pool.addConnection('conn1', mockWebSocket as WebSocket, '/api/ws/test')
      pool.resetMetrics()

      const metrics = pool.getPerformanceMetrics()
      expect(metrics.connectionRate).toBe(0)
    })
  })

  describe('MessageBuffer', () => {
    let buffer: MessageBuffer
    let flushSpy: jest.Mock

    beforeEach(() => {
      flushSpy = jest.fn()
      buffer = new MessageBuffer(3, 100, flushSpy) // 3 messages max, 100ms flush interval
    })

    afterEach(() => {
      buffer.destroy()
    })

    it('should buffer messages', () => {
      buffer.add('message1')
      buffer.add('message2')

      const stats = buffer.getStats()
      expect(stats.buffered).toBe(2)
    })

    it('should flush when buffer is full', () => {
      buffer.add('message1')
      buffer.add('message2')
      buffer.add('message3') // This should trigger flush

      expect(flushSpy).toHaveBeenCalledWith([
        'message1',
        'message2',
        'message3',
      ])

      const stats = buffer.getStats()
      expect(stats.buffered).toBe(0)
    })

    it('should flush on timer', (done) => {
      buffer.add('message1')

      // Should flush after timer
      setTimeout(() => {
        expect(flushSpy).toHaveBeenCalledWith(['message1'])
        done()
      }, 150)
    })

    it('should handle manual flush', () => {
      buffer.add('message1')
      buffer.add('message2')

      buffer.flush()

      expect(flushSpy).toHaveBeenCalledWith(['message1', 'message2'])

      const stats = buffer.getStats()
      expect(stats.buffered).toBe(0)
    })
  })

  describe('WebSocketMemoryManager', () => {
    let memoryManager: WebSocketMemoryManager

    beforeEach(() => {
      memoryManager = new WebSocketMemoryManager({
        warning: 50, // Lower thresholds for testing
        critical: 70,
        maximum: 90,
      })
    })

    afterEach(() => {
      memoryManager.destroy()
    })

    it('should get memory statistics', () => {
      const stats = memoryManager.getMemoryStats()

      expect(stats).toHaveProperty('heapUsed')
      expect(stats).toHaveProperty('heapTotal')
      expect(stats).toHaveProperty('percentage')
      expect(stats).toHaveProperty('connectionCount')
      expect(typeof stats.percentage).toBe('number')
    })

    it('should check if memory usage is acceptable', () => {
      const acceptable = memoryManager.isMemoryUsageAcceptable()
      expect(typeof acceptable).toBe('boolean')
    })

    it('should register custom cleanup strategies', () => {
      const customStrategy = {
        name: 'Custom Cleanup',
        priority: 5,
        execute: jest.fn().mockResolvedValue(1024),
      }

      memoryManager.registerCleanupStrategy(customStrategy)

      // Should be able to execute cleanup
      expect(() => memoryManager.executeCleanup(true)).not.toThrow()
    })

    it('should generate memory report', () => {
      const report = memoryManager.generateMemoryReport()

      expect(report).toHaveProperty('timestamp')
      expect(report).toHaveProperty('memoryUsage')
      expect(report).toHaveProperty('connections')
      expect(report).toHaveProperty('thresholds')
      expect(report).toHaveProperty('cleanupStrategies')
    })

    it('should provide optimization recommendations', () => {
      const recommendations = memoryManager.getOptimizationRecommendations()

      expect(Array.isArray(recommendations)).toBe(true)
    })

    it('should execute cleanup when forced', async () => {
      const freed = await memoryManager.executeCleanup(true)

      expect(typeof freed).toBe('number')
      expect(freed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Global Instances', () => {
    it('should provide singleton connection pool', () => {
      const pool1 = getConnectionPool()
      const pool2 = getConnectionPool()

      expect(pool1).toBe(pool2) // Same instance
    })

    it('should allow custom connection pool initialization', () => {
      const customPool = initializeConnectionPool(50, 10000)
      const retrievedPool = getConnectionPool()

      expect(customPool).toBe(retrievedPool)

      customPool.destroy()
    })

    it('should provide singleton memory manager', () => {
      const manager1 = getMemoryManager()
      const manager2 = getMemoryManager()

      expect(manager1).toBe(manager2) // Same instance

      manager1.destroy()
    })
  })
})
