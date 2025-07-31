import type { IncomingMessage, ServerResponse } from 'http'
import type { WebSocketServer } from 'ws'

import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:health-check')
import { circuitBreakerManager } from './circuit-breaker'
import type { WebSocketConfig } from './config'

export interface WebSocketHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: number
  uptime: number
  connections: {
    active: number
    total: number
    max: number
  }
  circuitBreakers: Record<
    string,
    {
      state: string
      failures: number
      successes: number
    }
  >
  memory: {
    used: number
    total: number
    percentage: number
  }
  errors?: string[]
}

export interface WebSocketMetrics {
  connectionsOpened: number
  connectionsClosed: number
  messagesReceived: number
  messagesSent: number
  errorsOccurred: number
  upgradeRequests: number
  upgradeFailures: number
  averageConnectionDuration: number
  peakConnections: number
  lastResetTime: number
}

// WebSocket health and metrics collector
export class WebSocketHealthMonitor {
  private startTime = Date.now()
  private activeConnections = new Set<string>()
  private metrics: WebSocketMetrics = {
    connectionsOpened: 0,
    connectionsClosed: 0,
    messagesReceived: 0,
    messagesSent: 0,
    errorsOccurred: 0,
    upgradeRequests: 0,
    upgradeFailures: 0,
    averageConnectionDuration: 0,
    peakConnections: 0,
    lastResetTime: Date.now(),
  }
  private connectionDurations: number[] = []

  constructor(
    private config: Required<WebSocketConfig>,
    private wsServer?: WebSocketServer
  ) {}

  // Record a new connection
  recordConnection(connectionId: string): void {
    this.activeConnections.add(connectionId)
    this.metrics.connectionsOpened++

    if (this.activeConnections.size > this.metrics.peakConnections) {
      this.metrics.peakConnections = this.activeConnections.size
    }

    debug(
      'connection recorded:',
      connectionId,
      'active:',
      this.activeConnections.size
    )
  }

  // Record a connection closure
  recordDisconnection(connectionId: string, duration?: number): void {
    this.activeConnections.delete(connectionId)
    this.metrics.connectionsClosed++

    if (duration) {
      this.connectionDurations.push(duration)
      // Keep only recent durations for average calculation
      if (this.connectionDurations.length > 1000) {
        this.connectionDurations = this.connectionDurations.slice(-500)
      }

      this.metrics.averageConnectionDuration =
        this.connectionDurations.reduce((a, b) => a + b, 0) /
        this.connectionDurations.length
    }

    debug(
      'disconnection recorded:',
      connectionId,
      'active:',
      this.activeConnections.size
    )
  }

  // Record an upgrade request
  recordUpgradeRequest(success: boolean): void {
    this.metrics.upgradeRequests++
    if (!success) {
      this.metrics.upgradeFailures++
    }
  }

  // Record a message event
  recordMessage(direction: 'received' | 'sent'): void {
    if (direction === 'received') {
      this.metrics.messagesReceived++
    } else {
      this.metrics.messagesSent++
    }
  }

  // Record an error
  recordError(): void {
    this.metrics.errorsOccurred++
  }

