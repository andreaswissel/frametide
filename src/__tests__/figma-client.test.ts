import { FigmaClient, FigmaApiError } from '../figma/client.js';

// Mock node-fetch
jest.mock('node-fetch');
import fetch from 'node-fetch';
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('FigmaClient', () => {
  let client: FigmaClient;

  beforeEach(() => {
    process.env.FIGMA_ACCESS_TOKEN = 'test-token';
    client = new FigmaClient();
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.FIGMA_ACCESS_TOKEN;
  });

  describe('constructor', () => {
    it('should throw error when no access token is provided', () => {
      delete process.env.FIGMA_ACCESS_TOKEN;
      expect(() => new FigmaClient()).toThrow('FIGMA_ACCESS_TOKEN environment variable is required');
    });

    it('should initialize with default config', () => {
      expect(client).toBeInstanceOf(FigmaClient);
    });

    it('should accept custom config', () => {
      const customClient = new FigmaClient({
        accessToken: 'custom-token',
        apiVersion: 'v2',
        baseUrl: 'https://custom.api.com',
      });
      expect(customClient).toBeInstanceOf(FigmaClient);
    });
  });

  describe('getFile', () => {
    it('should make successful API call', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          document: { id: '0:0', name: 'Document' },
          components: {},
          componentSets: {},
        }),
      };
      
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.getFile('test-file-id');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.figma.com/v1/files/test-file-id',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Figma-Token': 'test-token',
            'User-Agent': 'figma-mcp-server/1.0.0',
          }),
        })
      );

      expect(result).toEqual({
        document: { id: '0:0', name: 'Document' },
        components: {},
        componentSets: {},
      });
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"err": "Not found", "message": "File not found", "status": 404}'),
      };
      
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(client.getFile('invalid-file-id')).rejects.toThrow(FigmaApiError);
    });
  });

  describe('rate limiting', () => {
    it('should track request count', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      };
      
      mockFetch.mockResolvedValue(mockResponse as any);

      await client.getFile('test-file-1');
      await client.getFile('test-file-2');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return remaining requests', () => {
      const remaining = client.getRemainingRequests();
      expect(remaining).toBeGreaterThan(0);
    });
  });
});