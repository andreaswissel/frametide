# Frametide Usage Guide

This guide provides comprehensive examples for integrating and using Frametide in different environments and workflows.

## Table of Contents

- [Quick Start](#quick-start)
- [IDE Integration](#ide-integration)
- [Workflow Examples](#workflow-examples)
- [Framework-Specific Examples](#framework-specific-examples)
- [Common Use Cases](#common-use-cases)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Quick Start

1. **Install and build the server:**
   ```bash
   git clone https://github.com/andreaswissel/frametide.git
   cd frametide
   npm install
   npm run build
   ```

2. **Set up your Figma token:**
   ```bash
   npm run setup
   # Follow the interactive prompts
   ```

3. **Test the connection:**
   ```bash
   npm run health
   ```

## IDE Integration

### Claude Desktop

The most seamless experience. Claude can directly use the MCP tools in natural conversation.

**1. Create/edit your config file:**

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "figma": {
      "command": "node",
      "args": ["/absolute/path/to/frametide/dist/index.js"],
      "env": {
        "FIGMA_ACCESS_TOKEN": "your_figma_token_here"
      }
    }
  }
}
```

**2. Restart Claude Desktop**

**3. Start using in conversation:**
```
"Let's work on this Figma file: https://www.figma.com/design/abc123/Design-System"
```

### VS Code

Perfect for development workflows where you want to generate code directly in your editor.

**1. Add to workspace `.vscode/settings.json`:**
```json
{
  "mcp.servers": {
    "figma": {
      "command": "node",
      "args": ["/path/to/frametide/dist/index.js"],
      "cwd": "${workspaceFolder}",
      "env": {
        "FIGMA_ACCESS_TOKEN": "your_figma_token_here"
      }
    }
  }
}
```

**2. Use via Command Palette:**
- `Ctrl/Cmd + Shift + P` → "MCP: Connect to Server"
- Start chatting with your AI assistant

### Cursor

Ideal for AI-powered coding with design system integration.

**1. Create `.cursor/settings.json` in your project:**
```json
{
  "mcp.servers": {
    "figma": {
      "command": "node",
      "args": ["/path/to/frametide/dist/index.js"],
      "cwd": "${workspaceFolder}",
      "env": {
        "FIGMA_ACCESS_TOKEN": "your_figma_token_here"
      }
    }
  }
}
```

**2. Install MCP extension and restart Cursor**

**3. Use in AI chat:**
```
@figma get me the button component specs from this file: [Figma URL]
```

## Workflow Examples

### Session-Based Workflow (Recommended)

The session-based approach is perfect for focused implementation sessions.

```typescript
// 1. Set working file
"Let's implement components from this Figma file: https://www.figma.com/design/abc123/Design-System" // REPLACE WITH YOUR FIGMA FILE!

// 2. Get implementation queue
"Show me what components need to be implemented"

// 3. Get component for implementation
"Get implementation details for the Button component targeting React"

// 4. Generate code (AI does this based on specs)

// 5. Mark as implemented
"Mark the Button component as implemented in React"
```

### Traditional Tool-Based Workflow

For one-off extractions or when you need specific control.

```typescript
// Extract a specific component
const component = await mcpClient.callTool('get-component', {
  fileId: 'abc123',
  componentId: 'button-id',
  includeVariants: true
});

// Get all design tokens
const tokens = await mcpClient.callTool('get-design-tokens', {
  fileId: 'abc123',
  tokenTypes: ['colors', 'typography'],
  format: 'css-variables'
});
```

### Batch Processing Workflow

For processing multiple components systematically.

```javascript
// 1. List all components
const components = await mcpClient.callTool('list-components', {
  fileId: 'your-file-id',
  filter: { type: 'COMPONENT', published: true }
});

// 2. Process each component
for (const component of components.components) {
  const spec = await mcpClient.callTool('get-component-specification', {
    fileId: 'your-file-id',
    componentId: component.id,
    includeAccessibility: true
  });
  
  // Generate code based on spec
  // Mark as implemented
}
```

## Framework-Specific Examples

### React

**Get React-optimized component specification:**
```typescript
const buttonSpec = await mcpClient.callTool('get-component-for-implementation', {
  componentId: 'button-id',
  targetFramework: 'react',
  includeUsageExamples: true
});

// Result includes:
// - React component name (PascalCase)
// - Props interface definition
// - State management hints
// - Event handler patterns
```

**Generated interface example:**
```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'danger';
  size: 'small' | 'medium' | 'large';
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ 
  variant, 
  size, 
  disabled, 
  onClick, 
  children 
}) => {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
```

### Vue 3

**Get Vue-optimized specification:**
```typescript
const spec = await mcpClient.callTool('get-component-for-implementation', {
  componentId: 'button-id',
  targetFramework: 'vue'
});
```

**Generated component example:**
```vue
<template>
  <button 
    :class="`btn btn-${variant} btn-${size}`"
    :disabled="disabled"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
interface Props {
  variant: 'primary' | 'secondary' | 'danger'
  size: 'small' | 'medium' | 'large'
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false
})

const emit = defineEmits<{
  click: []
}>()

const handleClick = () => {
  emit('click')
}
</script>
```

### Angular

**Get Angular-optimized specification:**
```typescript
const spec = await mcpClient.callTool('get-component-for-implementation', {
  componentId: 'button-id',
  targetFramework: 'angular'
});
```

**Generated component example:**
```typescript
@Component({
  selector: 'app-button',
  template: `
    <button 
      [class]="'btn btn-' + variant + ' btn-' + size"
      [disabled]="disabled"
      (click)="onClick.emit()"
    >
      <ng-content></ng-content>
    </button>
  `
})
export class ButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'danger' = 'primary';
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() disabled: boolean = false;
  @Output() onClick = new EventEmitter<void>();
}
```

### Svelte

**Get Svelte-optimized specification:**
```typescript
const spec = await mcpClient.callTool('get-component-for-implementation', {
  componentId: 'button-id',
  targetFramework: 'svelte'
});
```

**Generated component example:**
```svelte
<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'danger' = 'primary';
  export let size: 'small' | 'medium' | 'large' = 'medium';
  export let disabled: boolean = false;
  
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  
  function handleClick() {
    dispatch('click');
  }