  // Get current health status
  getHealthStatus(): WebSocketHealthStatus {
    const now = Date.now()
    const uptime = now - this.startTime
    const memoryUsage = process.memoryUsage()
    const circuitBreakerStats = circuitBreakerManager.getAllStats()

    const errors: string[] = []
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

    // Check for unhealthy conditions
    const failureRate =
      this.metrics.upgradeRequests > 0
        ? this.metrics.upgradeFailures / this.metrics.upgradeRequests
        : 0

    if (failureRate > 0.5) {
      errors.push(
        `High upgrade failure rate: ${(failureRate * 100).toFixed(1)}%`
      )
      status = 'unhealthy'
    } else if (failureRate > 0.2) {
      errors.push(
        `Elevated upgrade failure rate: ${(failureRate * 100).toFixed(1)}%`
      )
      status = 'degraded'
    }

    // Check memory usage
    const memoryPercentage =
      (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
    if (memoryPercentage > 90) {
      errors.push(`High memory usage: ${memoryPercentage.toFixed(1)}%`)
      status = 'unhealthy'
    } else if (memoryPercentage > 80) {
      errors.push(`Elevated memory usage: ${memoryPercentage.toFixed(1)}%`)
      if (status === 'healthy') status = 'degraded'
    }

    // Check circuit breakers
    const openCircuits = Object.entries(circuitBreakerStats).filter(
      ([, stats]) => stats.state === 'open'
    )

    if (openCircuits.length > 0) {
      errors.push(`${openCircuits.length} circuit breaker(s) open`)
      if (status === 'healthy') status = 'degraded'
    }

    // Check connection limits
    if (this.activeConnections.size >= this.config.maxConnections * 0.9) {
      errors.push(
        `Near connection limit: ${this.activeConnections.size}/${this.config.maxConnections}`
      )
      if (status === 'healthy') status = 'degraded'
    }

    return {
      status,
      timestamp: now,
      uptime,
      connections: {
        active: this.activeConnections.size,
        total: this.metrics.connectionsOpened,
        max: this.config.maxConnections,
      },
      circuitBreakers: Object.fromEntries(
        Object.entries(circuitBreakerStats).map(([route, stats]) => [
          route,
          {
            state: stats.state,
            failures: stats.failures,
            successes: stats.successes,
          },
        ])
      ),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: memoryPercentage,
      },
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  // Get current metrics
  getMetrics(): WebSocketMetrics {
    return { ...this.metrics }
  }

  // Reset metrics (useful for periodic reporting)
  resetMetrics(): void {
    this.metrics = {
      connectionsOpened: 0,
      connectionsClosed: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errorsOccurred: 0,
      upgradeRequests: 0,
      upgradeFailures: 0,
      averageConnectionDuration: this.metrics.averageConnectionDuration,
      peakConnections: this.activeConnections.size, // Current becomes new baseline
      lastResetTime: Date.now(),
    }
    this.connectionDurations = []
    debug('metrics reset')
  }

  // Handle health check HTTP request
  handleHealthCheck(req: IncomingMessage, res: ServerResponse): void {
    const health = this.getHealthStatus()
    const statusCode =
      health.status === 'healthy'
        ? 200
        : health.status === 'degraded'
          ? 200
          : 503

    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-cache')

    res.end(JSON.stringify(health, null, 2))

    debug('health check response:', health.status, statusCode)
  }

  // Handle metrics HTTP request
  handleMetrics(req: IncomingMessage, res: ServerResponse): void {
    const metrics = this.getMetrics()

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-cache')

    res.end(JSON.stringify(metrics, null, 2))

    debug('metrics served')
  }
}

// Global health monitor instance
let globalHealthMonitor: WebSocketHealthMonitor | undefined

// Get or create the global health monitor
export function getHealthMonitor(): WebSocketHealthMonitor | undefined {
  return globalHealthMonitor
}

// Initialize the global health monitor
export function initializeHealthMonitor(
  config: Required<WebSocketConfig>,
  wsServer?: WebSocketServer
): WebSocketHealthMonitor {
  if (!globalHealthMonitor) {
    globalHealthMonitor = new WebSocketHealthMonitor(config, wsServer)
    debug('health monitor initialized')
  }
  return globalHealthMonitor
}

// Setup health check endpoint if enabled
export function setupHealthCheckEndpoint(
  config: Required<WebSocketConfig>,
  httpServer: any
): void {
  if (!config.monitoring.healthCheck?.enabled) {
    return
  }

  const healthMonitor = getHealthMonitor()
  if (!healthMonitor) {
    debug('health monitor not initialized')
    return
  }

  const healthPath = config.monitoring.healthCheck.path
  const metricsPath = `${healthPath}/metrics`

  // Add request listener for health check endpoints
  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === healthPath) {
      healthMonitor.handleHealthCheck(req, res)
      return
    }

    if (req.url === metricsPath) {
      healthMonitor.handleMetrics(req, res)
      return
    }
  }

  // Note: This is a simplified approach. In a real implementation,
  // you'd want to integrate with Next.js routing system properly
  httpServer.on('request', requestListener)

  debug('health endpoints ready:', healthPath, metricsPath)
}
