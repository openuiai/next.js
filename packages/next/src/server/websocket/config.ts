// Comprehensive configuration system for Next.js WebSocket support

import type { VerifyClientCallbackAsync, VerifyClientCallbackSync } from 'ws'
import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:config')

export interface WebSocketRouteConfig {
  /** Maximum number of connections for this specific route */
  maxConnections?: number
  /** Connection timeout in milliseconds for this route */
  timeout?: number
  /** Whether to enable compression for this route */
  compression?: boolean
  /** Custom rate limiting for this route */
  rateLimit?: {
    windowMs: number
    maxRequests: number
  }
}

export interface WebSocketSecurityConfig {
  /** CORS origins allowed for WebSocket connections */
  origins?: string[] | ((origin: string) => boolean)
  /** Custom client verification function */
  verifyClient?: VerifyClientCallbackSync | VerifyClientCallbackAsync
  /** Maximum payload size in bytes */
  maxPayloadSize?: number
  /** Whether to validate Sec-WebSocket-Protocol header */
  validateProtocol?: boolean
  /** Allowed WebSocket protocols */
  allowedProtocols?: string[]
}

export interface WebSocketPerformanceConfig {
  /** Enable per-message-deflate compression */
  perMessageDeflate?:
    | boolean
    | {
        /** Compression threshold in bytes */
        threshold?: number
        /** Maximum window bits */
        serverMaxWindowBits?: number
        /** Maximum no context takeover */
        serverMaxNoContextTakeover?: boolean
      }
  /** TCP backlog size */
  backlog?: number
  /** Keep-alive settings */
  keepAlive?: {
    enabled: boolean
    initialDelay: number
    interval: number
    probes: number
  }
}

export interface WebSocketMonitoringConfig {
  /** Enable connection metrics collection */
  metrics?: boolean
  /** Enable detailed request/response logging */
  detailedLogging?: boolean
  /** Health check endpoint configuration */
  healthCheck?: {
    enabled: boolean
    path: string
    interval: number
  }
}

export interface WebSocketConfig {
  /** Whether WebSocket support is enabled globally */
  enabled?: boolean

  /** Global connection limits */
  maxConnections?: number

  /** Global connection timeout in milliseconds */
  timeout?: number

  /** Global compression settings */
  compression?: boolean

  /** Security configuration */
  security?: WebSocketSecurityConfig

  /** Performance tuning options */
  performance?: WebSocketPerformanceConfig

  /** Monitoring and observability */
  monitoring?: WebSocketMonitoringConfig

  /** Per-route configuration overrides */
  routes?: Record<string, WebSocketRouteConfig>

  /** Circuit breaker configuration */
  circuitBreaker?: {
    failureThreshold: number
    resetTimeout: number
    monitoringWindow: number
    successThreshold: number
  }
}

// Default WebSocket configuration
export const DEFAULT_WEBSOCKET_CONFIG: Required<WebSocketConfig> = {
  enabled: true,
  maxConnections: 1000,
  timeout: 30000, // 30 seconds
  compression: true,

  security: {
    origins: ['*'],
    maxPayloadSize: 1024 * 1024, // 1MB
    validateProtocol: false,
    allowedProtocols: [],
  },

  performance: {
    perMessageDeflate: {
      threshold: 1024,
      serverMaxWindowBits: 15,
      serverMaxNoContextTakeover: false,
    },
    backlog: 511,
    keepAlive: {
      enabled: true,
      initialDelay: 0,
      interval: 30000,
      probes: 9,
    },
  },

  monitoring: {
    metrics: false,
    detailedLogging: false,
    healthCheck: {
      enabled: false,
      path: '/_next/websocket/health',
      interval: 30000,
    },
  },

  routes: {},

  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000,
    monitoringWindow: 300000,
    successThreshold: 3,
  },
}

