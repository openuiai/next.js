// WebSocket support for Next.js
//
// This module provides WebSocket functionality for Next.js applications,
// allowing API routes to handle WebSocket connections by exporting a SOCKET handler.

// Core setup function
export { setupWebSocketServer } from './setup'

// Types
export type { SocketHandler, OnSocketClose, ConnectionHandler } from './types'
export type { ServerAdapter } from './server-adapter'
export type {
  WebSocketConfig,
  WebSocketSecurityConfig,
  WebSocketPerformanceConfig,
  WebSocketMonitoringConfig,
  WebSocketRouteConfig,
} from './config'

// Utilities for advanced usage
export { resolveWebSocketRoute, isWebSocketSupported } from './route-resolver'
export { createServerAdapter, getWebSocketConfig } from './server-adapter'
export { getConnectionTracker, ConnectionTracker } from './connection-tracker'
export { GracefulWebSocketHandler } from './graceful-handler'
export {
  circuitBreakerManager,
  RouteCircuitBreaker,
  CircuitState,
} from './circuit-breaker'

// Configuration and monitoring
export {
  loadWebSocketConfig,
  mergeWebSocketConfig,
  validateWebSocketConfig,
  getRouteConfig,
  getWebSocketServerOptions,
} from './config'
export {
  WebSocketHealthMonitor,
  getHealthMonitor,
  initializeHealthMonitor,
  setupHealthCheckEndpoint,
} from './health-check'
export {
  WebSocketRateLimiter,
  RouteRateLimiterManager,
  rateLimiterManager,
} from './rate-limiter'

// Performance and memory management
export {
  WebSocketConnectionPool,
  MessageBuffer,
  getConnectionPool,
  initializeConnectionPool,
} from './performance'
export {
  WebSocketMemoryManager,
  getMemoryManager,
  initializeMemoryManager,
} from './memory-manager'
export type { ConnectionPoolStats, PerformanceMetrics } from './performance'
export type {
  MemoryThresholds,
  MemoryStats,
  CleanupStrategy,
} from './memory-manager'

// Error handling
export {
  WebSocketError,
  RouteNotFoundError,
  HandlerNotFoundError,
  ModuleImportError,
  ServerNotAvailableError,
  ConnectionLimitError,
  HandlerExecutionError,
  isWebSocketError,
  getErrorStatusCode,
  getSafeErrorMessage,
  getRecoveryStrategy,
  RecoveryStrategy,
} from './errors'

// Re-export WebSocket types for convenience
export type { WebSocket, WebSocketServer } from 'ws'

// Connection handler management
export {
  getOrInitializeConnectionHandler,
  clearConnectionHandlerCache,
} from './route-handler'
