// Connection tracking utilities for WebSocket upgrade handling

import type { Socket as NetSocket } from 'net'

// Tracks active WebSocket upgrade requests and connections
// to prevent duplicate processing and memory leaks
export class ConnectionTracker {
  // Track active upgrade requests to prevent duplicate processing
  private activeUpgrades = new WeakSet<NetSocket>()

  // Track recent upgrade requests by URL to prevent rapid duplicates
  private recentUpgrades = new Map<string, number>()

  // Track connections that have been cleaned up to prevent double cleanup
  private cleanedUpConnections = new Set<string>()

  // Cleanup interval for old entries
  private cleanupInterval?: NodeJS.Timeout

  constructor() {
    // Clean up old entries every 5 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupRecentUpgrades()
    }, 5000)
  }

  // Check if an upgrade request is a rapid duplicate
  isRapidDuplicate(url: string, socket: NetSocket, windowMs = 1000): boolean {
    const now = Date.now()
    const requestKey = `${url}:${socket.remoteAddress}`
    const lastRequest = this.recentUpgrades.get(requestKey)

    if (lastRequest && now - lastRequest < windowMs) {
      return true
    }

    this.recentUpgrades.set(requestKey, now)
    return false
  }

  // Check if a socket is already being processed
  isSocketActive(socket: NetSocket): boolean {
    return this.activeUpgrades.has(socket)
  }

  // Mark a socket as being processed
  markSocketActive(socket: NetSocket): void {
    this.activeUpgrades.add(socket)

    // Automatically clean up when socket closes
    socket.once('close', () => {
      this.markSocketInactive(socket)
    })

    socket.once('error', () => {
      this.markSocketInactive(socket)
    })
  }

  // Mark a socket as no longer being processed
  markSocketInactive(socket: NetSocket): void {
    this.activeUpgrades.delete(socket)
  }

  // Check if a connection has already been cleaned up
  isConnectionCleanedUp(connectionId: string): boolean {
    return this.cleanedUpConnections.has(connectionId)
  }

  // Mark a connection as cleaned up
  markConnectionCleanedUp(connectionId: string): void {
    this.cleanedUpConnections.add(connectionId)

    // Clean up after 30 seconds to prevent memory leak
    setTimeout(() => {
      this.cleanedUpConnections.delete(connectionId)
    }, 30000)
  }

  // Clean up old entries from the recent upgrades map
  private cleanupRecentUpgrades(): void {
    const now = Date.now()
    const maxAge = 10000 // 10 seconds

    for (const [key, timestamp] of this.recentUpgrades.entries()) {
      if (now - timestamp > maxAge) {
        this.recentUpgrades.delete(key)
      }
    }
  }

  // Get statistics about tracked connections
  getStats() {
    return {
      recentUpgrades: this.recentUpgrades.size,
      // Note: WeakSet doesn't have size property, but this gives us insight
      activeUpgradesTracked: 'WeakSet (size not available)',
    }
  }

  // Clean up all resources
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    this.recentUpgrades.clear()
  }
}

// Global connection tracker instance
let globalTracker: ConnectionTracker | undefined

// Get or create the global connection tracker
export function getConnectionTracker(): ConnectionTracker {
  if (!globalTracker) {
    globalTracker = new ConnectionTracker()

    // Clean up on process exit
    process.once('exit', () => {
      globalTracker?.destroy()
    })

    process.once('SIGINT', () => {
      globalTracker?.destroy()
    })

    process.once('SIGTERM', () => {
      globalTracker?.destroy()
    })
  }

  return globalTracker
}
