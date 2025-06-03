export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  error?: Record<string, any>;
  requestId?: string;
}

export class Logger {
  private level: LogLevel;
  private requestId?: string;

  constructor(level: string = 'info') {
    this.level = this.parseLogLevel(level);
  }

  setRequestId(requestId: string) {
    this.requestId = requestId;
  }

  error(message: string, context?: Record<string, any>, error?: Error) {
    this.log(LogLevel.ERROR, message, context, error);
  }

  warn(message: string, context?: Record<string, any>) {
    this.log(LogLevel.WARN, message, context);
  }

  info(message: string, context?: Record<string, any>) {
    this.log(LogLevel.INFO, message, context);
  }

  debug(message: string, context?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error) {
    if (level > this.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      ...(context && { context }),
      ...(error && { error: this.serializeError(error) }),
      ...(this.requestId && { requestId: this.requestId }),
    };

    const output = JSON.stringify(entry);

    // Send to stderr to avoid interfering with MCP stdio communication
    if (level === LogLevel.ERROR) {
      console.error(output);
    } else {
      console.error(output);
    }
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error': return LogLevel.ERROR;
      case 'warn': return LogLevel.WARN;
      case 'info': return LogLevel.INFO;
      case 'debug': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private serializeError(error: Error): Record<string, any> {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error instanceof Error && { ...error }),
    };
  }
}

// Global logger instance
export const logger = new Logger(process.env.LOG_LEVEL || 'info');