</script>

<button 
  class="btn btn-{variant} btn-{size}"
  {disabled}
  on:click={handleClick}
>
  <slot />
</button>
```

## Common Use Cases

### Design System Maintenance

**1. Audit existing components:**
```typescript
// Check what's been implemented
const queue = await mcpClient.callTool('get-implementation-queue');
console.log(`${queue.summary.implementedCount} components ready`);
console.log(`${queue.summary.pendingCount} components pending`);
```

**2. Check for Figma updates:**
```typescript
const changes = await mcpClient.callTool('check-component-changes', {
  fileId: 'your-file-id',
  lastSyncTimestamp: '2024-01-01T00:00:00Z',
  componentIds: ['button-id', 'card-id']
});

if (changes.hasChanges) {
  console.log('Components need updates:', changes.changedComponents);
}
```

### Design Token Management

**1. Extract all design tokens:**
```typescript
const tokens = await mcpClient.callTool('get-design-tokens', {
  fileId: 'your-file-id',
  tokenTypes: ['all'],
  format: 'css-variables'
});

// Generate CSS file
const cssContent = `
:root {
  ${tokens.colors.map(color => `  ${color.name}: ${color.value};`).join('\n')}
  ${tokens.typography.map(font => `  ${font.name}: ${font.value};`).join('\n')}
}
`;
```

**2. Framework-specific token generation:**
```typescript
// For Tailwind CSS
const tailwindConfig = {
  theme: {
    colors: tokens.colors.reduce((acc, color) => {
      acc[color.name.replace('--', '')] = color.value;
      return acc;
    }, {}),
    fontFamily: tokens.typography.fontFamily,
  }
};
```

### Component Library Generation

**1. Generate component specifications:**
```typescript
const components = await mcpClient.callTool('list-components', {
  fileId: 'your-file-id',
  filter: { published: true }
});

