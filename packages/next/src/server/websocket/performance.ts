// Performance optimizations and memory management for WebSocket connections

import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:performance')
import { getHealthMonitor } from './health-check'
import type { WebSocket } from 'ws'

export interface ConnectionPoolStats {
  active: number
  idle: number
  total: number
  peak: number
  memoryUsage: number
}

export interface PerformanceMetrics {
  messageRate: number
  connectionRate: number
  disconnectionRate: number
  memoryGrowth: number
  gcEvents: number
  lastGcTime: number
}

// Connection pool for efficient WebSocket connection management
export class WebSocketConnectionPool {
  private connections = new Map<string, WebSocket>()
  private connectionMetadata = new Map<
    string,
    {
      path: string
      connectedAt: number
      lastActivity: number
      messageCount: number
      bytesReceived: number
      bytesSent: number
    }
  >()
  private cleanupInterval?: NodeJS.Timeout
  private performanceMetrics: PerformanceMetrics = {
    messageRate: 0,
    connectionRate: 0,
    disconnectionRate: 0,
    memoryGrowth: 0,
    gcEvents: 0,
    lastGcTime: Date.now(),
  }
  private lastMetricsReset = Date.now()

  constructor(
    private maxConnections = 1000,
    private idleTimeout = 300000 // 5 minutes
  ) {
    this.setupCleanup()
    this.setupPerformanceMonitoring()
  }

  // Add a connection to the pool
  addConnection(id: string, ws: WebSocket, path: string): boolean {
    if (this.connections.size >= this.maxConnections) {
      debug(
        'connection pool full:',
        `${this.connections.size}/${this.maxConnections}`
      )
      return false
    }

    // Set up connection metadata
    const metadata = {
      path,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
    }

    this.connections.set(id, ws)
    this.connectionMetadata.set(id, metadata)

    this.setupConnectionHandlers(id, ws)

    this.performanceMetrics.connectionRate++
    debug(
      'connection added:',
      id,
      'total:',
      this.connections.size,
      'readyState:',
      ws.readyState
    )

    // Report to health monitor
    const healthMonitor = getHealthMonitor()
    if (healthMonitor) {
      healthMonitor.recordConnection(id)
    }

    return true
  }

  // Remove a connection from the pool
  removeConnection(id: string): void {
    const ws = this.connections.get(id)
    const metadata = this.connectionMetadata.get(id)

    if (ws && metadata) {
      const duration = Date.now() - metadata.connectedAt

      this.connections.delete(id)
      this.connectionMetadata.delete(id)

      this.performanceMetrics.disconnectionRate++
      debug('connection removed:', id, `${duration}ms`)

      // Report to health monitor
      const healthMonitor = getHealthMonitor()
      if (healthMonitor) {
        healthMonitor.recordDisconnection(id, duration)
      }
    } else {
      debug(
        'connection remove failed - not found:',
        id,
        'ws:',
        !!ws,
        'metadata:',
        !!metadata
      )
    }
  }

  // Get connection statistics
  getStats(): ConnectionPoolStats {
    const now = Date.now()
    const idle = Array.from(this.connectionMetadata.values()).filter(
      (metadata) => now - metadata.lastActivity > 60000
    ).length // 1 minute

    const memoryUsage = this.calculateMemoryUsage()

    return {
      active: this.connections.size - idle,
      idle,
      total: this.connections.size,
      peak: this.performanceMetrics.connectionRate, // Simplified peak tracking
      memoryUsage,
    }
  }

  // Get performance metrics
  getPerformanceMetrics(): PerformanceMetrics {
    const timeSinceReset = Date.now() - this.lastMetricsReset
    const minutesSinceReset = Math.max(timeSinceReset / 60000, 0.0001) // Avoid division by zero

    return {
      ...this.performanceMetrics,
      messageRate: this.performanceMetrics.messageRate / minutesSinceReset,
      connectionRate:
        this.performanceMetrics.connectionRate / minutesSinceReset,
      disconnectionRate:
        this.performanceMetrics.disconnectionRate / minutesSinceReset,
    }
  }

  // Cleanup idle connections
  cleanupIdleConnections(): number {
    const now = Date.now()
    let cleanedUp = 0

    for (const [id, metadata] of this.connectionMetadata.entries()) {
      if (now - metadata.lastActivity > this.idleTimeout) {
        const ws = this.connections.get(id)
        if (ws && ws.readyState === ws.OPEN) {
          debug('closing idle connection:', id)
          ws.close(1000, 'Idle timeout')
          cleanedUp++
        }
      }
    }

    if (cleanedUp > 0) {
      debug('cleaned up idle connections:', cleanedUp)
    }

    return cleanedUp
  }

  // Force garbage collection if available
  forceGarbageCollection(): boolean {
    if (global.gc) {
      const beforeMemory = process.memoryUsage().heapUsed
      global.gc()
      const afterMemory = process.memoryUsage().heapUsed

      this.performanceMetrics.gcEvents++
      this.performanceMetrics.lastGcTime = Date.now()

      const freedMemory = beforeMemory - afterMemory
      debug('GC freed memory:', `${freedMemory} bytes`)

      return true
    }

    return false
  }

