# Next.js WebSocket Support

This module provides production-ready WebSocket functionality for Next.js applications, allowing API routes to handle WebSocket connections through a simple `SOCKET` export handler pattern.

## Quick Start

### 1. Create a WebSocket API Route

Create a file in your `app/api` directory with a `route.ts` extension:

```typescript
// app/api/websocket/chat/route.ts
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

// SOCKET handler is called ONCE when the server starts up
export async function SOCKET(wss: WebSocketServer) {
  console.log('WebSocket server initialized for chat route')

  // Return a connection handler that will be called for each client
  return async (client: WebSocket, request: IncomingMessage) => {
    console.log('Client connected to chat')

    // Handle incoming messages
    client.on('message', (data) => {
      const message = data.toString()
      console.log('Received:', message)

      // Echo to sender
      client.send(`Echo: ${message}`)

      // Broadcast to all clients
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`Broadcast: ${message}`)
        }
      })
    })

    // Handle connection close
    client.on('close', () => {
      console.log('Client disconnected from chat')
    })

    // Return cleanup function (optional)
    return () => {
      console.log('Cleaning up chat connection')
    }
  }
}
```

### 2. Connect from Client

```javascript
const ws = new WebSocket('ws://localhost:3000/api/websocket/chat')

ws.onopen = () => {
  console.log('Connected to WebSocket')
  ws.send('Hello Server!')
}

ws.onmessage = (event) => {
  console.log('Received:', event.data)
}

ws.onclose = () => {
  console.log('Disconnected from WebSocket')
}
```

## Configuration

### Environment Variables

```bash
# Enable/disable WebSocket support
NEXT_WEBSOCKET_ENABLED=true

# Maximum concurrent connections (default: 1000)
NEXT_WEBSOCKET_MAX_CONNECTIONS=500

# Connection timeout in milliseconds (default: 30000)
NEXT_WEBSOCKET_TIMEOUT=60000

# Enable compression (default: true)
NEXT_WEBSOCKET_COMPRESSION=true

# Security settings
NEXT_WEBSOCKET_ORIGINS="http://localhost:3000,https://myapp.com"
NEXT_WEBSOCKET_MAX_PAYLOAD_SIZE=1048576

# Performance settings
NEXT_WEBSOCKET_ENABLE_MONITORING=true
NEXT_WEBSOCKET_ENABLE_HEALTH_CHECK=true

# Debug logging
NEXT_WEBSOCKET_DEBUG=true
NEXT_WEBSOCKET_LOG_LEVEL=debug
```

### Next.js Configuration

```javascript
// next.config.js
module.exports = {
  experimental: {
    websocket: {
      enabled: true,
      maxConnections: 1000,
      timeout: 30000,
      compression: true,
      security: {
        origins: ['http://localhost:3000', 'https://myapp.com'],
        maxPayloadSize: 1024 * 1024, // 1MB
        validateProtocol: false,
      },
      performance: {
        perMessageDeflate: {
          threshold: 1024,
          serverMaxWindowBits: 15,
        },
        keepAlive: {
          enabled: true,
          interval: 30000,
        },
      },
      monitoring: {
        metrics: true,
        healthCheck: {
          enabled: true,
          path: '/_next/websocket/health',
        },
      },
      routes: {
        '/api/websocket/chat': {
          maxConnections: 100,
          timeout: 60000,
        },
      },
    },
  },
}
```

## Advanced Features

### Route-Specific Configuration

You can configure specific routes with different settings:

```javascript
// next.config.js
module.exports = {
  experimental: {
    websocket: {
      routes: {
        '/api/websocket/chat': {
          maxConnections: 100,
          timeout: 60000,
          compression: false,
          rateLimit: {
            windowMs: 60000,
            maxRequests: 100,
          },
        },
        '/api/websocket/notifications': {
          maxConnections: 500,
          timeout: 30000,
        },
      },
    },
  },
}
```

### Dynamic Routes

WebSocket routes support dynamic segments just like regular API routes:

