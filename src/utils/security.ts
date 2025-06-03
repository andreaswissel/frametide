import { z } from 'zod';
import { logger } from './logger.js';

export class SecurityValidator {
  private static readonly MAX_STRING_LENGTH = 1000;
  private static readonly MAX_ARRAY_LENGTH = 100;
  private static readonly ALLOWED_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
  private static readonly ALLOWED_NODE_ID_PATTERN = /^\d{1,10}:\d{1,10}$/;

  static validateFileId(fileId: string): boolean {
    if (!fileId || typeof fileId !== 'string') {
      return false;
    }
    return this.ALLOWED_FILE_ID_PATTERN.test(fileId);
  }

  static validateNodeId(nodeId: string): boolean {
    if (!nodeId || typeof nodeId !== 'string') {
      return false;
    }
    return this.ALLOWED_NODE_ID_PATTERN.test(nodeId);
  }

  static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      throw new Error('Input must be a string');
    }
    
    if (input.length > this.MAX_STRING_LENGTH) {
      throw new Error(`String too long. Maximum length: ${this.MAX_STRING_LENGTH}`);
    }

    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/data:/gi, '') // Remove data: protocol
      .trim();
  }

  static sanitizeArray<T>(input: T[]): T[] {
    if (!Array.isArray(input)) {
      throw new Error('Input must be an array');
    }

    if (input.length > this.MAX_ARRAY_LENGTH) {
      throw new Error(`Array too long. Maximum length: ${this.MAX_ARRAY_LENGTH}`);
    }

    return input;
  }

  static validateAndSanitizeArgs(args: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeString(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = this.sanitizeArray(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.validateAndSanitizeArgs(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

export class RateLimiter {
  private clients = new Map<string, { count: number; resetTime: number; }>();
  private readonly maxRequestsPerHour: number;
  private readonly windowMs: number;

  constructor(maxRequestsPerHour: number = 100) {
    this.maxRequestsPerHour = maxRequestsPerHour;
    this.windowMs = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  async checkLimit(clientId: string): Promise<{ allowed: boolean; resetTime?: number }> {
    const now = Date.now();
    const client = this.clients.get(clientId);

    if (!client || now > client.resetTime) {
      // New client or window has reset
      this.clients.set(clientId, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      
      logger.debug('Rate limit check passed', { 
        clientId, 
        count: 1, 
        maxRequests: this.maxRequestsPerHour 
      });
      
      return { allowed: true };
    }

    if (client.count >= this.maxRequestsPerHour) {
      logger.warn('Rate limit exceeded', { 
        clientId, 
        count: client.count, 
        maxRequests: this.maxRequestsPerHour,
        resetTime: client.resetTime 
      });
      
      return { 
        allowed: false, 
        resetTime: client.resetTime 
      };
    }

    // Increment count
    client.count++;
    this.clients.set(clientId, client);
    
    logger.debug('Rate limit check passed', { 
      clientId, 
      count: client.count, 
      maxRequests: this.maxRequestsPerHour 
    });

    return { allowed: true };
  }

  getRemainingRequests(clientId: string): number {
    const client = this.clients.get(clientId);
    if (!client || Date.now() > client.resetTime) {
      return this.maxRequestsPerHour;
    }
    return Math.max(0, this.maxRequestsPerHour - client.count);
  }

  // Clean up expired entries periodically
  cleanup() {
    const now = Date.now();
    for (const [clientId, client] of this.clients.entries()) {
      if (now > client.resetTime) {
        this.clients.delete(clientId);
      }
    }
  }
}

export class AuditLogger {
  static logToolCall(
    toolName: string, 
    args: Record<string, any>, 
    clientId?: string,
    requestId?: string
  ) {
    logger.info('Tool called', {
      tool: toolName,
      args: this.sanitizeArgsForLogging(args),
      clientId,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  static logToolResult(
    toolName: string, 
    success: boolean, 
    duration: number,
    error?: Error,
    clientId?: string,
    requestId?: string
  ) {
    if (success) {
      logger.info('Tool completed successfully', {
        tool: toolName,
        duration,
        clientId,
        requestId,
      });
    } else {
      logger.error('Tool failed', {
        tool: toolName,
        duration,
        clientId,
        requestId,
      }, error);
    }
  }

  static logSecurityEvent(
    event: string, 
    details: Record<string, any>,
    clientId?: string
  ) {
    logger.warn('Security event', {
      event,
      details,
      clientId,
      timestamp: new Date().toISOString(),
    });
  }

  private static sanitizeArgsForLogging(args: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(args)) {
      // Don't log sensitive data
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('password')) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = `${value.substring(0, 100)}...[TRUNCATED]`;
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}