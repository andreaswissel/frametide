import { FigmaUrlParser, createFigmaUrl } from '../utils/figma-url';

describe('FigmaUrlParser', () => {
  describe('parse', () => {
    it('should parse standard Figma file URLs', () => {
      const url = 'https://www.figma.com/file/abc123/My-Design-File';
      const result = FigmaUrlParser.parse(url);
      
      expect(result.fileId).toBe('abc123');
      expect(result.fileName).toBe('My-Design-File');
      expect(result.nodeId).toBeUndefined();
      expect(result.url).toBe(url);
    });

    it('should parse design URLs', () => {
      const url = 'https://www.figma.com/design/xyz789/Another-File';
      const result = FigmaUrlParser.parse(url);
      
      expect(result.fileId).toBe('xyz789');
      expect(result.fileName).toBe('Another-File');
    });

    it('should parse URLs with node IDs', () => {
      const url = 'https://www.figma.com/file/abc123/My-File?node-id=123%3A456';
      const result = FigmaUrlParser.parse(url);
      
      expect(result.fileId).toBe('abc123');
      expect(result.nodeId).toBe('123:456');
    });

    it('should parse URLs without protocol', () => {
      const url = 'https://figma.com/file/abc123/My-File';
      const result = FigmaUrlParser.parse(url);
      
      expect(result.fileId).toBe('abc123');
      expect(result.fileName).toBe('My-File');
    });

    it('should handle URL encoded file names', () => {
      const url = 'https://www.figma.com/file/abc123/My%20Design%20File';
      const result = FigmaUrlParser.parse(url);
      
      expect(result.fileName).toBe('My Design File');
    });

    it('should throw error for invalid URLs', () => {
      expect(() => FigmaUrlParser.parse('https://invalid.com/file/123')).toThrow();
      expect(() => FigmaUrlParser.parse('not-a-url')).toThrow();
      expect(() => FigmaUrlParser.parse('')).toThrow();
    });
  });

  describe('isValidFigmaUrl', () => {
    it('should return true for valid URLs', () => {
      expect(FigmaUrlParser.isValidFigmaUrl('https://www.figma.com/file/abc123/My-File')).toBe(true);
      expect(FigmaUrlParser.isValidFigmaUrl('https://figma.com/design/xyz789/File')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(FigmaUrlParser.isValidFigmaUrl('https://invalid.com/file/123')).toBe(false);
      expect(FigmaUrlParser.isValidFigmaUrl('not-a-url')).toBe(false);
    });
  });

  describe('extractFileId', () => {
    it('should extract file ID from URL', () => {
      const fileId = FigmaUrlParser.extractFileId('https://www.figma.com/file/abc123/My-File');
      expect(fileId).toBe('abc123');
    });
  });

  describe('extractNodeId', () => {
    it('should extract node ID from URL', () => {
      const nodeId = FigmaUrlParser.extractNodeId('https://www.figma.com/file/abc123/File?node-id=123%3A456');
      expect(nodeId).toBe('123:456');
    });

    it('should return undefined if no node ID', () => {
      const nodeId = FigmaUrlParser.extractNodeId('https://www.figma.com/file/abc123/File');
      expect(nodeId).toBeUndefined();
    });
  });
});

describe('createFigmaUrl', () => {
  it('should create basic URL', () => {
    const url = createFigmaUrl('abc123');
    expect(url).toBe('https://www.figma.com/design/abc123');
  });

  it('should create URL with file name', () => {
    const url = createFigmaUrl('abc123', 'My File');
    expect(url).toBe('https://www.figma.com/design/abc123/My%20File');
  });

  it('should create URL with node ID', () => {
    const url = createFigmaUrl('abc123', 'My File', '123:456');
    expect(url).toBe('https://www.figma.com/design/abc123/My%20File?node-id=123%3A456');
  });
});