// Merge user configuration with defaults
export function mergeWebSocketConfig(
  userConfig: WebSocketConfig = {}
): Required<WebSocketConfig> {
  return {
    enabled: userConfig.enabled ?? DEFAULT_WEBSOCKET_CONFIG.enabled,
    maxConnections:
      userConfig.maxConnections ?? DEFAULT_WEBSOCKET_CONFIG.maxConnections,
    timeout: userConfig.timeout ?? DEFAULT_WEBSOCKET_CONFIG.timeout,
    compression: userConfig.compression ?? DEFAULT_WEBSOCKET_CONFIG.compression,

    security: {
      ...DEFAULT_WEBSOCKET_CONFIG.security,
      ...userConfig.security,
    },

    performance: {
      ...DEFAULT_WEBSOCKET_CONFIG.performance,
      ...userConfig.performance,
      perMessageDeflate:
        userConfig.performance?.perMessageDeflate !== undefined
          ? typeof userConfig.performance.perMessageDeflate === 'boolean'
            ? userConfig.performance.perMessageDeflate
            : {
                ...(typeof DEFAULT_WEBSOCKET_CONFIG.performance
                  .perMessageDeflate === 'object'
                  ? DEFAULT_WEBSOCKET_CONFIG.performance.perMessageDeflate
                  : {}),
                ...userConfig.performance.perMessageDeflate,
              }
          : DEFAULT_WEBSOCKET_CONFIG.performance.perMessageDeflate,
      keepAlive: userConfig.performance?.keepAlive
        ? {
            ...DEFAULT_WEBSOCKET_CONFIG.performance.keepAlive,
            ...userConfig.performance.keepAlive,
          }
        : DEFAULT_WEBSOCKET_CONFIG.performance.keepAlive,
    },

    monitoring: {
      ...DEFAULT_WEBSOCKET_CONFIG.monitoring,
      ...userConfig.monitoring,
      healthCheck: userConfig.monitoring?.healthCheck
        ? {
            ...DEFAULT_WEBSOCKET_CONFIG.monitoring.healthCheck,
            ...userConfig.monitoring.healthCheck,
          }
        : DEFAULT_WEBSOCKET_CONFIG.monitoring.healthCheck,
    },

    routes: {
      ...DEFAULT_WEBSOCKET_CONFIG.routes,
      ...userConfig.routes,
    },

    circuitBreaker: {
      ...DEFAULT_WEBSOCKET_CONFIG.circuitBreaker,
      ...userConfig.circuitBreaker,
    },
  }
}

// Get configuration for a specific route
export function getRouteConfig(
  globalConfig: Required<WebSocketConfig>,
  routePath: string
): WebSocketRouteConfig &
  Pick<WebSocketConfig, 'maxConnections' | 'timeout' | 'compression'> {
  const routeSpecific = globalConfig.routes[routePath] || {}

  return {
    maxConnections: routeSpecific.maxConnections ?? globalConfig.maxConnections,
    timeout: routeSpecific.timeout ?? globalConfig.timeout,
    compression: routeSpecific.compression ?? globalConfig.compression,
    rateLimit: routeSpecific.rateLimit,
  }
}

// Validate WebSocket configuration
export function validateWebSocketConfig(config: WebSocketConfig): string[] {
  const errors: string[] = []

  if (config.maxConnections !== undefined && config.maxConnections <= 0) {
    errors.push('maxConnections must be greater than 0')
  }

  if (config.timeout !== undefined && config.timeout < 1000) {
    errors.push('timeout must be at least 1000ms')
  }

  if (
    config.security?.maxPayloadSize !== undefined &&
    config.security.maxPayloadSize <= 0
  ) {
    errors.push('security.maxPayloadSize must be greater than 0')
  }

  if (
    config.circuitBreaker?.failureThreshold !== undefined &&
    config.circuitBreaker.failureThreshold <= 0
  ) {
    errors.push('circuitBreaker.failureThreshold must be greater than 0')
  }

  if (
    config.circuitBreaker?.resetTimeout !== undefined &&
    config.circuitBreaker.resetTimeout < 1000
  ) {
    errors.push('circuitBreaker.resetTimeout must be at least 1000ms')
  }

  // Validate route-specific configurations
  for (const [routePath, routeConfig] of Object.entries(config.routes || {})) {
    if (
      routeConfig.maxConnections !== undefined &&
      routeConfig.maxConnections <= 0
    ) {
      errors.push(`routes.${routePath}.maxConnections must be greater than 0`)
    }

    if (routeConfig.timeout !== undefined && routeConfig.timeout < 1000) {
      errors.push(`routes.${routePath}.timeout must be at least 1000ms`)
    }

    if (routeConfig.rateLimit) {
      if (routeConfig.rateLimit.windowMs <= 0) {
        errors.push(
          `routes.${routePath}.rateLimit.windowMs must be greater than 0`
        )
      }
      if (routeConfig.rateLimit.maxRequests <= 0) {
        errors.push(
          `routes.${routePath}.rateLimit.maxRequests must be greater than 0`
        )
      }
    }
  }

  return errors
}

