// Memory management and leak prevention for WebSocket connections

import setupDebug from 'next/dist/compiled/debug'

const debug = setupDebug('next:websocket:memory-manager')
import { getConnectionPool } from './performance'

export interface MemoryThresholds {
  warning: number // Memory usage percentage to trigger warnings
  critical: number // Memory usage percentage to trigger aggressive cleanup
  maximum: number // Memory usage percentage to start rejecting connections
}

export interface MemoryStats {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  percentage: number
  rss: number
  connectionCount: number
  estimatedConnectionMemory: number
}

export interface CleanupStrategy {
  name: string
  priority: number
  execute: () => Promise<number> // Returns amount of memory freed
}

// Memory manager for WebSocket connections
export class WebSocketMemoryManager {
  private cleanupStrategies: CleanupStrategy[] = []
  private monitoringInterval?: NodeJS.Timeout
  private lastCleanup = 0
  private cleanupCooldown = 30000 // 30 seconds between cleanups

  constructor(
    private thresholds: MemoryThresholds = {
      warning: 90, // 90% memory usage (was too aggressive at 70%)
      critical: 95, // 95% memory usage
      maximum: 98, // 98% memory usage
    }
  ) {
    this.registerDefaultCleanupStrategies()
    this.startMonitoring()
  }

  // Get current memory statistics
  getMemoryStats(): MemoryStats {
    const memoryUsage = process.memoryUsage()
    const connectionPool = getConnectionPool()
    const poolStats = connectionPool.getStats()

    return {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
      percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      rss: memoryUsage.rss,
      connectionCount: poolStats.total,
      estimatedConnectionMemory: poolStats.memoryUsage,
    }
  }

  // Check if memory usage is within acceptable limits
  isMemoryUsageAcceptable(): boolean {
    const stats = this.getMemoryStats()
    return stats.percentage < this.thresholds.maximum
  }

  // Register a custom cleanup strategy
  registerCleanupStrategy(strategy: CleanupStrategy): void {
    this.cleanupStrategies.push(strategy)
    // Sort by priority (higher priority first)
    this.cleanupStrategies.sort((a, b) => b.priority - a.priority)

    debug(
      'cleanup strategy registered:',
      strategy.name,
      'priority:',
      strategy.priority
    )
  }

  // Execute cleanup strategies based on memory pressure
  async executeCleanup(force = false): Promise<number> {
    const now = Date.now()

    if (!force && now - this.lastCleanup < this.cleanupCooldown) {
      debug('cleanup skipped: cooldown')
      return 0
    }

    const beforeStats = this.getMemoryStats()
    let totalFreed = 0

    // Determine cleanup level based on memory pressure
    let strategiesToExecute: CleanupStrategy[] = []

    debug('memory cleanup starting:', `${beforeStats.percentage.toFixed(1)}%`)
    debug(
      'heap stats:',
      `${Math.round(beforeStats.heapUsed / 1024 / 1024)}MB used / ${Math.round(beforeStats.heapTotal / 1024 / 1024)}MB total`
    )
    debug('websocket connections:', beforeStats.connectionCount)
    debug(
      'strategies to execute:',
      strategiesToExecute.length,
      'out of',
      this.cleanupStrategies.length
    )

    if (beforeStats.percentage >= this.thresholds.critical) {
      // Critical: execute all strategies
      strategiesToExecute = this.cleanupStrategies
      debug('memory critical:', `${beforeStats.percentage.toFixed(1)}%`)
    } else if (beforeStats.percentage >= this.thresholds.warning) {
      // Warning: execute high-priority strategies only
      strategiesToExecute = this.cleanupStrategies.filter(
        (s) => s.priority >= 5
      )
      debug('memory high:', `${beforeStats.percentage.toFixed(1)}%`)
    } else if (force) {
      // Force: execute maintenance strategies
      strategiesToExecute = this.cleanupStrategies.filter(
        (s) => s.priority >= 3
      )
    }

    // Execute cleanup strategies
    for (const strategy of strategiesToExecute) {
      try {
        const freed = await strategy.execute()
        totalFreed += freed
        debug('cleanup freed:', strategy.name, `${freed} bytes`)

        // Check if we've reached acceptable levels
        const currentStats = this.getMemoryStats()
        if (currentStats.percentage < this.thresholds.warning) {
          debug(
            'memory cleanup successful:',
            `${currentStats.percentage.toFixed(1)}%`
          )
          break
        }
      } catch (error) {
        debug('cleanup failed:', strategy.name, error)
      }
    }

    this.lastCleanup = now

    const afterStats = this.getMemoryStats()
    const improvement = beforeStats.percentage - afterStats.percentage

    debug(
      'memory cleanup completed:',
      `${improvement.toFixed(1)}% reduction`,
      `${totalFreed} bytes freed`,
      `${afterStats.percentage.toFixed(1)}% usage`
    )

    return totalFreed
  }

  // Check memory usage and trigger cleanup if necessary
  async checkAndCleanup(): Promise<boolean> {
    const stats = this.getMemoryStats()

    if (stats.percentage >= this.thresholds.critical) {
      await this.executeCleanup()
      return true
    } else if (stats.percentage >= this.thresholds.warning) {
      await this.executeCleanup()
      return true
    }

    return false
  }

  // Start memory monitoring
  startMonitoring(intervalMs = 60000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
    }

    this.monitoringInterval = setInterval(async () => {
      await this.checkAndCleanup()
    }, intervalMs)

