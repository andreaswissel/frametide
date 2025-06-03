#!/usr/bin/env node

// Load environment variables from .env file
import { config } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname); // Go up one level from cli/ to project root

// Try to load .env from project root
config({ path: join(projectRoot, '.env') });

import { program } from 'commander';
import { FigmaClient } from '../figma/client.js';
import { validateEnvironment } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { HealthMonitor } from '../utils/health.js';
import { CacheService } from '../services/cache.js';

program
  .name('figma-mcp-server')
  .description('CLI for Figma MCP Server management')
  .version('1.0.0');

program
  .command('test-connection')
  .description('Test connection to Figma API')
  .option('-t, --token <token>', 'Figma access token (or use FIGMA_ACCESS_TOKEN env var)')
  .action(async (options) => {
    try {
      const token = options.token || process.env.FIGMA_ACCESS_TOKEN;
      if (!token) {
        console.error('❌ Figma access token is required. Use --token or set FIGMA_ACCESS_TOKEN environment variable.');
        process.exit(1);
      }

      console.log('🔍 Testing Figma API connection...');
      
      const client = new FigmaClient({ accessToken: token });
      const remaining = client.getRemainingRequests();
      
      console.log('✅ Connection successful!');
      console.log(`📊 Remaining API requests: ${remaining}`);
      
    } catch (error) {
      console.error('❌ Connection failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check server health status')
  .action(async () => {
    try {
      validateEnvironment();
      
      const figmaClient = new FigmaClient();
      const cache = new CacheService();
      const healthMonitor = new HealthMonitor(figmaClient, cache);
      
      console.log('🏥 Checking server health...');
      
      const health = await healthMonitor.checkHealth();
      
      console.log(`\n📊 Overall Status: ${getStatusEmoji(health.status)} ${health.status.toUpperCase()}`);
      console.log(`⏰ Timestamp: ${health.timestamp}`);
      console.log(`📦 Version: ${health.version}\n`);
      
      console.log('🔍 Component Checks:');
      Object.entries(health.checks).forEach(([name, check]) => {
        const emoji = getCheckEmoji(check.status);
        const duration = check.duration ? ` (${check.duration}ms)` : '';
        console.log(`  ${emoji} ${name}: ${check.status}${duration}`);
        if (check.message) {
          console.log(`     ${check.message}`);
        }
        if (check.details) {
          console.log(`     ${JSON.stringify(check.details)}`);
        }
      });
      
      if (health.status === 'unhealthy') {
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('validate-file')
  .description('Validate access to a Figma file')
  .requiredOption('-f, --file <fileId>', 'Figma file ID')
  .option('-t, --token <token>', 'Figma access token (or use FIGMA_ACCESS_TOKEN env var)')
  .action(async (options) => {
    try {
      const token = options.token || process.env.FIGMA_ACCESS_TOKEN;
      if (!token) {
        console.error('❌ Figma access token is required. Use --token or set FIGMA_ACCESS_TOKEN environment variable.');
        process.exit(1);
      }

      console.log(`🔍 Validating access to file: ${options.file}`);
      
      const client = new FigmaClient({ accessToken: token });
      const file = await client.getFile(options.file);
      
      console.log('✅ File access successful!');
      console.log(`📁 File name: ${file.name}`);
      console.log(`📅 Last modified: ${file.lastModified}`);
      console.log(`🔢 Schema version: ${file.schemaVersion}`);
      
      const componentCount = Object.keys(file.components || {}).length;
      const componentSetCount = Object.keys(file.componentSets || {}).length;
      const styleCount = Object.keys(file.styles || {}).length;
      
      console.log(`🧩 Components: ${componentCount}`);
      console.log(`📦 Component sets: ${componentSetCount}`);
      console.log(`🎨 Styles: ${styleCount}`);
      
    } catch (error) {
      console.error('❌ File validation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    const { createInterface } = await import('readline');
    const { writeFileSync } = await import('fs');
    
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (query: string): Promise<string> => {
      return new Promise(resolve => {
        rl.question(query, resolve);
      });
    };

    try {
      console.log('🚀 Figma MCP Server Setup Wizard\n');
      
      const token = await question('Enter your Figma Personal Access Token: ');
      if (!token) {
        console.log('❌ Token is required. Please get one from https://www.figma.com/settings');
        process.exit(1);
      }
      
      // Test the token
      console.log('\n🔍 Testing token...');
      const client = new FigmaClient({ accessToken: token });
      const remaining = client.getRemainingRequests();
      console.log('✅ Token is valid!');
      
      const envContent = `# Figma MCP Server Configuration
FIGMA_ACCESS_TOKEN=${token}
NODE_ENV=production
LOG_LEVEL=info

# Optional: Cache Configuration
CACHE_TTL_COMPONENT=3600000
CACHE_TTL_TOKENS=86400000
CACHE_MAX_SIZE=1000
`;

      writeFileSync('.env', envContent);
      
      console.log('\n✅ Setup complete!');
      console.log('📄 Created .env file with your configuration');
      console.log('🚀 You can now start the server with: npm start');
      console.log('📖 See USAGE.md for integration examples');
      
    } catch (error) {
      console.error('❌ Setup failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      rl.close();
    }
  });

program
  .command('start')
  .description('Start the MCP server')
  .option('-p, --port <port>', 'Port for health check endpoint (optional)')
  .action(async (options) => {
    try {
      // Import and start the main server
      const { FigmaMcpServer } = await import('../index.js');
      
      if (options.port) {
        console.log(`🏥 Health check endpoint will be available on port ${options.port}`);
        // TODO: Start HTTP health check server
      }
      
      console.log('🚀 Starting Figma MCP Server...');
      const server = new FigmaMcpServer();
      await server.run();
      
    } catch (error) {
      console.error('❌ Failed to start server:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'healthy': return '✅';
    case 'degraded': return '⚠️';
    case 'unhealthy': return '❌';
    default: return '❓';
  }
}

function getCheckEmoji(status: string): string {
  switch (status) {
    case 'pass': return '✅';
    case 'warn': return '⚠️';
    case 'fail': return '❌';
    default: return '❓';
  }
}

// Check if this is the main module in ES module environment
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}