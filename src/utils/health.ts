import { FigmaClient } from '../figma/client.js';
import { CacheService } from '../services/cache.js';
import { logger } from './logger.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: {
    figmaApi: HealthCheck;
    cache: HealthCheck;
    memory: HealthCheck;
    uptime: HealthCheck;
  };
  timestamp: string;
  version: string;
}

export interface HealthCheck {
  status: 'pass' | 'fail' | 'warn';
  duration?: number;
  message?: string;
  details?: Record<string, any>;
}

export class HealthMonitor {
  private figmaClient: FigmaClient;
  private cache: CacheService;
  private startTime: number;

  constructor(figmaClient: FigmaClient, cache: CacheService) {
    this.figmaClient = figmaClient;
    this.cache = cache;
    this.startTime = Date.now();
  }

  async checkHealth(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkFigmaApi(),
      this.checkCache(),
      this.checkMemory(),
      this.checkUptime(),
    ]);

    const [figmaApi, cache, memory, uptime] = checks.map(result => 
      result.status === 'fulfilled' ? result.value : this.failedCheck(result.reason)
    );

    const overallStatus = this.determineOverallStatus([figmaApi, cache, memory, uptime]);

    return {
      status: overallStatus,
      checks: { figmaApi, cache, memory, uptime },
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  private async checkFigmaApi(): Promise<HealthCheck> {
    const start = Date.now();
    
    try {
      // Try to access Figma API with a simple request
      const remaining = this.figmaClient.getRemainingRequests();
      const duration = Date.now() - start;

      if (remaining < 10) {
        return {
          status: 'warn',
          duration,
          message: 'Figma API rate limit approaching',
          details: { remainingRequests: remaining },
        };
      }

      return {
        status: 'pass',
        duration,
        message: 'Figma API accessible',
        details: { remainingRequests: remaining },
      };
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Figma API health check failed', { duration }, error as Error);
      
      return {
        status: 'fail',
        duration,
        message: 'Figma API not accessible',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkCache(): Promise<HealthCheck> {
    const start = Date.now();
    
    try {
      const testKey = 'health-check';
      const testValue = { timestamp: Date.now() };
      
      await this.cache.set(testKey, testValue, 1000);
      const retrieved = await this.cache.get(testKey);
      await this.cache.delete(testKey);
      
      const duration = Date.now() - start;
      
      if (!retrieved || (retrieved as any).timestamp !== testValue.timestamp) {
        return {
          status: 'fail',
          duration,
          message: 'Cache read/write failed',
        };
      }

      const stats = this.cache.getStats();
      
      return {
        status: 'pass',
        duration,
        message: 'Cache operational',
        details: stats,
      };
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Cache health check failed', { duration }, error as Error);
      
      return {
        status: 'fail',
        duration,
        message: 'Cache not operational',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkMemory(): Promise<HealthCheck> {
    const start = Date.now();
    
    try {
      const memUsage = process.memoryUsage();
      const duration = Date.now() - start;
      
      // Convert to MB
      const rss = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
      
      // Warn if heap usage is over 80%
      const heapUsagePercentage = (heapUsed / heapTotal) * 100;
      
      const status = heapUsagePercentage > 80 ? 'warn' : 'pass';
      const message = status === 'warn' 
        ? 'High memory usage detected' 
        : 'Memory usage normal';

      return {
        status,
        duration,
        message,
        details: {
          rss: `${rss}MB`,
          heapUsed: `${heapUsed}MB`,
          heapTotal: `${heapTotal}MB`,
          heapUsagePercentage: `${heapUsagePercentage.toFixed(1)}%`,
        },
      };
    } catch (error) {
      const duration = Date.now() - start;
      
      return {
        status: 'fail',
        duration,
        message: 'Memory check failed',
        details: { error: (error as Error).message },
      };
    }
  }

  private async checkUptime(): Promise<HealthCheck> {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);

    return {
      status: 'pass',
      duration: 0,
      message: 'Server uptime normal',
      details: {
        uptimeMs,
        uptime: `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`,
      },
    };
  }

  private failedCheck(error: any): HealthCheck {
    return {
      status: 'fail',
      message: 'Health check threw an exception',
      details: { error: error.message },
    };
  }

  private determineOverallStatus(checks: HealthCheck[]): 'healthy' | 'unhealthy' | 'degraded' {
    const statuses = checks.map(check => check.status);
    
    if (statuses.includes('fail')) {
      return 'unhealthy';
    }
    
    if (statuses.includes('warn')) {
      return 'degraded';
    }
    
    return 'healthy';
  }
}

export class MetricsCollector {
  private metrics = new Map<string, number>();
  private counters = new Map<string, number>();
  private timers = new Map<string, number[]>();

  incrementCounter(name: string, value: number = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  recordTimer(name: string, duration: number) {
    const existing = this.timers.get(name) || [];
    existing.push(duration);
    
    // Keep only last 100 measurements
    if (existing.length > 100) {
      existing.shift();
    }
    
    this.timers.set(name, existing);
  }

  setGauge(name: string, value: number) {
    this.metrics.set(name, value);
  }

  getMetrics() {
    const timerStats = new Map<string, { avg: number; min: number; max: number; count: number }>();
    
    for (const [name, values] of this.timers.entries()) {
      if (values.length > 0) {
        timerStats.set(name, {
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        });
      }
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.metrics),
      timers: Object.fromEntries(timerStats),
      timestamp: new Date().toISOString(),
    };
  }

  reset() {
    this.metrics.clear();
    this.counters.clear();
    this.timers.clear();
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();