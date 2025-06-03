import { CacheService } from '../services/cache';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ maxSize: 100, defaultTtl: 1000 });
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe('basic operations', () => {
    it('should set and get values', async () => {
      await cache.set('test-key', 'test-value');
      const result = await cache.get('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('non-existent');
      expect(result).toBeNull();
    });

    it('should check if key exists', async () => {
      await cache.set('test-key', 'test-value');
      const exists = await cache.has('test-key');
      expect(exists).toBe(true);
    });

    it('should delete keys', async () => {
      await cache.set('test-key', 'test-value');
      await cache.delete('test-key');
      const result = await cache.get('test-key');
      expect(result).toBeNull();
    });
  });

  describe('TTL functionality', () => {
    it('should respect custom TTL', async () => {
      await cache.set('test-key', 'test-value', 50); // 50ms TTL
      
      // Should exist immediately
      expect(await cache.get('test-key')).toBe('test-value');
      
      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should be expired
      expect(await cache.get('test-key')).toBeNull();
    });
  });

  describe('pattern invalidation', () => {
    it('should invalidate keys matching pattern', async () => {
      await cache.set('component:file1:comp1', 'data1');
      await cache.set('component:file1:comp2', 'data2');
      await cache.set('tokens:file1', 'tokens');
      
      await cache.invalidatePattern('component:file1:.*');
      
      expect(await cache.get('component:file1:comp1')).toBeNull();
      expect(await cache.get('component:file1:comp2')).toBeNull();
      expect(await cache.get('tokens:file1')).toBe('tokens');
    });
  });

  describe('static helpers', () => {
    it('should generate correct cache keys', () => {
      expect(CacheService.keys.component('file1', 'comp1')).toBe('component:file1:comp1');
      expect(CacheService.keys.designTokens('file1')).toBe('tokens:file1');
    });

    it('should have predefined TTL values', () => {
      expect(CacheService.ttl.component).toBe(3600000);
      expect(CacheService.ttl.designTokens).toBe(86400000);
    });
  });
});