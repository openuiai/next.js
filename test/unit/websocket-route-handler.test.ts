/**
 * Unit tests for WebSocket route handler functionality
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import {
  getSocketHandler,
  getOrInitializeConnectionHandler,
  clearConnectionHandlerCache,
} from '../../packages/next/src/server/websocket/route-handler'
import type {
  SocketHandler,
  ConnectionHandler,
  RouteModuleWithPossibleSocketHandler,
} from '../../packages/next/src/server/websocket/types'

// Mock the logger
jest.mock('../../packages/next/src/server/websocket/logger', () => ({
  wsLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}))

describe('WebSocket Route Handler', () => {
  let mockWsServer: WebSocketServer
  let mockClient: WebSocket
  let mockRequest: IncomingMessage

  beforeEach(() => {
    clearConnectionHandlerCache()

    // Create mock WebSocket server
    mockWsServer = new WebSocketServer({ noServer: true })

    // Create mock client
    mockClient = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
    } as any

    // Create mock request
    mockRequest = {
      headers: {},
      url: '/api/websocket/test',
    } as any
  })

  afterEach(() => {
    clearConnectionHandlerCache()
    jest.clearAllMocks()
  })

  describe('getSocketHandler', () => {
    it('should extract SOCKET handler from routeModule.userland', async () => {
      const mockHandler: SocketHandler = jest.fn()
      const routeModule: RouteModuleWithPossibleSocketHandler = {
        routeModule: {
          userland: {
            SOCKET: mockHandler,
          },
        },
      }

      const result = await getSocketHandler(routeModule)
      expect(result).toBe(mockHandler)
    })

    it('should extract SOCKET handler from direct export', async () => {
      const mockHandler: SocketHandler = jest.fn()
      const routeModule: RouteModuleWithPossibleSocketHandler = {
        SOCKET: mockHandler,
      }

      const result = await getSocketHandler(routeModule)
      expect(result).toBe(mockHandler)
    })

    it('should extract SOCKET handler from handlers object', async () => {
      const mockHandler: SocketHandler = jest.fn()
      const routeModule: RouteModuleWithPossibleSocketHandler = {
        handlers: {
          SOCKET: mockHandler,
        },
      }

      const result = await getSocketHandler(routeModule)
      expect(result).toBe(mockHandler)
    })

    it('should handle async default exports', async () => {
      const mockHandler: SocketHandler = jest.fn()
      const routeModule: RouteModuleWithPossibleSocketHandler = {
        default: Promise.resolve({
          routeModule: {
            userland: {
              SOCKET: mockHandler,
            },
          },
        }),
      }

      const result = await getSocketHandler(routeModule)
      expect(result).toBe(mockHandler)
    })

    it('should return undefined if no SOCKET handler found', async () => {
      const routeModule: RouteModuleWithPossibleSocketHandler = {
        routeModule: {
          userland: {
            GET: jest.fn(), // Different handler
          },
        },
      }

      const result = await getSocketHandler(routeModule)
      expect(result).toBeUndefined()
    })

    it('should return undefined for null module', async () => {
      const result = await getSocketHandler(null)
      expect(result).toBeUndefined()
    })
  })

  describe('getOrInitializeConnectionHandler', () => {
    it('should initialize connection handler on first call', async () => {
      const mockConnectionHandler: ConnectionHandler = jest.fn()
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler)

      const result = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      expect(mockSocketHandler).toHaveBeenCalledTimes(1)
      expect(mockSocketHandler).toHaveBeenCalledWith(mockWsServer)
      expect(result).toBe(mockConnectionHandler)
    })

    it('should return cached handler on subsequent calls', async () => {
      const mockConnectionHandler: ConnectionHandler = jest.fn()
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler)

      // First call
      const result1 = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      // Second call with same route
      const result2 = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      expect(mockSocketHandler).toHaveBeenCalledTimes(1) // Only called once
      expect(result1).toBe(result2) // Same handler returned
    })

    it('should handle different routes independently', async () => {
      const mockConnectionHandler1: ConnectionHandler = jest.fn()
      const mockConnectionHandler2: ConnectionHandler = jest.fn()
      const mockSocketHandler1: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler1)
      const mockSocketHandler2: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler2)

      const result1 = await getOrInitializeConnectionHandler(
        mockSocketHandler1,
        mockWsServer,
        '/api/websocket/test1',
        {}
      )

      const result2 = await getOrInitializeConnectionHandler(
        mockSocketHandler2,
        mockWsServer,
        '/api/websocket/test2',
        {}
      )

      expect(result1).toBe(mockConnectionHandler1)
      expect(result2).toBe(mockConnectionHandler2)
      expect(mockSocketHandler1).toHaveBeenCalledTimes(1)
      expect(mockSocketHandler2).toHaveBeenCalledTimes(1)
    })

    it('should return null if SOCKET handler returns non-function', async () => {
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockResolvedValue('not a function')

      const result = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      expect(result).toBeNull()
    })

    it('should return null if SOCKET handler throws error', async () => {
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockRejectedValue(new Error('Init failed'))

      const result = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      expect(result).toBeNull()
    })
  })

  describe('WebSocketServer integration', () => {
    it('should work with standard WebSocketServer methods', () => {
      const clients = new Set([mockClient])
      mockWsServer.clients = clients

      // Test that we can access clients directly from WebSocketServer
      expect(mockWsServer.clients).toBe(clients)
      expect(mockWsServer.clients.size).toBe(1)
    })

    it('should allow broadcasting using clients.forEach', () => {
      const clients = new Set([mockClient])
      mockWsServer.clients = clients

      // Simulate broadcasting
      mockWsServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send('Hello world')
        }
      })

      expect(mockClient.send).toHaveBeenCalledWith('Hello world')
    })
  })

  describe('Connection handler pattern', () => {
    it('should call connection handler with client and request', async () => {
      const mockCleanup = jest.fn()
      const mockConnectionHandler: ConnectionHandler = jest
        .fn()
        .mockResolvedValue(mockCleanup)
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler)

      // Initialize handler
      const handler = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      // Call connection handler
      const cleanup = await handler!(mockClient, mockRequest)

      expect(mockConnectionHandler).toHaveBeenCalledWith(
        mockClient,
        mockRequest
      )
      expect(cleanup).toBe(mockCleanup)
    })

    it('should handle connection handler that returns void', async () => {
      const mockConnectionHandler: ConnectionHandler = jest
        .fn()
        .mockResolvedValue(undefined)
      const mockSocketHandler: SocketHandler = jest
        .fn()
        .mockResolvedValue(mockConnectionHandler)

      const handler = await getOrInitializeConnectionHandler(
        mockSocketHandler,
        mockWsServer,
        '/api/websocket/test',
        {}
      )

      const cleanup = await handler!(mockClient, mockRequest)

      expect(mockConnectionHandler).toHaveBeenCalledWith(
        mockClient,
        mockRequest
      )
      expect(cleanup).toBeUndefined()
    })
  })
})
