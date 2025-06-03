#!/usr/bin/env node

// Load environment variables from .env file
import { config } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env from project root
config({ path: join(__dirname, '../.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { FigmaClient } from './figma/client.js';
import { ComponentExtractor } from './extractors/component.js';
import { DesignTokenExtractor } from './extractors/design-tokens.js';
import { CacheService } from './services/cache.js';
import { validateEnvironment } from './utils/validation.js';
import { logger } from './utils/logger.js';
import { SecurityValidator, RateLimiter, AuditLogger, generateRequestId } from './utils/security.js';
import { HealthMonitor, metrics } from './utils/health.js';
import { SessionManager } from './services/session.js';
import { FigmaUrlParser } from './utils/figma-url.js';

export class FigmaMcpServer {
  private server: Server;
  private figmaClient: FigmaClient;
  private componentExtractor: ComponentExtractor;
  private designTokenExtractor: DesignTokenExtractor;
  private cache: CacheService;
  private rateLimiter: RateLimiter;
  private healthMonitor: HealthMonitor;
  private sessionManager: SessionManager;

  constructor() {
    this.server = new Server(
      {
        name: 'figma-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize services
    this.figmaClient = new FigmaClient();
    this.cache = new CacheService();
    this.componentExtractor = new ComponentExtractor(this.figmaClient, this.cache);
    this.designTokenExtractor = new DesignTokenExtractor(this.figmaClient, this.cache);
    this.rateLimiter = new RateLimiter(100); // 100 requests per hour per client
    this.healthMonitor = new HealthMonitor(this.figmaClient, this.cache);
    this.sessionManager = new SessionManager();

    this.setupHandlers();
    this.setupGracefulShutdown();
    
    logger.info('Figma MCP Server initialized', {
      version: '1.0.0',
      nodeEnv: process.env.NODE_ENV,
    });
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get-component',
            description: 'Extract detailed information about a specific Figma component',
            inputSchema: {
              type: 'object',
              properties: {
                fileId: {
                  type: 'string',
                  description: 'Figma file identifier',
                },
                componentId: {
                  type: 'string',
                  description: 'Component node identifier',
                },
                includeVariants: {
                  type: 'boolean',
                  description: 'Include component variants in response',
                  default: true,
                },
                includeInstances: {
                  type: 'boolean',
                  description: 'Include component instances',
                  default: false,
                },
              },
              required: ['fileId', 'componentId'],
            },
          },
          {
            name: 'list-components',
            description: 'Get all components from a Figma file',
            inputSchema: {
              type: 'object',
              properties: {
                fileId: {
                  type: 'string',
                  description: 'Figma file identifier',
                },
                filter: {
                  type: 'object',
                  description: 'Filter criteria',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['COMPONENT', 'COMPONENT_SET'],
                      description: 'Filter by component type',
                    },
                    name: {
                      type: 'string',
                      description: 'Filter by name pattern (regex supported)',
                    },
                    published: {
                      type: 'boolean',
                      description: 'Filter by published status',
                    },
                  },
                },
              },
              required: ['fileId'],
            },
          },
          {
            name: 'get-design-tokens',
            description: 'Extract design tokens from a Figma file',
            inputSchema: {
              type: 'object',
              properties: {
                fileId: {
                  type: 'string',
                  description: 'Figma file identifier',
                },
                tokenTypes: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['colors', 'typography', 'spacing', 'effects', 'all'],
                  },
                  default: ['all'],
                },
                format: {
                  type: 'string',
                  enum: ['standard', 'css-variables'],
                  default: 'standard',
                },
              },
              required: ['fileId'],
            },
          },
          {
            name: 'get-component-specification',
            description: 'Get comprehensive component specification for any framework',
            inputSchema: {
              type: 'object',
              properties: {
                fileId: {
                  type: 'string',
                  description: 'Figma file identifier',
                },
                componentId: {
                  type: 'string',
                  description: 'Component node identifier',
                },
                includeAccessibility: {
                  type: 'boolean',
                  description: 'Include accessibility specifications',
                  default: true,
                },
                includeInteractions: {
                  type: 'boolean',
                  description: 'Include interaction specifications',
                  default: true,
                },
              },
              required: ['fileId', 'componentId'],
            },
          },
          {
            name: 'check-component-changes',
            description: 'Check if Figma components have been modified since last sync',
            inputSchema: {
              type: 'object',
              properties: {
                fileId: {
                  type: 'string',
                  description: 'Figma file identifier',
                },
                lastSyncTimestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Last synchronization timestamp',
                },
                componentIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Specific components to check (optional)',
                },
              },
              required: ['fileId', 'lastSyncTimestamp'],
            },
          },
          {
            name: 'set-working-file',
            description: 'Set the current working Figma file from a URL for the session',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Figma file URL (e.g., https://www.figma.com/design/FILE_ID/File-Name)',
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'get-working-file-info',
            description: 'Get information about the current working file and implementation status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get-implementation-queue',
            description: 'Get all components organized by implementation status',
            inputSchema: {
              type: 'object',
              properties: {
                filter: {
                  type: 'object',
                  description: 'Optional filter for components',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['COMPONENT', 'COMPONENT_SET'],
                    },
                    name: {
                      type: 'string',
                      description: 'Filter by name pattern',
                    },
                  },
                },
              },
            },
          },
          {
            name: 'get-component-for-implementation',
            description: 'Get comprehensive implementation details for a specific component',
            inputSchema: {
              type: 'object',
              properties: {
                componentId: {
                  type: 'string',
                  description: 'Component identifier',
                },
                includeUsageExamples: {
                  type: 'boolean',
                  description: 'Include usage examples and guidelines',
                  default: true,
                },
                targetFramework: {
                  type: 'string',
                  description: 'Target framework for implementation hints',
                  enum: ['react', 'angular', 'vue', 'svelte', 'generic'],
                  default: 'generic',
                },
              },
              required: ['componentId'],
            },
          },
          {
            name: 'update-component-status',
            description: 'Update the implementation status of a component',
            inputSchema: {
              type: 'object',
              properties: {
                componentId: {
                  type: 'string',
                  description: 'Component identifier',
                },
                componentName: {
                  type: 'string',
                  description: 'Component name',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in-progress', 'implemented', 'needs-update'],
                  description: 'Implementation status',
                },
                notes: {
                  type: 'string',
                  description: 'Optional notes about the implementation',
                },
                framework: {
                  type: 'string',
                  description: 'Framework used for implementation',
                },
              },
              required: ['componentId', 'componentName', 'status'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const requestId = generateRequestId();
      const clientId = this.extractClientId(request);
      const startTime = Date.now();

      logger.setRequestId(requestId);

      try {
        // Rate limiting
        const rateLimit = await this.rateLimiter.checkLimit(clientId);
        if (!rateLimit.allowed) {
          metrics.incrementCounter('requests_rate_limited');
          throw new McpError(
            ErrorCode.InternalError,
            `Rate limit exceeded. Try again after ${new Date(rateLimit.resetTime!).toISOString()}`
          );
        }

        // Security validation
        const sanitizedArgs = SecurityValidator.validateAndSanitizeArgs(args || {});
        
        // Audit logging
        AuditLogger.logToolCall(name, sanitizedArgs, clientId, requestId);
        
        metrics.incrementCounter('requests_total');
        metrics.incrementCounter(`requests_${name}`);

        let result;
        switch (name) {
          case 'get-component':
            result = await this.handleGetComponent(sanitizedArgs);
            break;
          
          case 'list-components':
            result = await this.handleListComponents(sanitizedArgs);
            break;
          
          case 'get-design-tokens':
            result = await this.handleGetDesignTokens(sanitizedArgs);
            break;
          
          case 'get-component-specification':
            result = await this.handleGetComponentSpecification(sanitizedArgs);
            break;
          
          case 'check-component-changes':
            result = await this.handleCheckComponentChanges(sanitizedArgs);
            break;
          
          case 'set-working-file':
            result = await this.handleSetWorkingFile(sanitizedArgs, clientId);
            break;
          
          case 'get-working-file-info':
            result = await this.handleGetWorkingFileInfo(clientId);
            break;
          
          case 'get-implementation-queue':
            result = await this.handleGetImplementationQueue(sanitizedArgs, clientId);
            break;
          
          case 'get-component-for-implementation':
            result = await this.handleGetComponentForImplementation(sanitizedArgs, clientId);
            break;
          
          case 'update-component-status':
            result = await this.handleUpdateComponentStatus(sanitizedArgs, clientId);
            break;
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }

        const duration = Date.now() - startTime;
        metrics.recordTimer(`tool_duration_${name}`, duration);
        AuditLogger.logToolResult(name, true, duration, undefined, clientId, requestId);
        
        return result;

      } catch (error) {
        const duration = Date.now() - startTime;
        metrics.incrementCounter('requests_failed');
        metrics.recordTimer(`tool_duration_${name}`, duration);
        
        AuditLogger.logToolResult(name, false, duration, error as Error, clientId, requestId);
        
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private async handleGetComponent(args: any) {
    const { fileId, componentId, includeVariants = true, includeInstances = false } = args;
    
    const component = await this.componentExtractor.extractComponent({
      fileId,
      componentId,
      includeVariants,
      includeInstances,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(component, null, 2),
        },
      ],
    };
  }

  private async handleListComponents(args: any) {
    const { fileId, filter } = args;
    
    const components = await this.componentExtractor.listComponents(fileId, filter);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(components, null, 2),
        },
      ],
    };
  }

  private async handleGetDesignTokens(args: any) {
    const { fileId, tokenTypes = ['all'], format = 'standard' } = args;
    
    const tokens = await this.designTokenExtractor.extractTokens({
      fileId,
      tokenTypes,
      format,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(tokens, null, 2),
        },
      ],
    };
  }

  private async handleGetComponentSpecification(args: any) {
    const { fileId, componentId, includeAccessibility = true, includeInteractions = true } = args;
    
    const specification = await this.componentExtractor.extractComponentSpecification({
      fileId,
      componentId,
      includeAccessibility,
      includeInteractions,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(specification, null, 2),
        },
      ],
    };
  }

  private async handleCheckComponentChanges(args: any) {
    const { fileId, lastSyncTimestamp, componentIds } = args;
    
    const changes = await this.componentExtractor.checkChanges({
      fileId,
      lastSyncTimestamp,
      componentIds,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(changes, null, 2),
        },
      ],
    };
  }

  private async handleSetWorkingFile(args: any, clientId: string) {
    const { url } = args;
    
    try {
      const parsedUrl = FigmaUrlParser.parse(url);
      
      // Validate file access
      const file = await this.figmaClient.getFile(parsedUrl.fileId);
      
      const workingFile = this.sessionManager.setWorkingFile(clientId, parsedUrl, file.name);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              workingFile: {
                fileId: workingFile.fileId,
                fileName: workingFile.fileName,
                url: workingFile.url,
                setAt: workingFile.setAt,
              },
              message: `Working file set successfully: ${workingFile.fileName}`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set working file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetWorkingFileInfo(clientId: string) {
    const summary = this.sessionManager.getImplementationSummary(clientId);
    
    if (!summary.hasWorkingFile) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              hasWorkingFile: false,
              message: 'No working file set. Use set-working-file to specify a Figma file URL.',
            }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            hasWorkingFile: true,
            workingFile: {
              fileId: summary.workingFile!.fileId,
              fileName: summary.workingFile!.fileName,
              url: summary.workingFile!.url,
              setAt: summary.workingFile!.setAt,
              lastAccessed: summary.workingFile!.lastAccessed,
            },
            implementationStats: summary.stats,
          }, null, 2),
        },
      ],
    };
  }

  private async handleGetImplementationQueue(args: any, clientId: string) {
    const workingFile = this.sessionManager.getWorkingFile(clientId);
    
    if (!workingFile) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No working file set. Use set-working-file first.'
      );
    }

    const { filter } = args;
    const componentsResult = await this.componentExtractor.listComponents(workingFile.fileId, filter);
    const queue = this.sessionManager.getImplementationQueue(clientId, componentsResult.components);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workingFile: {
              fileId: workingFile.fileId,
              fileName: workingFile.fileName,
            },
            queue: {
              total: queue.total,
              pending: queue.pending.map(c => ({ id: c.id, name: c.name, type: c.type })),
              inProgress: queue.inProgress.map(c => ({ id: c.id, name: c.name, type: c.type })),
              implemented: queue.implemented.map(c => ({ id: c.id, name: c.name, type: c.type })),
              needsUpdate: queue.needsUpdate.map(c => ({ id: c.id, name: c.name, type: c.type })),
            },
            summary: {
              pendingCount: queue.pending.length,
              inProgressCount: queue.inProgress.length,
              implementedCount: queue.implemented.length,
              needsUpdateCount: queue.needsUpdate.length,
            },
          }, null, 2),
        },
      ],
    };
  }

  private async handleGetComponentForImplementation(args: any, clientId: string) {
    const workingFile = this.sessionManager.getWorkingFile(clientId);
    
    if (!workingFile) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No working file set. Use set-working-file first.'
      );
    }

    const { componentId, includeUsageExamples = true, targetFramework = 'generic' } = args;
    
    // Get comprehensive component specification
    const specification = await this.componentExtractor.extractComponentSpecification({
      fileId: workingFile.fileId,
      componentId,
      includeAccessibility: true,
      includeInteractions: true,
    });

    // Get current implementation status
    const status = this.sessionManager.getComponentStatus(clientId, componentId);

    // Add framework-specific hints
    const frameworkHints = this.generateFrameworkHints(specification, targetFramework);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workingFile: {
              fileId: workingFile.fileId,
              fileName: workingFile.fileName,
            },
            component: specification.component,
            specification: {
              styling: specification.styling,
              accessibility: specification.accessibility,
              interactions: specification.interactions,
              usage: specification.usage,
            },
            implementationStatus: status,
            frameworkHints,
            targetFramework,
          }, null, 2),
        },
      ],
    };
  }

  private async handleUpdateComponentStatus(args: any, clientId: string) {
    const { componentId, componentName, status, notes, framework } = args;
    
    const success = this.sessionManager.updateComponentStatus(
      clientId, 
      componentId, 
      componentName, 
      status,
      { notes, framework }
    );

    if (!success) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No working file set. Use set-working-file first.'
      );
    }

    const updatedStatus = this.sessionManager.getComponentStatus(clientId, componentId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            componentId,
            componentName,
            updatedStatus,
            message: `Component status updated to: ${status}`,
          }, null, 2),
        },
      ],
    };
  }

  private generateFrameworkHints(specification: any, framework: string): any {
    const component = specification.component;
    
    switch (framework) {
      case 'react':
        return {
          componentName: this.toPascalCase(component.name),
          propsInterface: `${this.toPascalCase(component.name)}Props`,
          exampleUsage: `<${this.toPascalCase(component.name)} ${this.generateReactProps(component)} />`,
          stateManagement: this.generateReactStateHints(component),
        };
        
      case 'angular':
        return {
          componentName: this.toKebabCase(component.name),
          selector: `app-${this.toKebabCase(component.name)}`,
          inputs: component.componentInterface.props.map((prop: any) => `@Input() ${prop.name}: ${prop.type};`),
          outputs: component.componentInterface.events.map((event: any) => `@Output() ${event.name} = new EventEmitter<${event.type}>();`),
        };
        
      case 'vue':
        return {
          componentName: this.toPascalCase(component.name),
          props: component.componentInterface.props.map((prop: any) => ({
            name: prop.name,
            type: prop.type,
            required: prop.required,
            default: prop.default,
          })),
          emits: component.componentInterface.events.map((event: any) => event.name),
        };
        
      case 'svelte':
        return {
          componentName: this.toPascalCase(component.name),
          props: component.componentInterface.props.map((prop: any) => 
            `export let ${prop.name}${prop.required ? '' : ' = ' + JSON.stringify(prop.default)}: ${prop.type};`
          ),
          events: component.componentInterface.events.map((event: any) => event.name),
        };
        
      default:
        return {
          componentName: component.name,
          properties: component.componentInterface.props,
          events: component.componentInterface.events,
          notes: 'Generic implementation hints - adapt to your framework of choice',
        };
    }
  }

  private toPascalCase(str: string): string {
    return str.replace(/(?:^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, char) => char.toUpperCase());
  }

  private toKebabCase(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  private generateReactProps(component: any): string {
    return component.componentInterface.props
      .slice(0, 2) // Show first 2 props as example
      .map((prop: any) => `${prop.name}={${JSON.stringify(prop.default || 'value')}}`)
      .join(' ');
  }

  private generateReactStateHints(component: any): any {
    const hasInteractiveState = component.componentInterface.props.some((prop: any) => 
      ['checked', 'selected', 'expanded', 'active'].includes(prop.name.toLowerCase())
    );
    
    return {
      needsState: hasInteractiveState,
      suggestions: hasInteractiveState ? ['useState for interactive state', 'useCallback for event handlers'] : [],
    };
  }

  private extractClientId(request: any): string {
    // In a real implementation, this would extract client ID from request metadata
    // For now, we'll use a default client ID
    return request.id || 'default-client';
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        // Cleanup rate limiter
        this.rateLimiter.cleanup();
        
        // Cleanup sessions
        this.sessionManager.cleanup();
        
        // Clear cache if needed
        await this.cache.clear();
        
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {}, error as Error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {}, error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { 
        reason: reason instanceof Error ? reason.message : String(reason),
        promise: promise.toString() 
      });
      process.exit(1);
    });
  }

  async getHealth() {
    return this.healthMonitor.checkHealth();
  }

  async getMetrics() {
    return metrics.getMetrics();
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    logger.info('Figma MCP server started', {
      transport: 'stdio',
      pid: process.pid,
    });
    
    // Log to stderr so it doesn't interfere with MCP communication
    console.error('Figma MCP server running on stdio');
  }
}

async function main() {
  try {
    validateEnvironment();
    const server = new FigmaMcpServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Check if this is the main module in ES module environment
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}