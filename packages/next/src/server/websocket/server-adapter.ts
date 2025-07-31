// Server adapter to abstract away internal Next.js APIs

import type { Server as HttpServer } from 'http'
import type NextNodeServer from '../next-server'

export interface ServerAdapter {
  getHttpServer(): HttpServer | undefined
  getAppRoutes(): Record<string, [string, any]> | null
  resolvePagePath(pageKey: string): string | undefined
  ensurePage?(pageKey: string): Promise<void>
  isDevelopment(): boolean
}

// Creates a server adapter that provides access to Next.js server functionality
// with better abstraction and error handling
export function createServerAdapter(nextServer: NextNodeServer): ServerAdapter {
  return {
    getHttpServer(): HttpServer | undefined {
      try {
        // Try to get HTTP server through public APIs first
        // @ts-expect-error - serverOptions is protected but commonly accessed
        const httpServer = nextServer.serverOptions?.httpServer
        return httpServer as HttpServer | undefined
      } catch (error) {
        // Fallback: try to find HTTP server through other means
        return undefined
      }
    },

    getAppRoutes(): Record<string, [string, any]> | null {
      try {
        // Try multiple approaches to get app routes
        // @ts-expect-error - appPathRoutes is protected
        let appRoutes = nextServer.appPathRoutes

        if (!appRoutes) {
          // @ts-expect-error - try alternative getter
          if (typeof nextServer.getAppPathRoutes === 'function') {
            // @ts-expect-error
            appRoutes = nextServer.getAppPathRoutes()
          }
        }

        return appRoutes as Record<string, [string, any]> | null
      } catch (error) {
        return null
      }
    },

    resolvePagePath(pageKey: string): string | undefined {
      try {
        // @ts-expect-error - getPagePath is protected but needed for module loading
        return nextServer.getPagePath(pageKey)
      } catch (error) {
        return undefined
      }
    },

    async ensurePage(pageKey: string): Promise<void> {
      try {
        // Try hot reloader first (development)
        // @ts-expect-error - hotReloader is protected
        if (nextServer.hotReloader?.ensurePage) {
          // @ts-expect-error
          await nextServer.hotReloader.ensurePage({
            page: pageKey,
            clientOnly: false,
          })
          return
        }

        // Try direct ensurePage (development)
        // @ts-expect-error - ensurePage is protected
        if (typeof nextServer.ensurePage === 'function') {
          // @ts-expect-error
          await nextServer.ensurePage({ page: pageKey, clientOnly: false })
          return
        }

        // In production, this is typically not needed
      } catch (error) {
        // ensurePage failures are often non-critical in production
        // Log but don't throw
      }
    },

    isDevelopment(): boolean {
      // @ts-expect-error - renderOpts is protected but safe to access
      return !!nextServer.renderOpts?.dev
    },
  }
}

import {
  loadWebSocketConfig,
  mergeWebSocketConfig,
  type WebSocketConfig,
} from './config'

// Get WebSocket configuration from Next.js config
export function getWebSocketConfig(
  nextServer: NextNodeServer
): Required<WebSocketConfig> {
  try {
    // @ts-expect-error - nextConfig is protected but commonly accessed
    const nextConfig = nextServer.nextConfig

    // Load configuration from multiple sources
    const userConfig = loadWebSocketConfig(nextConfig)

    // Merge with defaults
    return mergeWebSocketConfig(userConfig)
  } catch (error) {
    // Return sensible defaults if config access fails
    return mergeWebSocketConfig({})
  }
}
