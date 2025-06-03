export interface ParsedFigmaUrl {
  fileId: string;
  fileName?: string;
  nodeId?: string;
  url: string;
}

export class FigmaUrlParser {
  private static readonly FIGMA_URL_PATTERNS = [
    /^https:\/\/www\.figma\.com\/file\/([a-zA-Z0-9_-]+)\/([^/?]*)/,
    /^https:\/\/www\.figma\.com\/design\/([a-zA-Z0-9_-]+)\/([^/?]*)/,
    /^https:\/\/figma\.com\/file\/([a-zA-Z0-9_-]+)\/([^/?]*)/,
    /^https:\/\/figma\.com\/design\/([a-zA-Z0-9_-]+)\/([^/?]*)/,
  ];

  private static readonly NODE_ID_PATTERN = /node-id=([^&]+)/;

  static parse(url: string): ParsedFigmaUrl {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL: URL must be a non-empty string');
    }

    // Try each pattern
    for (const pattern of this.FIGMA_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match) {
        const fileId = match[1];
        const fileName = match[2] ? decodeURIComponent(match[2]) : undefined;
        
        // Check for node ID in query parameters
        const nodeMatch = url.match(this.NODE_ID_PATTERN);
        const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined;

        return {
          fileId,
          fileName,
          nodeId,
          url: url.trim(),
        };
      }
    }

    throw new Error('Invalid Figma URL format. Expected: https://www.figma.com/file/FILE_ID/File-Name or https://www.figma.com/design/FILE_ID/File-Name');
  }

  static isValidFigmaUrl(url: string): boolean {
    try {
      this.parse(url);
      return true;
    } catch {
      return false;
    }
  }

  static extractFileId(url: string): string {
    return this.parse(url).fileId;
  }

  static extractNodeId(url: string): string | undefined {
    return this.parse(url).nodeId;
  }
}

export function createFigmaUrl(fileId: string, fileName?: string, nodeId?: string): string {
  const baseUrl = `https://www.figma.com/design/${fileId}`;
  const name = fileName ? `/${encodeURIComponent(fileName)}` : '';
  const node = nodeId ? `?node-id=${encodeURIComponent(nodeId)}` : '';
  
  return `${baseUrl}${name}${node}`;
}