// Load WebSocket configuration from environment variables and Next.js config
export function loadWebSocketConfig(nextConfig?: any): WebSocketConfig {
  const envConfig: WebSocketConfig = {}

  // Load from environment variables
  if (process.env.NEXT_WEBSOCKET_ENABLED !== undefined) {
    envConfig.enabled = process.env.NEXT_WEBSOCKET_ENABLED === 'true'
  }

  if (process.env.NEXT_WEBSOCKET_MAX_CONNECTIONS) {
    const maxConnections = parseInt(
      process.env.NEXT_WEBSOCKET_MAX_CONNECTIONS,
      10
    )
    if (!isNaN(maxConnections)) {
      envConfig.maxConnections = maxConnections
    }
  }

  if (process.env.NEXT_WEBSOCKET_TIMEOUT) {
    const timeout = parseInt(process.env.NEXT_WEBSOCKET_TIMEOUT, 10)
    if (!isNaN(timeout)) {
      envConfig.timeout = timeout
    }
  }

  if (process.env.NEXT_WEBSOCKET_COMPRESSION !== undefined) {
    envConfig.compression = process.env.NEXT_WEBSOCKET_COMPRESSION === 'true'
  }

  if (process.env.NEXT_WEBSOCKET_MAX_PAYLOAD_SIZE) {
    const maxPayloadSize = parseInt(
      process.env.NEXT_WEBSOCKET_MAX_PAYLOAD_SIZE,
      10
    )
    if (!isNaN(maxPayloadSize)) {
      envConfig.security = { maxPayloadSize }
    }
  }

  if (process.env.NEXT_WEBSOCKET_METRICS !== undefined) {
    envConfig.monitoring = {
      metrics: process.env.NEXT_WEBSOCKET_METRICS === 'true',
    }
  }

  // Load from Next.js config
  const nextJsConfig = nextConfig?.experimental?.websocket || {}

  // Merge configurations (environment variables take precedence)
  const merged = { ...nextJsConfig, ...envConfig }

  // Validate the configuration
  const errors = validateWebSocketConfig(merged)
  if (errors.length > 0) {
    debug('WebSocket config validation errors:', errors.join(', '))
  }

  return merged
}

// Get WebSocket server options from configuration
export function getWebSocketServerOptions(config: Required<WebSocketConfig>) {
  const options: any = {
    noServer: true,
  }

  if (typeof config.performance.perMessageDeflate === 'boolean') {
    options.perMessageDeflate = config.performance.perMessageDeflate
  } else if (config.performance.perMessageDeflate) {
    options.perMessageDeflate = {
      threshold: config.performance.perMessageDeflate.threshold,
      serverMaxWindowBits:
        config.performance.perMessageDeflate.serverMaxWindowBits,
      serverMaxNoContextTakeover:
        config.performance.perMessageDeflate.serverMaxNoContextTakeover,
    }
  }

  // Only add maxPayload if explicitly configured by user (not just merged defaults)
  if (
    config.security.maxPayloadSize !==
    DEFAULT_WEBSOCKET_CONFIG.security.maxPayloadSize
  ) {
    options.maxPayload = config.security.maxPayloadSize
  }

  if (config.security.verifyClient) {
    options.verifyClient = config.security.verifyClient
  }

  // Only add backlog if explicitly configured by user (not just merged defaults)
  if (
    config.performance.backlog !== DEFAULT_WEBSOCKET_CONFIG.performance.backlog
  ) {
    options.backlog = config.performance.backlog
  }

  return options
}
