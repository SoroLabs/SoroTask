/**
 * Browser Logger Utility
 * 
 * Simple logging utility for the frontend with support for different log levels.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.context}] [${level.toUpperCase()}]`;

    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  debug(message: string, data?: unknown): void {
    this.formatMessage('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.formatMessage('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.formatMessage('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.formatMessage('error', message, data);
  }
}

/**
 * Creates a logger with the given context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
