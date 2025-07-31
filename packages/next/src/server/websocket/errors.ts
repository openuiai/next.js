// Custom error classes for WebSocket functionality

export class WebSocketError extends Error {
  public readonly code: string
  public readonly statusCode?: number

  constructor(message: string, code: string, statusCode?: number) {
    super(message)
    this.name = 'WebSocketError'
    this.code = code
    this.statusCode = statusCode
    Error.captureStackTrace(this, WebSocketError)
  }
}

export class RouteNotFoundError extends WebSocketError {
  constructor(path: string) {
    super(`WebSocket route not found: ${path}`, 'ROUTE_NOT_FOUND', 404)
    this.name = 'RouteNotFoundError'
  }
}

export class HandlerNotFoundError extends WebSocketError {
  constructor(path: string) {
    super(
      `SOCKET handler not exported in route: ${path}`,
      'HANDLER_NOT_FOUND',
      400
    )
    this.name = 'HandlerNotFoundError'
  }
}

export class ModuleImportError extends WebSocketError {
  constructor(path: string, originalError?: Error) {
    super(
      `Failed to import WebSocket route module: ${path}`,
      'MODULE_IMPORT_ERROR',
      500
    )
    this.name = 'ModuleImportError'
    if (originalError) {
      this.stack += `\nCaused by: ${originalError.stack}`
    }
  }
}

export class ServerNotAvailableError extends WebSocketError {
  constructor(reason: string) {
    super(
      `WebSocket server not available: ${reason}`,
      'SERVER_NOT_AVAILABLE',
      503
    )
    this.name = 'ServerNotAvailableError'
  }
}

export class ConnectionLimitError extends WebSocketError {
  constructor(maxConnections: number) {
    super(
      `Maximum number of WebSocket connections reached: ${maxConnections}`,
      'CONNECTION_LIMIT_EXCEEDED',
      429
    )
    this.name = 'ConnectionLimitError'
  }
}

export class HandlerExecutionError extends WebSocketError {
  constructor(path: string, originalError: Error) {
    super(
      `Error executing WebSocket handler for ${path}: ${originalError.message}`,
      'HANDLER_EXECUTION_ERROR',
      500
    )
    this.name = 'HandlerExecutionError'
    if (originalError.stack) {
      this.stack += `\nCaused by: ${originalError.stack}`
    }
  }
}

// Check if an error is a WebSocket-specific error
export function isWebSocketError(error: unknown): error is WebSocketError {
  return error instanceof WebSocketError
}

// Get appropriate HTTP status code from an error
export function getErrorStatusCode(error: unknown): number {
  if (isWebSocketError(error)) {
    return error.statusCode || 500
  }
  return 500
}

// Get a safe error message for client responses
export function getSafeErrorMessage(
  error: unknown,
  includeStack = false
): string {
  if (isWebSocketError(error)) {
    return includeStack && error.stack
      ? `${error.message}\n${error.stack}`
      : error.message
  }

  if (error instanceof Error) {
    return includeStack && error.stack
      ? `${error.message}\n${error.stack}`
      : error.message
  }

  return 'An unexpected error occurred'
}

// Error recovery strategies
export enum RecoveryStrategy {
  CLOSE_CONNECTION = 'close',
  TERMINATE_CONNECTION = 'terminate',
  RETRY = 'retry',
  IGNORE = 'ignore',
}

// Get recommended recovery strategy for an error
export function getRecoveryStrategy(error: unknown): RecoveryStrategy {
  if (isWebSocketError(error)) {
    switch (error.code) {
      case 'ROUTE_NOT_FOUND':
      case 'HANDLER_NOT_FOUND':
        return RecoveryStrategy.CLOSE_CONNECTION

      case 'MODULE_IMPORT_ERROR':
      case 'HANDLER_EXECUTION_ERROR':
        return RecoveryStrategy.TERMINATE_CONNECTION

      case 'SERVER_NOT_AVAILABLE':
        return RecoveryStrategy.CLOSE_CONNECTION

      case 'CONNECTION_LIMIT_EXCEEDED':
        return RecoveryStrategy.CLOSE_CONNECTION

      default:
        return RecoveryStrategy.TERMINATE_CONNECTION
    }
  }

  return RecoveryStrategy.TERMINATE_CONNECTION
}
