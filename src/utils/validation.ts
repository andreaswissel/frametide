import { z } from 'zod';

export function validateEnvironment() {
  const envSchema = z.object({
    FIGMA_ACCESS_TOKEN: z.string().min(1, 'FIGMA_ACCESS_TOKEN is required'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  });

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('\n');
    
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}

export function validateFileId(fileId: string): boolean {
  // Figma file IDs are typically alphanumeric with some special characters
  const fileIdRegex = /^[a-zA-Z0-9_-]+$/;
  return fileIdRegex.test(fileId);
}

export function validateNodeId(nodeId: string): boolean {
  // Figma node IDs follow the pattern "123:456"
  const nodeIdRegex = /^\d+:\d+$/;
  return nodeIdRegex.test(nodeId);
}

export function validateHexColor(color: string): boolean {
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexColorRegex.test(color);
}

export function validateTimestamp(timestamp: string): boolean {
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

export const ComponentFilterSchema = z.object({
  type: z.enum(['COMPONENT', 'COMPONENT_SET']).optional(),
  name: z.string().optional(),
  published: z.boolean().optional(),
}).optional();

export const GetComponentArgsSchema = z.object({
  fileId: z.string().min(1),
  componentId: z.string().min(1),
  includeVariants: z.boolean().default(true),
  includeInstances: z.boolean().default(false),
});

export const ListComponentsArgsSchema = z.object({
  fileId: z.string().min(1),
  filter: ComponentFilterSchema,
});

export const GetDesignTokensArgsSchema = z.object({
  fileId: z.string().min(1),
  tokenTypes: z.array(z.enum(['colors', 'typography', 'spacing', 'effects', 'variables', 'all'])).default(['all']),
  format: z.enum(['standard', 'css-variables']).default('standard'),
});

export const GetComponentSpecificationArgsSchema = z.object({
  fileId: z.string().min(1),
  componentId: z.string().min(1),
  includeAccessibility: z.boolean().default(true),
  includeInteractions: z.boolean().default(true),
});

export const CheckComponentChangesArgsSchema = z.object({
  fileId: z.string().min(1),
  lastSyncTimestamp: z.string().refine(validateTimestamp, 'Invalid timestamp format'),
  componentIds: z.array(z.string()).optional(),
});