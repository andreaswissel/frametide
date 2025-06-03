import fetch from 'node-fetch';
import { FigmaFile, FigmaNode } from '../types/figma.js';

export interface FigmaClientConfig {
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  rateLimit?: {
    requestsPerHour: number;
    burstLimit: number;
  };
}

export interface FigmaApiErrorData {
  status: number;
  err: string;
  message: string;
}

export class FigmaClient {
  private config: FigmaClientConfig;
  private requestCount = 0;
  private lastResetTime = Date.now();

  constructor(config?: Partial<FigmaClientConfig>) {
    this.config = {
      accessToken: process.env.FIGMA_ACCESS_TOKEN || '',
      apiVersion: 'v1',
      baseUrl: 'https://api.figma.com',
      rateLimit: {
        requestsPerHour: 1000,
        burstLimit: 100,
      },
      ...config,
    };

    if (!this.config.accessToken) {
      throw new Error('FIGMA_ACCESS_TOKEN environment variable is required');
    }
  }

  async getFile(fileId: string): Promise<FigmaFile> {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/files/${fileId}`;
    return this.makeRequest<FigmaFile>(url);
  }

  async getNodes(fileId: string, nodeIds: string[]): Promise<{ nodes: Record<string, FigmaNode> }> {
    const ids = nodeIds.join(',');
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/files/${fileId}/nodes?ids=${ids}`;
    return this.makeRequest<{ nodes: Record<string, FigmaNode> }>(url);
  }

  async getFileStyles(fileId: string): Promise<{ meta: { styles: any[] } }> {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/files/${fileId}/styles`;
    return this.makeRequest<{ meta: { styles: any[] } }>(url);
  }

  async getLocalVariables(fileId: string): Promise<{ meta: { variables: any[], variableCollections: any[] } }> {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/files/${fileId}/variables/local`;
    return this.makeRequest<{ meta: { variables: any[], variableCollections: any[] } }>(url);
  }

  async getTeamProjects(teamId: string): Promise<{ projects: any[] }> {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/teams/${teamId}/projects`;
    return this.makeRequest<{ projects: any[] }>(url);
  }

  async getProjectFiles(projectId: string): Promise<{ files: any[] }> {
    const url = `${this.config.baseUrl}/${this.config.apiVersion}/projects/${projectId}/files`;
    return this.makeRequest<{ files: any[] }>(url);
  }

  private async makeRequest<T>(url: string): Promise<T> {
    await this.waitForRateLimit();

    const response = await fetch(url, {
      headers: {
        'X-Figma-Token': this.config.accessToken,
        'User-Agent': 'figma-mcp-server/1.0.0',
      },
    });

    this.requestCount++;

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: FigmaApiErrorData;
      
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        errorData = {
          status: response.status,
          err: response.statusText,
          message: errorBody || 'Unknown error',
        };
      }

      throw new FigmaApiError(errorData.message, response.status, errorData);
    }

    const data = await response.json() as T;
    return data;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const hoursSinceReset = (now - this.lastResetTime) / (1000 * 60 * 60);

    // Reset counter every hour
    if (hoursSinceReset >= 1) {
      this.requestCount = 0;
      this.lastResetTime = now;
      return;
    }

    // Check if we've exceeded the hourly limit
    if (this.requestCount >= this.config.rateLimit!.requestsPerHour) {
      const waitTime = (1 - hoursSinceReset) * 60 * 60 * 1000; // Wait until next hour
      console.warn(`Rate limit exceeded. Waiting ${Math.round(waitTime / 1000)} seconds...`);
      await this.delay(waitTime);
      this.requestCount = 0;
      this.lastResetTime = Date.now();
    }

    // Simple burst protection - add small delay between requests
    if (this.requestCount > 0 && this.requestCount % 10 === 0) {
      await this.delay(100); // 100ms delay every 10 requests
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRemainingRequests(): number {
    const hoursSinceReset = (Date.now() - this.lastResetTime) / (1000 * 60 * 60);
    
    if (hoursSinceReset >= 1) {
      return this.config.rateLimit!.requestsPerHour;
    }
    
    return Math.max(0, this.config.rateLimit!.requestsPerHour - this.requestCount);
  }
}

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorData: FigmaApiErrorData
  ) {
    super(message);
    this.name = 'FigmaApiError';
  }
}