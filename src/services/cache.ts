import { LRUCache } from 'lru-cache';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface CacheOptions {
  maxSize?: number;
  defaultTtl?: number;
}

export class CacheService {
  private memoryCache: LRUCache<string, CacheEntry>;
  private defaultTtl: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTtl = options.defaultTtl || 3600000; // 1 hour default

    this.memoryCache = new LRUCache({
      max: options.maxSize || 1000,
      ttl: this.defaultTtl,
      updateAgeOnGet: true,
      allowStale: false,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.memoryCache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
    };

    this.memoryCache.set(key, entry);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.memoryCache.get(key);
    
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.memoryCache.delete(key);
      return false;
    }

    return true;
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);
    const keysToDelete: string[] = [];

    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.memoryCache.delete(key));
  }

  getStats() {
    return {
      size: this.memoryCache.size,
      calculatedSize: this.memoryCache.calculatedSize,
      max: this.memoryCache.max,
    };
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  // Predefined cache key generators and TTLs
  static keys = {
    component: (fileId: string, componentId: string) => `component:${fileId}:${componentId}`,
    componentList: (fileId: string) => `components:${fileId}`,
    designTokens: (fileId: string) => `tokens:${fileId}`,
    fileMetadata: (fileId: string) => `file:${fileId}:meta`,
    fileStyles: (fileId: string) => `file:${fileId}:styles`,
    componentSpec: (fileId: string, componentId: string) => `spec:${fileId}:${componentId}`,
  };

  static ttl = {
    component: 3600000,      // 1 hour
    componentList: 1800000,  // 30 minutes
    designTokens: 86400000,  // 24 hours
    fileMetadata: 300000,    // 5 minutes
    fileStyles: 3600000,     // 1 hour
    componentSpec: 3600000,  // 1 hour
  };
}