```typescript
// app/api/websocket/room/[roomId]/route.ts
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

export async function SOCKET(wss: WebSocketServer) {
  // You can get route parameters from the request URL during connection
  console.log('WebSocket server initialized for room route')

  return async (client: WebSocket, request: IncomingMessage) => {
    // Parse roomId from the request URL
    const url = new URL(request.url || '', `ws://${request.headers.host}`)
    const match = url.pathname.match(/\/room\/([^\/]+)/)
    const roomId = match?.[1]

    console.log(`Client connected to room: ${roomId}`)

    // Room-specific logic here
    client.on('message', (data) => {
      // Broadcast to all clients in this server
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`Room ${roomId}: ${data.toString()}`)
        }
      })
    })

    return () => {
      console.log(`Client disconnected from room: ${roomId}`)
    }
  }
}
```

### Broadcasting Messages

```typescript
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

export async function SOCKET(wss: WebSocketServer) {
  // Store connected clients with metadata
  const clients = new Map<WebSocket, { id: string; name: string }>()

  return async (client: WebSocket, request: IncomingMessage) => {
    const clientId = crypto.randomUUID()
    clients.set(client, { id: clientId, name: 'Anonymous' })

    client.on('message', (data) => {
      const message = data.toString()

      // Broadcast to all connected clients
      wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`User ${clientId}: ${message}`)
        }
      })

      // Or manually iterate for custom logic
      wss.clients.forEach((ws) => {
        if (ws !== client && ws.readyState === WebSocket.OPEN) {
          ws.send(`From ${clientId}: ${message}`)
        }
      })
    })

    client.on('close', () => {
      clients.delete(client)
    })
  }
}
```

### Error Handling

The system includes comprehensive error handling:

```typescript
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

export async function SOCKET(wss: WebSocketServer) {
  return async (client: WebSocket, request: IncomingMessage) => {
    try {
      // Your WebSocket logic here
    } catch (error) {
      console.error('WebSocket error:', error)
      client.close(1011, 'Internal server error')
    }
  }
}
```

## Monitoring and Health Checks

### Health Check Endpoint

When enabled, a health check endpoint is available:

```bash
curl http://localhost:3000/_next/websocket/health
```

Response:

```json
{
  "status": "healthy",
  "connections": {
    "total": 42,
    "active": 38,
    "idle": 4
  },
  "memory": {
    "usage": "45.2%",
    "connections": "2.1MB"
  },
  "uptime": 3600000
}
```

### Performance Metrics

Access performance metrics programmatically:

```typescript
import { getConnectionPool, getHealthMonitor } from 'next/server/websocket'

const pool = getConnectionPool()
const metrics = pool.getPerformanceMetrics()

console.log('Connection rate:', metrics.connectionRate, 'per minute')
console.log('Message rate:', metrics.messageRate, 'per minute')
```

### Memory Management

The system includes automatic memory management:

```typescript
import { getMemoryManager } from 'next/server/websocket'

const memoryManager = getMemoryManager()
const stats = memoryManager.getMemoryStats()

