// Circuit breaker pattern for WebSocket route resolution
// Prevents cascade failures by temporarily disabling failing routes

import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:circuit-breaker')

export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing, requests rejected
  HALF_OPEN = 'half-open', // Testing recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number // Number of failures before opening
  resetTimeout: number // Time before attempting recovery (ms)
  monitoringWindow: number // Time window for counting failures (ms)
  successThreshold: number // Successes needed to close circuit in half-open state
}

export interface CircuitBreakerStats {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number | null
  lastSuccessTime: number | null
  totalRequests: number
}

// Circuit breaker for individual WebSocket routes
export class RouteCircuitBreaker {
  private state = CircuitState.CLOSED
  private currentFailures = 0 // Current failure count for circuit breaking logic
  private totalFailures = 0 // Total failure count for statistics
  private totalSuccesses = 0 // Total success count for statistics
  private lastFailureTime: number | null = null
  private lastSuccessTime: number | null = null
  private totalRequests = 0
  private failureWindow: number[] = []

  constructor(
    private readonly routePath: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  // Check if a request should be allowed through
  canExecute(): boolean {
    this.cleanupOldFailures()

    switch (this.state) {
      case CircuitState.CLOSED:
        return true

      case CircuitState.OPEN:
        // Check if enough time has passed to try recovery
        if (this.shouldAttemptReset()) {
          this.state = CircuitState.HALF_OPEN
          this.consecutiveSuccessesInHalfOpen = 0
          debug('circuit breaker half-open:', this.routePath)
          return true
        }
        return false

      case CircuitState.HALF_OPEN:
        return true

      default:
        return false
    }
  }

  // Record a successful execution
  recordSuccess(): void {
    this.totalRequests++
    this.totalSuccesses++
    this.lastSuccessTime = Date.now()

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.consecutiveSuccessesInHalfOpen++
        if (
          this.consecutiveSuccessesInHalfOpen >= this.config.successThreshold
        ) {
          this.reset()
          debug('circuit breaker closed:', this.routePath)
        }
        break

      case CircuitState.CLOSED:
        // Reset current failure count on successful operation
        this.currentFailures = Math.max(0, this.currentFailures - 1)
        break
    }
  }

  private consecutiveSuccessesInHalfOpen = 0

  // Record a failed execution
  recordFailure(error?: Error): void {
    this.totalRequests++
    this.totalFailures++
    this.currentFailures++
    this.lastFailureTime = Date.now()
    this.failureWindow.push(this.lastFailureTime)

    debug('circuit breaker failure:', this.routePath, error?.message)

    this.cleanupOldFailures()

    switch (this.state) {
      case CircuitState.CLOSED:
        if (this.currentFailures >= this.config.failureThreshold) {
          this.openCircuit()
        }
        break

      case CircuitState.HALF_OPEN:
        this.openCircuit()
        break
    }
  }

  // Get current circuit breaker statistics
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.totalFailures,
      successes: this.totalSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
    }
  }

  // Manually reset the circuit breaker
  reset(): void {
    this.state = CircuitState.CLOSED
    this.currentFailures = 0
    this.consecutiveSuccessesInHalfOpen = 0
    this.failureWindow = []
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false
    return Date.now() - this.lastFailureTime >= this.config.resetTimeout
  }

  private openCircuit(): void {
    this.state = CircuitState.OPEN
    debug(
      'circuit breaker opened:',
      this.routePath,
      `${this.currentFailures} failures`
    )
  }

  private cleanupOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringWindow
    this.failureWindow = this.failureWindow.filter((time) => time > cutoff)
    this.currentFailures = this.failureWindow.length
  }
}

// Global circuit breaker manager for all WebSocket routes
export class CircuitBreakerManager {
  private breakers = new Map<string, RouteCircuitBreaker>()
  private readonly defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringWindow: 300000, // 5 minutes
    successThreshold: 3,
  }

  // Get or create a circuit breaker for a route
  getBreaker(
    routePath: string,
    config?: Partial<CircuitBreakerConfig>
  ): RouteCircuitBreaker {
    if (!this.breakers.has(routePath)) {
      const finalConfig = { ...this.defaultConfig, ...config }
      this.breakers.set(
        routePath,
        new RouteCircuitBreaker(routePath, finalConfig)
      )
    }
    return this.breakers.get(routePath)!
  }

  // Get statistics for all circuit breakers
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {}
    for (const [route, breaker] of this.breakers) {
      stats[route] = breaker.getStats()
    }
    return stats
  }

  // Reset all circuit breakers
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
    debug('circuit breakers reset')
  }

  // Clean up unused circuit breakers
  cleanup(): void {
    const now = Date.now()
    const maxAge = 3600000 // 1 hour

    for (const [route, breaker] of this.breakers) {
      const stats = breaker.getStats()
      const lastActivity = Math.max(
        stats.lastFailureTime || 0,
        stats.lastSuccessTime || 0
      )

      if (lastActivity && now - lastActivity > maxAge) {
        this.breakers.delete(route)
        debug('circuit breaker cleaned up:', route)
      }
    }
  }
}

// Global circuit breaker manager instance
const globalCircuitBreakerManager = new CircuitBreakerManager()

// Cleanup unused breakers every 30 minutes
setInterval(
  () => {
    globalCircuitBreakerManager.cleanup()
  },
  30 * 60 * 1000
)

export { globalCircuitBreakerManager as circuitBreakerManager }