    debug('memory monitoring started:', `${intervalMs}ms`)
  }

  // Stop memory monitoring
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = undefined
      debug('memory monitoring stopped')
    }
  }

  // Get recommendations for memory optimization
  getOptimizationRecommendations(): string[] {
    const stats = this.getMemoryStats()
    const recommendations: string[] = []

    if (stats.percentage > this.thresholds.warning) {
      recommendations.push(
        'Consider reducing the maximum number of concurrent WebSocket connections'
      )
    }

    if (stats.connectionCount > 500) {
      recommendations.push(
        'Implement connection pooling and idle connection cleanup'
      )
    }

    if (stats.external > stats.heapUsed * 0.5) {
      recommendations.push(
        'High external memory usage detected - check for memory leaks in native modules'
      )
    }

    if (stats.arrayBuffers > 50 * 1024 * 1024) {
      // 50MB
      recommendations.push(
        'High ArrayBuffer usage - consider optimizing binary data handling'
      )
    }

    return recommendations
  }

  // Create a memory usage report
  generateMemoryReport(): object {
    const stats = this.getMemoryStats()
    const recommendations = this.getOptimizationRecommendations()
    const connectionPool = getConnectionPool()
    const poolStats = connectionPool.getStats()

    return {
      timestamp: new Date().toISOString(),
      memoryUsage: {
        heapUsed: `${(stats.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(stats.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        percentage: `${stats.percentage.toFixed(1)}%`,
        rss: `${(stats.rss / 1024 / 1024).toFixed(2)} MB`,
        external: `${(stats.external / 1024 / 1024).toFixed(2)} MB`,
        arrayBuffers: `${(stats.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
      },
      connections: {
        total: poolStats.total,
        active: poolStats.active,
        idle: poolStats.idle,
        peak: poolStats.peak,
        estimatedMemoryUsage: `${(stats.estimatedConnectionMemory / 1024 / 1024).toFixed(2)} MB`,
      },
      thresholds: {
        warning: `${this.thresholds.warning}%`,
        critical: `${this.thresholds.critical}%`,
        maximum: `${this.thresholds.maximum}%`,
      },
      cleanupStrategies: this.cleanupStrategies.map((s) => ({
        name: s.name,
        priority: s.priority,
      })),
      recommendations,
    }
  }

  // Destroy the memory manager
  destroy(): void {
    this.stopMonitoring()
    this.cleanupStrategies = []
  }

  // Register default cleanup strategies
  private registerDefaultCleanupStrategies(): void {
    // High priority: Force garbage collection
    this.registerCleanupStrategy({
      name: 'Force Garbage Collection',
      priority: 10,
      execute: async () => {
        if (global.gc) {
          const before = process.memoryUsage().heapUsed
          global.gc()
          const after = process.memoryUsage().heapUsed
          const freed = before - after
          debug(
            'GC result: before:',
            Math.round(before / 1024 / 1024),
            'MB, after:',
            Math.round(after / 1024 / 1024),
            'MB, freed:',
            Math.round(freed / 1024 / 1024),
            'MB'
          )
          return Math.max(0, freed)
        } else {
          debug('global.gc not available - run with --expose-gc flag')
          return 0
        }
      },
    })

    // High priority: Close idle connections
    this.registerCleanupStrategy({
      name: 'Close Idle Connections',
      priority: 9,
      execute: async () => {
        const connectionPool = getConnectionPool()
        const beforeCount = connectionPool.getStats().total
        const closedCount = connectionPool.cleanupIdleConnections()
        const afterCount = connectionPool.getStats().total
        debug(
          'connection cleanup: before:',
          beforeCount,
          'after:',
          afterCount,
          'closed:',
          closedCount
        )
        return closedCount * 1024 // Estimate 1KB per connection
      },
    })

    // Medium priority: Clear internal caches
    this.registerCleanupStrategy({
      name: 'Clear Internal Caches',
      priority: 6,
      execute: async () => {
        // Clear require cache for non-essential modules
        let cleared = 0
        const totalBefore = Object.keys(require.cache).length
        for (const key in require.cache) {
          if (
            key.includes('node_modules') &&
            !key.includes('ws') &&
            !key.includes('next')
          ) {
            delete require.cache[key]
            cleared++
          }
        }
        const totalAfter = Object.keys(require.cache).length
        debug(
          'cache cleanup: modules before:',
          totalBefore,
          'after:',
          totalAfter,
          'cleared:',
          cleared
        )
        return cleared * 100 // Estimate 100 bytes per cache entry
      },
    })

    // Low priority: Reset performance metrics
    this.registerCleanupStrategy({
      name: 'Reset Performance Metrics',
      priority: 3,
      execute: async () => {
        const connectionPool = getConnectionPool()
        connectionPool.resetMetrics()
        return 1024 // Small amount of memory freed
      },
    })
  }
}

// Global memory manager instance
let globalMemoryManager: WebSocketMemoryManager | undefined

// Get or create the global memory manager
export function getMemoryManager(): WebSocketMemoryManager {
  if (!globalMemoryManager) {
    globalMemoryManager = new WebSocketMemoryManager()

    // Cleanup on process exit
    process.once('exit', () => {
      globalMemoryManager?.destroy()
    })

    process.once('SIGINT', () => {
      globalMemoryManager?.destroy()
    })
  }

  return globalMemoryManager
}

// Initialize memory manager with custom thresholds
export function initializeMemoryManager(
  thresholds: MemoryThresholds
): WebSocketMemoryManager {
  if (globalMemoryManager) {
    globalMemoryManager.destroy()
  }

  globalMemoryManager = new WebSocketMemoryManager(thresholds)
  return globalMemoryManager
}