if (stats.percentage > 80) {
  await memoryManager.executeCleanup()
}
```

## Production Deployment

### Load Balancing

For load-balanced deployments, ensure sticky sessions are enabled to maintain WebSocket connections:

```nginx
# Nginx configuration
upstream nextjs {
    ip_hash;  # Enable sticky sessions
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

server {
    location / {
        proxy_pass http://nextjs;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment-Specific Settings

```bash
# Production
NEXT_WEBSOCKET_ENABLED=true
NEXT_WEBSOCKET_MAX_CONNECTIONS=5000
NEXT_WEBSOCKET_LOG_LEVEL=warn
NEXT_WEBSOCKET_ENABLE_MONITORING=true

# Development
NEXT_WEBSOCKET_DEBUG=true
NEXT_WEBSOCKET_LOG_LEVEL=debug
```

### Security Considerations

1. **Origins**: Always specify allowed origins in production
2. **Rate Limiting**: Configure appropriate rate limits
3. **Payload Size**: Limit message payload sizes
4. **Authentication**: Implement authentication in your SOCKET handlers

```typescript
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

export async function SOCKET(wss: WebSocketServer) {
  return async (client: WebSocket, request: IncomingMessage) => {
    // Verify authentication
    const token = request.headers.authorization
    if (!isValidToken(token)) {
      client.close(1008, 'Authentication required')
      return
    }

    // Continue with authenticated connection...
  }
}
```

## Troubleshooting

### Common Issues

1. **WebSocket connections fail**: Check if WebSocket support is enabled and the HTTP server is properly initialized
2. **Memory leaks**: Ensure cleanup functions are returned from SOCKET handlers
3. **Connection limits**: Monitor connection pool statistics and adjust limits
4. **Performance issues**: Enable monitoring and check metrics

### Debug Logging

Enable debug logging to troubleshoot issues:

```bash
NEXT_WEBSOCKET_DEBUG=true npm run dev
```

### Health Monitoring

Monitor the health endpoint for connection and memory statistics:

```bash
curl http://localhost:3000/_next/websocket/health | jq
```

## API Reference

### SOCKET Handler Function

```typescript
import type { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'http'

// Handler is called ONCE on server startup
type SocketHandler = (
  wss: WebSocketServer
) => Promise<ConnectionHandler> | ConnectionHandler

// Connection handler is called for each client
type ConnectionHandler = (
  client: WebSocket,
  request: IncomingMessage
) => Promise<OnSocketClose | void> | OnSocketClose | void

type OnSocketClose = () => void
```

### Configuration Types

See the complete configuration schema in the TypeScript definitions:

- `WebSocketConfig`: Main configuration interface
- `WebSocketSecurityConfig`: Security-related settings
- `WebSocketPerformanceConfig`: Performance optimization settings
- `WebSocketMonitoringConfig`: Monitoring and observability settings

### Utility Functions

- `getConnectionPool()`: Access the global connection pool
- `getHealthMonitor()`: Access health monitoring
- `getMemoryManager()`: Access memory management
- `wsLogger`: WebSocket-specific logger instance

## Architecture

The WebSocket implementation consists of several key modules:

### Core Modules

- `setup.ts` - Main WebSocket server setup and upgrade handling
- `route-resolver.ts` - Dynamic route resolution and handler loading
- `types.ts` - TypeScript type definitions
- `index.ts` - Public API exports

### Configuration and Logging

- `config.ts` - Comprehensive configuration system with environment variable support
- `logger.ts` - Configurable logging system with different levels
- `server-adapter.ts` - Abstraction layer for Next.js internal APIs

### Performance and Reliability

- `performance.ts` - Connection pooling and performance optimizations
- `memory-manager.ts` - Automatic memory management and leak prevention
- `circuit-breaker.ts` - Circuit breaker pattern for fault tolerance
- `rate-limiter.ts` - Rate limiting and throttling

### Error Handling and Monitoring

- `errors.ts` - Custom error classes and error handling utilities
- `graceful-handler.ts` - Graceful connection handling and cleanup
- `health-check.ts` - Health monitoring and metrics collection
- `connection-tracker.ts` - Connection lifecycle tracking

### Utilities

- `persistent-servers.ts` - Global server instance management
- `route-handler.ts` - Route-specific handler management

## Performance

The WebSocket implementation is optimized for production use with:

- **Connection pooling and management**: Efficiently manages thousands of concurrent connections
- **Memory leak prevention**: Automatic cleanup and monitoring to prevent memory leaks
- **Circuit breaker pattern**: Fault tolerance to prevent cascade failures
- **Rate limiting and throttling**: Protection against abuse and overload
- **Automatic cleanup**: Idle connection cleanup and resource management
- **Performance metrics**: Real-time monitoring and statistics
- **Health monitoring**: Built-in health check endpoints for monitoring

## Testing

The implementation includes comprehensive unit tests covering:

- Configuration merging and validation
- Error handling and recovery strategies
- Circuit breaker functionality
- Performance optimizations
- Memory management
- Server adapter abstraction

Run tests with:

```bash
npm test -- test/unit/websocket-*.test.ts
```

## License

This WebSocket implementation is part of Next.js and follows the same MIT license.
