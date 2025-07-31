/**
 * Unit tests for WebSocket server adapter
 */

import { createServerAdapter } from '../../packages/next/src/server/websocket/server-adapter'

// Mock Next.js server
const createMockServer = (overrides = {}) => ({
  serverOptions: {
    httpServer: { constructor: { name: 'Server' } },
    ...overrides.serverOptions,
  },
  appPathRoutes: {
    '/api/ws': ['/api/ws/route', {}],
    '/api/chat/[id]': ['/api/chat/[id]/route', {}],
    ...overrides.appPathRoutes,
  },
  getPagePath: jest.fn((path) => `/path/to/${path}`),
  renderOpts: {
    dev: false,
    ...overrides.renderOpts,
  },
  nextConfig: {
    experimental: {
      websocket: {
        enabled: true,
        maxConnections: 500,
      },
    },
    ...overrides.nextConfig,
  },
  hotReloader: overrides.hotReloader,
  ensurePage: overrides.ensurePage,
  ...overrides,
})

describe('ServerAdapter', () => {
  describe('createServerAdapter', () => {
    it('should create an adapter with HTTP server access', () => {
      const mockServer = createMockServer()
      const adapter = createServerAdapter(mockServer as any)

      const httpServer = adapter.getHttpServer()
      expect(httpServer).toBeDefined()
      expect(httpServer?.constructor.name).toBe('Server')
    })

    it('should handle missing HTTP server gracefully', () => {
      const mockServer = createMockServer({
        serverOptions: {},
      })
      const adapter = createServerAdapter(mockServer as any)

      const httpServer = adapter.getHttpServer()
      expect(httpServer).toBeUndefined()
    })

    it('should access app routes', () => {
      const mockServer = createMockServer()
      const adapter = createServerAdapter(mockServer as any)

      const routes = adapter.getAppRoutes()
      expect(routes).toBeDefined()
      expect(routes).toHaveProperty('/api/ws')
      expect(routes?.['/api/ws']).toEqual(['/api/ws/route', {}])
    })

    it('should handle missing app routes gracefully', () => {
      const mockServer = createMockServer({
        appPathRoutes: null,
      })
      const adapter = createServerAdapter(mockServer as any)

      const routes = adapter.getAppRoutes()
      expect(routes).toBeNull()
    })

    it('should resolve page paths', () => {
      const mockServer = createMockServer()
      const adapter = createServerAdapter(mockServer as any)

      const path = adapter.resolvePagePath('/api/ws/route')
      expect(path).toBe('/path/to//api/ws/route')
      expect(mockServer.getPagePath).toHaveBeenCalledWith('/api/ws/route')
    })

    it('should handle page path resolution errors', () => {
      const mockServer = createMockServer({
        getPagePath: jest.fn(() => {
          throw new Error('Path not found')
        }),
      })
      const adapter = createServerAdapter(mockServer as any)

      const path = adapter.resolvePagePath('/invalid/path')
      expect(path).toBeUndefined()
    })

    it('should detect development mode', () => {
      const devServer = createMockServer({
        renderOpts: { dev: true },
      })
      const prodServer = createMockServer({
        renderOpts: { dev: false },
      })

      const devAdapter = createServerAdapter(devServer as any)
      const prodAdapter = createServerAdapter(prodServer as any)

      expect(devAdapter.isDevelopment()).toBe(true)
      expect(prodAdapter.isDevelopment()).toBe(false)
    })

    it('should handle ensurePage in development', async () => {
      const mockEnsurePage = jest.fn().mockResolvedValue(undefined)
      const mockServer = createMockServer({
        ensurePage: mockEnsurePage,
        renderOpts: { dev: true },
      })
      const adapter = createServerAdapter(mockServer as any)

      await adapter.ensurePage?.('/api/ws/route')

      expect(mockEnsurePage).toHaveBeenCalledWith({
        page: '/api/ws/route',
        clientOnly: false,
      })
    })

    it('should handle ensurePage with hot reloader', async () => {
      const mockHotReloaderEnsurePage = jest.fn().mockResolvedValue(undefined)
      const mockServer = createMockServer({
        hotReloader: {
          ensurePage: mockHotReloaderEnsurePage,
        },
        renderOpts: { dev: true },
      })
      const adapter = createServerAdapter(mockServer as any)

      await adapter.ensurePage?.('/api/ws/route')

      expect(mockHotReloaderEnsurePage).toHaveBeenCalledWith({
        page: '/api/ws/route',
        clientOnly: false,
      })
    })

    it('should handle ensurePage errors gracefully', async () => {
      const mockEnsurePage = jest
        .fn()
        .mockRejectedValue(new Error('Ensure failed'))
      const mockServer = createMockServer({
        ensurePage: mockEnsurePage,
      })
      const adapter = createServerAdapter(mockServer as any)

      // Should not throw
      await expect(
        adapter.ensurePage?.('/api/ws/route')
      ).resolves.toBeUndefined()
    })
  })
})
