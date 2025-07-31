/**
 * Unit tests for WebSocket logger
 */

import { WebSocketLogger } from '../../packages/next/src/server/websocket/logger'

describe('WebSocketLogger', () => {
  let originalEnv: NodeJS.ProcessEnv
  let consoleSpies: {
    error: jest.SpyInstance
    warn: jest.SpyInstance
    info: jest.SpyInstance
    log: jest.SpyInstance
  }

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env }

    // Mock console methods
    consoleSpies = {
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
      log: jest.spyOn(console, 'log').mockImplementation(),
    }
  })

  afterEach(() => {
    // Restore environment
    process.env = originalEnv

    // Restore console methods
    Object.values(consoleSpies).forEach((spy) => spy.mockRestore())

    // Clear singleton instance
    // @ts-ignore - accessing private property for testing
    WebSocketLogger.instance = undefined
  })

  describe('Log Level Configuration', () => {
    it('should default to warn level in production', () => {
      process.env.NODE_ENV = 'production'
      const logger = WebSocketLogger.getInstance()

      logger.error('error message')
      logger.warn('warn message')
      logger.info('info message')
      logger.debug('debug message')

      expect(consoleSpies.error).toHaveBeenCalledTimes(1)
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1)
      expect(consoleSpies.info).not.toHaveBeenCalled()
      expect(consoleSpies.log).not.toHaveBeenCalled()
    })

    it('should default to info level in development', () => {
      process.env.NODE_ENV = 'development'
      const logger = WebSocketLogger.getInstance()

      logger.error('error message')
      logger.warn('warn message')
      logger.info('info message')
      logger.debug('debug message')

      expect(consoleSpies.error).toHaveBeenCalledTimes(1)
      expect(consoleSpies.warn).toHaveBeenCalledTimes(1)
      expect(consoleSpies.info).toHaveBeenCalledTimes(1)
      expect(consoleSpies.log).not.toHaveBeenCalled()
    })

    it('should respect NEXT_WEBSOCKET_DEBUG=true', () => {
      process.env.NODE_ENV = 'production'
      process.env.NEXT_WEBSOCKET_DEBUG = 'true'
      const logger = WebSocketLogger.getInstance()

      logger.debug('debug message')

      expect(consoleSpies.log).toHaveBeenCalledTimes(1)
    })

    it('should respect NEXT_WEBSOCKET_LOG_LEVEL', () => {
      process.env.NEXT_WEBSOCKET_LOG_LEVEL = 'error'
      const logger = WebSocketLogger.getInstance()

      logger.error('error message')
      logger.warn('warn message')
      logger.info('info message')
      logger.debug('debug message')

      expect(consoleSpies.error).toHaveBeenCalledTimes(1)
      expect(consoleSpies.warn).not.toHaveBeenCalled()
      expect(consoleSpies.info).not.toHaveBeenCalled()
      expect(consoleSpies.log).not.toHaveBeenCalled()
    })
  })

  describe('Message Formatting', () => {
    it('should format messages with timestamp and level', () => {
      process.env.NODE_ENV = 'development'
      const logger = WebSocketLogger.getInstance()

      logger.info('test message')

      expect(consoleSpies.info).toHaveBeenCalled()
      const call = consoleSpies.info.mock.calls[0]
      expect(call[0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(call[0]).toContain('[Next.js WebSocket]')
      expect(call[0]).toContain('[INFO]')
      expect(call[0]).toContain('test message')
    })
  })

  describe('Special Methods', () => {
    it('should format connection messages', () => {
      process.env.NODE_ENV = 'development'
      const logger = WebSocketLogger.getInstance()

      logger.connection('/api/ws/chat', { remoteAddress: '127.0.0.1' })

      expect(consoleSpies.info).toHaveBeenCalled()
      const call = consoleSpies.info.mock.calls[0]
      expect(call[0]).toContain('Client connected to /api/ws/chat')
    })

    it('should format disconnection messages', () => {
      process.env.NODE_ENV = 'development'
      const logger = WebSocketLogger.getInstance()

      logger.disconnection('/api/ws/chat', 'client closed')

      expect(consoleSpies.info).toHaveBeenCalled()
      const call = consoleSpies.info.mock.calls[0]
      expect(call[0]).toContain(
        'Client disconnected from /api/ws/chat: client closed'
      )
    })

    it('should format upgrade messages', () => {
      process.env.NODE_ENV = 'development'
      process.env.NEXT_WEBSOCKET_DEBUG = 'true'
      const logger = WebSocketLogger.getInstance()

      logger.upgrade('/api/ws/test')

      expect(consoleSpies.log).toHaveBeenCalled()
      const call = consoleSpies.log.mock.calls[0]
      expect(call[0]).toContain('Upgrade request received for /api/ws/test')
    })

    it('should format route resolution messages', () => {
      process.env.NODE_ENV = 'development'
      process.env.NEXT_WEBSOCKET_DEBUG = 'true'
      const logger = WebSocketLogger.getInstance()

      logger.routeResolved('/api/ws/[id]', 'app/api/ws/[id]/route')

      expect(consoleSpies.log).toHaveBeenCalled()
      const call = consoleSpies.log.mock.calls[0]
      expect(call[0]).toContain(
        'Route resolved: /api/ws/[id] -> app/api/ws/[id]/route'
      )
    })
  })

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = WebSocketLogger.getInstance()
      const instance2 = WebSocketLogger.getInstance()

      expect(instance1).toBe(instance2)
    })
  })
})
