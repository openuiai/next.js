/**
 * Unit tests for WebSocket configuration system
 */

import {
  mergeWebSocketConfig,
  validateWebSocketConfig,
  getRouteConfig,
  loadWebSocketConfig,
  getWebSocketServerOptions,
  DEFAULT_WEBSOCKET_CONFIG,
} from '../../packages/next/src/server/websocket/config'

describe('WebSocket Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('mergeWebSocketConfig', () => {
    it('should return default config when no user config provided', () => {
      const config = mergeWebSocketConfig()
      expect(config).toEqual(DEFAULT_WEBSOCKET_CONFIG)
    })

    it('should merge user config with defaults', () => {
      const userConfig = {
        enabled: false,
        maxConnections: 500,
        security: {
          maxPayloadSize: 2048,
        },
      }

      const config = mergeWebSocketConfig(userConfig)

      expect(config.enabled).toBe(false)
      expect(config.maxConnections).toBe(500)
      expect(config.timeout).toBe(DEFAULT_WEBSOCKET_CONFIG.timeout) // Default
      expect(config.security.maxPayloadSize).toBe(2048)
      expect(config.security.origins).toBe(
        DEFAULT_WEBSOCKET_CONFIG.security.origins
      ) // Default
    })

    it('should handle nested configuration merging', () => {
      const userConfig = {
        performance: {
          perMessageDeflate: {
            threshold: 2048,
          },
          keepAlive: {
            enabled: false,
          },
        },
      }

      const config = mergeWebSocketConfig(userConfig)

      expect(config.performance.perMessageDeflate.threshold).toBe(2048)
      expect(config.performance.perMessageDeflate.serverMaxWindowBits).toBe(
        DEFAULT_WEBSOCKET_CONFIG.performance.perMessageDeflate
          .serverMaxWindowBits
      )
      expect(config.performance.keepAlive.enabled).toBe(false)
      expect(config.performance.keepAlive.interval).toBe(
        DEFAULT_WEBSOCKET_CONFIG.performance.keepAlive.interval
      )
    })

    it('should handle boolean perMessageDeflate', () => {
      const userConfig = {
        performance: {
          perMessageDeflate: false,
        },
      }

      const config = mergeWebSocketConfig(userConfig)
      expect(config.performance.perMessageDeflate).toBe(false)
    })
  })

  describe('validateWebSocketConfig', () => {
    it('should return no errors for valid config', () => {
      const config = {
        enabled: true,
        maxConnections: 1000,
        timeout: 30000,
        security: {
          maxPayloadSize: 1024 * 1024,
        },
        circuitBreaker: {
          failureThreshold: 5,
          resetTimeout: 60000,
          monitoringWindow: 300000,
          successThreshold: 3,
        },
      }

      const errors = validateWebSocketConfig(config)
      expect(errors).toEqual([])
    })

    it('should return errors for invalid global config', () => {
      const config = {
        maxConnections: -1,
        timeout: 500,
        security: {
          maxPayloadSize: 0,
        },
        circuitBreaker: {
          failureThreshold: 0,
          resetTimeout: 500,
        },
      }

      const errors = validateWebSocketConfig(config)

      expect(errors).toContain('maxConnections must be greater than 0')
      expect(errors).toContain('timeout must be at least 1000ms')
      expect(errors).toContain('security.maxPayloadSize must be greater than 0')
      expect(errors).toContain(
        'circuitBreaker.failureThreshold must be greater than 0'
      )
      expect(errors).toContain(
        'circuitBreaker.resetTimeout must be at least 1000ms'
      )
    })

    it('should validate route-specific configurations', () => {
      const config = {
        routes: {
          '/api/ws/chat': {
            maxConnections: -1,
            timeout: 500,
            rateLimit: {
              windowMs: -1,
              maxRequests: 0,
            },
          },
        },
      }

      const errors = validateWebSocketConfig(config)

      expect(errors).toContain(
        'routes./api/ws/chat.maxConnections must be greater than 0'
      )
      expect(errors).toContain(
        'routes./api/ws/chat.timeout must be at least 1000ms'
      )
      expect(errors).toContain(
        'routes./api/ws/chat.rateLimit.windowMs must be greater than 0'
      )
      expect(errors).toContain(
        'routes./api/ws/chat.rateLimit.maxRequests must be greater than 0'
      )
    })
  })

  describe('getRouteConfig', () => {
    it('should return global config for routes without overrides', () => {
      const globalConfig = mergeWebSocketConfig({
        maxConnections: 500,
        timeout: 15000,
        compression: false,
      })

      const routeConfig = getRouteConfig(globalConfig, '/api/ws/test')

      expect(routeConfig.maxConnections).toBe(500)
      expect(routeConfig.timeout).toBe(15000)
      expect(routeConfig.compression).toBe(false)
      expect(routeConfig.rateLimit).toBeUndefined()
    })

    it('should merge route-specific overrides with global config', () => {
      const globalConfig = mergeWebSocketConfig({
        maxConnections: 500,
        timeout: 15000,
        compression: false,
        routes: {
          '/api/ws/chat': {
            maxConnections: 100,
            rateLimit: {
              windowMs: 60000,
              maxRequests: 30,
            },
          },
        },
      })

      const routeConfig = getRouteConfig(globalConfig, '/api/ws/chat')

      expect(routeConfig.maxConnections).toBe(100)
      expect(routeConfig.timeout).toBe(15000) // Global fallback
      expect(routeConfig.compression).toBe(false) // Global fallback
      expect(routeConfig.rateLimit).toEqual({
        windowMs: 60000,
        maxRequests: 30,
      })
    })
  })

  describe('loadWebSocketConfig', () => {
    it('should load configuration from environment variables', () => {
      process.env.NEXT_WEBSOCKET_ENABLED = 'false'
      process.env.NEXT_WEBSOCKET_MAX_CONNECTIONS = '250'
      process.env.NEXT_WEBSOCKET_TIMEOUT = '45000'
      process.env.NEXT_WEBSOCKET_COMPRESSION = 'false'
      process.env.NEXT_WEBSOCKET_MAX_PAYLOAD_SIZE = '2048'
      process.env.NEXT_WEBSOCKET_METRICS = 'true'

      const config = loadWebSocketConfig()

      expect(config.enabled).toBe(false)
      expect(config.maxConnections).toBe(250)
      expect(config.timeout).toBe(45000)
      expect(config.compression).toBe(false)
      expect(config.security?.maxPayloadSize).toBe(2048)
      expect(config.monitoring?.metrics).toBe(true)
    })

    it('should load configuration from Next.js config', () => {
      const nextConfig = {
        experimental: {
          websocket: {
            enabled: true,
            maxConnections: 750,
            security: {
              origins: ['https://example.com'],
              maxPayloadSize: 4096,
            },
          },
        },
      }

      const config = loadWebSocketConfig(nextConfig)

      expect(config.enabled).toBe(true)
      expect(config.maxConnections).toBe(750)
      expect(config.security?.origins).toEqual(['https://example.com'])
      expect(config.security?.maxPayloadSize).toBe(4096)
    })

    it('should prioritize environment variables over Next.js config', () => {
      process.env.NEXT_WEBSOCKET_MAX_CONNECTIONS = '999'

      const nextConfig = {
        experimental: {
          websocket: {
            maxConnections: 500,
          },
        },
      }

      const config = loadWebSocketConfig(nextConfig)

      expect(config.maxConnections).toBe(999) // From environment
    })

    it('should handle invalid environment variables gracefully', () => {
      process.env.NEXT_WEBSOCKET_MAX_CONNECTIONS = 'not-a-number'
      process.env.NEXT_WEBSOCKET_TIMEOUT = 'invalid'

      const config = loadWebSocketConfig()

      // Should not include invalid values
      expect(config.maxConnections).toBeUndefined()
      expect(config.timeout).toBeUndefined()
    })
  })

  describe('getWebSocketServerOptions', () => {
    it('should generate correct WebSocket server options', () => {
      const config = mergeWebSocketConfig({
        performance: {
          perMessageDeflate: {
            threshold: 2048,
            serverMaxWindowBits: 13,
          },
          backlog: 256,
        },
        security: {
          maxPayloadSize: 2048,
          verifyClient: (info: any) => true,
        },
      })

      const options = getWebSocketServerOptions(config)

      expect(options.noServer).toBe(true)
      expect(options.perMessageDeflate).toEqual({
        threshold: 2048,
        serverMaxWindowBits: 13,
        serverMaxNoContextTakeover: false,
      })
      expect(options.maxPayload).toBe(2048)
      expect(options.backlog).toBe(256)
      expect(typeof options.verifyClient).toBe('function')
    })

    it('should handle boolean perMessageDeflate', () => {
      const config = mergeWebSocketConfig({
        performance: {
          perMessageDeflate: false,
        },
      })

      const options = getWebSocketServerOptions(config)

      expect(options.perMessageDeflate).toBe(false)
    })

    it('should omit undefined options', () => {
      const config = mergeWebSocketConfig({
        security: {},
        performance: {
          perMessageDeflate: undefined,
        },
      })

      const options = getWebSocketServerOptions(config)

      expect(options.noServer).toBe(true)
      expect(options).not.toHaveProperty('maxPayload')
      expect(options).not.toHaveProperty('verifyClient')
      expect(options).not.toHaveProperty('backlog')
    })
  })
})