  // Get connections by path pattern
  getConnectionsByPath(pathPattern: string): WebSocket[] {
    const connections: WebSocket[] = []

    for (const [id, metadata] of this.connectionMetadata.entries()) {
      if (metadata.path.includes(pathPattern)) {
        const ws = this.connections.get(id)
        if (ws) {
          connections.push(ws)
        }
      }
    }

    return connections
  }

  // Broadcast message to connections matching a pattern
  broadcast(pathPattern: string, message: string | Buffer): number {
    const connections = this.getConnectionsByPath(pathPattern)
    let sent = 0

    for (const ws of connections) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(message)
          sent++
        } catch (error) {
          debug('broadcast error:', error)
        }
      }
    }

    this.performanceMetrics.messageRate += sent
    return sent
  }

  // Reset performance metrics
  resetMetrics(): void {
    this.performanceMetrics = {
      messageRate: 0,
      connectionRate: 0,
      disconnectionRate: 0,
      memoryGrowth: 0,
      gcEvents: this.performanceMetrics.gcEvents,
      lastGcTime: this.performanceMetrics.lastGcTime,
    }
    this.lastMetricsReset = Date.now()
  }

  // Destroy the connection pool
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Close all connections
    for (const [id, ws] of this.connections.entries()) {
      ws.close(1000, 'Server shutdown')
    }

    this.connections.clear()
    this.connectionMetadata.clear()
  }

  private setupConnectionHandlers(id: string, ws: WebSocket): void {
    debug('setting up connection handlers for:', id)

    // Track message activity
    ws.on('message', (data: Buffer) => {
      const metadata = this.connectionMetadata.get(id)
      if (metadata) {
        metadata.lastActivity = Date.now()
        metadata.messageCount++
        metadata.bytesReceived += data.length
        this.performanceMetrics.messageRate++
      }
    })

    // Handle connection close
    ws.on('close', (code, reason) => {
      debug(
        'performance close handler triggered:',
        id,
        'code:',
        code,
        'reason:',
        reason?.toString()
      )
      this.removeConnection(id)
    })

    // Handle connection errors
    ws.on('error', (error: Error) => {
      debug('connection error:', id, error)
      this.removeConnection(id)
    })

    debug('connection handlers attached for:', id)
  }

  private setupCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections()

      // Force GC if memory usage is high and GC is available
      const memoryUsage = process.memoryUsage()
      const memoryPercentage =
        (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100

      if (memoryPercentage > 80 && global.gc) {
        this.forceGarbageCollection()
      }
    }, 300000) // 5 minutes
  }

  private setupPerformanceMonitoring(): void {
    // Track memory growth
    let lastHeapUsed = process.memoryUsage().heapUsed

    setInterval(() => {
      const currentHeapUsed = process.memoryUsage().heapUsed
      this.performanceMetrics.memoryGrowth = currentHeapUsed - lastHeapUsed
      lastHeapUsed = currentHeapUsed
    }, 60000) // 1 minute
  }

  private calculateMemoryUsage(): number {
    const memoryUsage = process.memoryUsage()
    const connectionOverhead = this.connections.size * 1024 // Estimated 1KB per connection
    return memoryUsage.heapUsed + connectionOverhead
  }
}

// Message buffering system for efficient WebSocket communication
export class MessageBuffer {
  private buffer: Array<{ message: string | Buffer; timestamp: number }> = []
  private flushTimeout?: NodeJS.Timeout

  constructor(
    private maxSize = 100,
    private flushInterval = 1000, // 1 second
    private onFlush: (messages: Array<string | Buffer>) => void = () => {}
  ) {}

  // Add message to buffer
  add(message: string | Buffer): void {
    this.buffer.push({
      message,
      timestamp: Date.now(),
    })

    // Flush if buffer is full
    if (this.buffer.length >= this.maxSize) {
      this.flush()
    } else if (!this.flushTimeout) {
      // Schedule flush
      this.flushTimeout = setTimeout(() => {
        this.flush()
      }, this.flushInterval)
    }
  }

  // Flush buffered messages
  flush(): void {
    if (this.buffer.length === 0) return

    const messages = this.buffer.map((item) => item.message)
    this.buffer = []

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = undefined
    }

    this.onFlush(messages)
  }

  // Get buffer statistics
  getStats() {
    return {
      buffered: this.buffer.length,
      maxSize: this.maxSize,
      oldestMessage:
        this.buffer.length > 0 ? Date.now() - this.buffer[0].timestamp : 0,
    }
  }

  // Destroy the buffer
  destroy(): void {
    this.flush()
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }
  }
}

// Global connection pool instance
let globalConnectionPool: WebSocketConnectionPool | undefined

// Get or create the global connection pool
export function getConnectionPool(): WebSocketConnectionPool {
  if (!globalConnectionPool) {
    globalConnectionPool = new WebSocketConnectionPool()

    // Cleanup on process exit
    process.once('exit', () => {
      globalConnectionPool?.destroy()
    })
  }

  return globalConnectionPool
}

// Initialize connection pool with custom settings
export function initializeConnectionPool(
  maxConnections: number,
  idleTimeout: number
): WebSocketConnectionPool {
  if (globalConnectionPool) {
    globalConnectionPool.destroy()
  }

  globalConnectionPool = new WebSocketConnectionPool(
    maxConnections,
    idleTimeout
  )
  return globalConnectionPool
}