const specifications = await Promise.all(
  components.components.map(component => 
    mcpClient.callTool('get-component-specification', {
      fileId: 'your-file-id',
      componentId: component.id
    })
  )
);
```

**2. Generate documentation:**
```typescript
const docs = specifications.map(spec => ({
  name: spec.component.name,
  description: spec.component.description,
  props: spec.component.componentInterface.props,
  examples: spec.usage.examples,
  accessibility: spec.accessibility
}));
```

## Error Handling

### Common Errors and Solutions

**1. Invalid Figma Token:**
```
Error: Figma API authentication failed
```
**Solution:** Verify your token has the required scopes:
- File content
- File metadata  
- Library content

**2. File Access Denied:**
```
Error: Access to file denied
```
**Solution:** Ensure the file is accessible with your token:
```bash
npm run cli validate-file --file YOUR_FILE_ID
```

**3. Component Not Found:**
```
Error: Component with ID 'xyz' not found
```
**Solution:** List components first to get valid IDs:
```typescript
const components = await mcpClient.callTool('list-components', {
  fileId: 'your-file-id'
});
```

**4. Rate Limiting:**
```
Error: Rate limit exceeded
```
**Solution:** The server has built-in rate limiting. Wait and retry, or check your usage:
```bash
npm run cli test-connection
```

### Error Recovery Patterns

**1. Graceful degradation:**
```typescript
try {
  const tokens = await mcpClient.callTool('get-design-tokens', {
    fileId: 'your-file-id',
    tokenTypes: ['colors', 'typography']
  });
} catch (error) {
  console.warn('Failed to fetch design tokens, using defaults');
  const tokens = getDefaultTokens();
}
```

**2. Retry with backoff:**
```typescript
async function fetchWithRetry(toolName, args, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await mcpClient.callTool(toolName, args);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

## Best Practices

### Performance

**1. Use session-based workflow for batch operations:**
```typescript
// Set working file once
await mcpClient.callTool('set-working-file', {
  url: 'https://www.figma.com/design/abc123/Design-System'
});

// Then use session-aware tools
const queue = await mcpClient.callTool('get-implementation-queue');
```

**2. Cache responses when possible:**
```typescript
const cache = new Map();

async function getCachedComponent(componentId) {
  if (cache.has(componentId)) {
    return cache.get(componentId);
  }
  
  const component = await mcpClient.callTool('get-component-for-implementation', {
    componentId
  });
  
  cache.set(componentId, component);
  return component;
}
```

### Security

**1. Never expose tokens in client-side code:**
```typescript
// ❌ Bad - token exposed
const config = {
  figmaToken: 'fig_abc123...'
};

// ✅ Good - token in environment
const config = {
  figmaToken: process.env.FIGMA_ACCESS_TOKEN
};
```

**2. Validate inputs:**
```typescript
function validateFileId(fileId) {
  const figmaFileIdPattern = /^[a-zA-Z0-9]{22}$/;
  if (!figmaFileIdPattern.test(fileId)) {
    throw new Error('Invalid Figma file ID format');
  }
}
```

### Code Organization

**1. Create type definitions:**
```typescript
interface FigmaComponent {
  id: string;
  name: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  description?: string;
}

interface ComponentSpec {
  component: FigmaComponent;
  styling: any;
  accessibility: any;
  interactions: any;
}
```

**2. Use factories for common patterns:**
```typescript
class ComponentGenerator {
  constructor(private mcpClient: any, private framework: string) {}
  
  async generateComponent(componentId: string) {
    const spec = await this.mcpClient.callTool('get-component-for-implementation', {
      componentId,
      targetFramework: this.framework
    });
    
    return this.renderTemplate(spec);
  }
  
  private renderTemplate(spec: ComponentSpec) {
    // Framework-specific rendering logic
  }
}
```

### Monitoring

**1. Track implementation progress:**
```typescript
async function getImplementationMetrics() {
  const summary = await mcpClient.callTool('get-working-file-info');
  
  return {
    totalComponents: summary.implementationStats.total,
    implementedComponents: summary.implementationStats.implemented,
    completionPercentage: (summary.implementationStats.implemented / summary.implementationStats.total) * 100
  };
}
```

**2. Log important operations:**
```typescript
async function implementComponent(componentId: string) {
  console.log(`Starting implementation of component: ${componentId}`);
  
  try {
    const spec = await mcpClient.callTool('get-component-for-implementation', {
      componentId
    });
    
    // Generate code...
    
    await mcpClient.callTool('update-component-status', {
      componentId,
      componentName: spec.component.name,
      status: 'implemented'
    });
    
    console.log(`✅ Successfully implemented: ${spec.component.name}`);
  } catch (error) {
    console.error(`❌ Failed to implement component ${componentId}:`, error);
    throw error;
  }
}
```

---

## Need Help?

- **Test your setup**: `npm run health`
- **Validate file access**: `npm run cli validate-file --file YOUR_FILE_ID`
- **Check connection**: `npm run cli test-connection`
- **Report issues**: [GitHub Issues](https://github.com/andreaswissel/frametide/issues)

---

*For more examples and advanced use cases, see the main [README.md](./README.md)*
