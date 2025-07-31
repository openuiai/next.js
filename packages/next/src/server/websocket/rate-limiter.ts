// Rate limiting for WebSocket connections

import type { IncomingMessage } from 'http'
import type { Socket as NetSocket } from 'net'

import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:rate-limiter')
import type { WebSocketRouteConfig } from './config'

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (req: IncomingMessage, socket: NetSocket) => string
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
  message?: string
}

export interface RateLimitInfo {
  limit: number
  current: number
  remaining: number
  resetTime: number
}

// Simple in-memory rate limiter for WebSocket connections
export class WebSocketRateLimiter {
  private requests = new Map<string, number[]>()
  private cleanupInterval: NodeJS.Timeout

  constructor(private config: RateLimitConfig) {
    // Clean up old entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000)
  }

  // Check if a request is allowed
  isAllowed(
    req: IncomingMessage,
    socket: NetSocket
  ): { allowed: boolean; info: RateLimitInfo } {
    const key = this.generateKey(req, socket)
    const now = Date.now()
    const windowStart = now - this.config.windowMs

    // Get or create request list for this key
    let requestTimes = this.requests.get(key) || []

    // Remove requests outside the current window
    requestTimes = requestTimes.filter((time) => time > windowStart)

    // Update the map
    this.requests.set(key, requestTimes)

    const current = requestTimes.length
    const allowed = current < this.config.maxRequests

    const info: RateLimitInfo = {
      limit: this.config.maxRequests,
      current,
      remaining: Math.max(0, this.config.maxRequests - current),
      resetTime:
        requestTimes.length > 0
          ? requestTimes[0] + this.config.windowMs
          : now + this.config.windowMs,
    }

    if (allowed) {
      // Record this request
      requestTimes.push(now)
      this.requests.set(key, requestTimes)
      info.current++
      info.remaining = Math.max(0, info.remaining - 1)
    }

    return { allowed, info }
  }

  // Generate a key for rate limiting (default: IP address)
  private generateKey(req: IncomingMessage, socket: NetSocket): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(req, socket)
    }

    // Default: use IP address
    const forwarded = req.headers['x-forwarded-for'] as string
    const ip =
      forwarded?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      socket.remoteAddress ||
      'unknown'

    return `ip:${ip}`
  }

  // Clean up old entries
  private cleanup(): void {
    const now = Date.now()
    const cutoff = now - this.config.windowMs

    for (const [key, requestTimes] of this.requests.entries()) {
      const filtered = requestTimes.filter((time) => time > cutoff)

      if (filtered.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, filtered)
      }
    }

    debug('rate limiter cleanup:', this.requests.size, 'keys')
  }

  // Get current statistics
  getStats() {
    return {
      activeKeys: this.requests.size,
      config: {
        windowMs: this.config.windowMs,
        maxRequests: this.config.maxRequests,
      },
    }
  }

  // Reset all rate limiting data
  reset(): void {
    this.requests.clear()
    debug('rate limiter reset')
  }

  // Destroy the rate limiter and clean up resources
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.requests.clear()
  }
}

// Route-based rate limiter manager
export class RouteRateLimiterManager {
  private limiters = new Map<string, WebSocketRateLimiter>()

  // Get or create a rate limiter for a route
  getLimiter(routePath: string, config: RateLimitConfig): WebSocketRateLimiter {
    if (!this.limiters.has(routePath)) {
      this.limiters.set(routePath, new WebSocketRateLimiter(config))
      debug('rate limiter created:', routePath)
    }
    return this.limiters.get(routePath)!
  }

  // Check rate limit for a specific route
  checkRateLimit(
    routePath: string,
    routeConfig: WebSocketRouteConfig,
    req: IncomingMessage,
    socket: NetSocket
  ): { allowed: boolean; info?: RateLimitInfo; message?: string } {
    if (!routeConfig.rateLimit) {
      return { allowed: true }
    }

    const limiter = this.getLimiter(routePath, {
      windowMs: routeConfig.rateLimit.windowMs,
      maxRequests: routeConfig.rateLimit.maxRequests,
      message: `Rate limit exceeded for WebSocket route ${routePath}`,
    })

    const { allowed, info } = limiter.isAllowed(req, socket)

    if (!allowed) {
      debug('rate limit exceeded:', routePath, `${info.current}/${info.limit}`)
    }

    return {
      allowed,
      info,
      message: allowed ? undefined : limiter['config'].message,
    }
  }

  // Get statistics for all route rate limiters
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {}

    for (const [route, limiter] of this.limiters) {
      stats[route] = limiter.getStats()
    }

    return stats
  }

  // Clean up unused rate limiters
  cleanup(): void {
    const now = Date.now()
    const maxIdleTime = 3600000 // 1 hour

    for (const [route, limiter] of this.limiters) {
      const stats = limiter.getStats()

      // If no active keys and hasn't been used recently, remove it
      if (stats.activeKeys === 0) {
        this.limiters.delete(route)
        limiter.destroy()
        debug('rate limiter cleaned up:', route)
      }
    }
  }

  // Reset all rate limiters
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset()
    }
    debug('rate limiters reset')
  }

  // Destroy all rate limiters
  destroy(): void {
    for (const limiter of this.limiters.values()) {
      limiter.destroy()
    }
    this.limiters.clear()
  }
}

// Global rate limiter manager
const globalRateLimiterManager = new RouteRateLimiterManager()

// Cleanup unused limiters every 30 minutes
setInterval(
  () => {
    globalRateLimiterManager.cleanup()
  },
  30 * 60 * 1000
)

export { globalRateLimiterManager as rateLimiterManager }
