import { FigmaClient } from '../figma/client.js';
import { CacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { 
  ComponentData, 
  ComponentSpecification, 
  FigmaNode, 
  FigmaFile,
  RGBA,
  Paint,
  Effect 
} from '../types/figma.js';
import { 
  GetComponentArgsSchema,
  GetComponentSpecificationArgsSchema,
  CheckComponentChangesArgsSchema,
  ComponentFilterSchema 
} from '../utils/validation.js';

export interface ComponentListItem {
  id: string;
  name: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  description?: string;
  variantCount?: number;
  lastModified: string;
  published: boolean;
  thumbnail?: string;
}

export interface ChangeSet {
  hasChanges: boolean;
  changedComponents: Array<{
    id: string;
    name: string;
    changeType: 'modified' | 'new' | 'deleted';
    lastModified: string;
    changes?: string[];
  }>;
  newComponents: ComponentListItem[];
  deletedComponents: string[];
}

export class ComponentExtractor {
  constructor(
    private figmaClient: FigmaClient,
    private cache: CacheService
  ) {}

  async extractComponent(args: any): Promise<ComponentData> {
    const validatedArgs = GetComponentArgsSchema.parse(args);
    const { fileId, componentId, includeVariants, includeInstances } = validatedArgs;

    const cacheKey = CacheService.keys.component(fileId, componentId);
    const cached = await this.cache.get<ComponentData>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const file = await this.figmaClient.getFile(fileId);
    const component = this.findComponentInFile(file, componentId);
    
    if (!component) {
      throw new Error(`Component ${componentId} not found in file ${fileId}`);
    }

    const componentData = await this.processComponent(component, file, {
      includeVariants,
      includeInstances,
    });

    await this.cache.set(cacheKey, componentData, CacheService.ttl.component);
    return componentData;
  }

  async listComponents(fileId: string, filter?: any): Promise<{ components: ComponentListItem[]; totalCount: number; hasMore: boolean }> {
    const validatedFilter = ComponentFilterSchema.parse(filter);
    
    const cacheKey = CacheService.keys.componentList(fileId);
    const cached = await this.cache.get<ComponentListItem[]>(cacheKey);
    
    let components: ComponentListItem[];
    
    if (cached) {
      components = cached;
    } else {
      const file = await this.figmaClient.getFile(fileId);
      components = this.extractComponentList(file);
      await this.cache.set(cacheKey, components, CacheService.ttl.componentList);
    }

    // Apply filters
    const filteredComponents = this.applyFilters(components, validatedFilter);

    return {
      components: filteredComponents,
      totalCount: filteredComponents.length,
      hasMore: false, // TODO: Implement pagination
    };
  }

  async extractComponentSpecification(args: any): Promise<ComponentSpecification> {
    const validatedArgs = GetComponentSpecificationArgsSchema.parse(args);
    const { fileId, componentId, includeAccessibility, includeInteractions } = validatedArgs;

    const cacheKey = CacheService.keys.componentSpec(fileId, componentId);
    const cached = await this.cache.get<ComponentSpecification>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const componentData = await this.extractComponent({
      fileId,
      componentId,
      includeVariants: true,
      includeInstances: false,
    });

    const file = await this.figmaClient.getFile(fileId);
    const component = this.findComponentInFile(file, componentId);
    
    if (!component) {
      throw new Error(`Component ${componentId} not found in file ${fileId}`);
    }

    const specification = this.buildComponentSpecification(
      componentData,
      component,
      { includeAccessibility, includeInteractions }
    );

    await this.cache.set(cacheKey, specification, CacheService.ttl.componentSpec);
    return specification;
  }

  async checkChanges(args: any): Promise<ChangeSet> {
    const validatedArgs = CheckComponentChangesArgsSchema.parse(args);
    const { fileId, lastSyncTimestamp, componentIds } = validatedArgs;

    const file = await this.figmaClient.getFile(fileId);
    const lastSync = new Date(lastSyncTimestamp);
    const fileLastModified = new Date(file.lastModified);

    if (fileLastModified <= lastSync) {
      return {
        hasChanges: false,
        changedComponents: [],
        newComponents: [],
        deletedComponents: [],
      };
    }

    // For now, we'll return a simplified change detection
    // In a real implementation, you'd compare against stored component versions
    const components = this.extractComponentList(file);
    const recentlyModified = components.filter(component => 
      new Date(component.lastModified) > lastSync
    );

    return {
      hasChanges: recentlyModified.length > 0,
      changedComponents: recentlyModified.map(component => ({
        id: component.id,
        name: component.name,
        changeType: 'modified' as const,
        lastModified: component.lastModified,
        changes: ['properties'], // Simplified - would need detailed comparison
      })),
      newComponents: [],
      deletedComponents: [],
    };
  }

  private findComponentInFile(file: FigmaFile, componentId: string): FigmaNode | null {
    const findInNode = (node: FigmaNode): FigmaNode | null => {
      if (node.id === componentId) {
        return node;
      }
      
      if (node.children) {
        for (const child of node.children) {
          const found = findInNode(child);
          if (found) return found;
        }
      }
      
      return null;
    };

    return findInNode(file.document);
  }

  private async processComponent(
    component: FigmaNode, 
    file: FigmaFile, 
    options: { includeVariants: boolean; includeInstances: boolean }
  ): Promise<ComponentData> {
    const dimensions = this.extractDimensions(component);
    const colors = this.extractColors(component);
    const typography = this.extractTypography(component);
    const spacing = this.extractSpacing(component);
    const effects = this.extractEffects(component);
    
    let variants: ComponentData['variants'];
    if (options.includeVariants && component.type === 'COMPONENT_SET') {
      variants = this.extractVariants(component, file);
    }

    const componentInterface = this.generateComponentInterface(component);

    return {
      id: component.id,
      name: component.name,
      type: component.type as 'COMPONENT' | 'COMPONENT_SET',
      description: this.extractDescription(component),
      properties: {
        dimensions,
        colors,
        typography,
        spacing,
        effects,
      },
      variants,
      componentInterface,
    };
  }

  private extractComponentList(file: FigmaFile): ComponentListItem[] {
    const components: ComponentListItem[] = [];

    const traverse = (node: FigmaNode) => {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        components.push({
          id: node.id,
          name: node.name,
          type: node.type,
          description: this.extractDescription(node),
          variantCount: node.type === 'COMPONENT_SET' ? this.countVariants(node) : undefined,
          lastModified: file.lastModified,
          published: true, // TODO: Check actual published status
        });
      }

      if (node.children) {
        node.children.forEach(traverse);
      }
    };

    traverse(file.document);
    return components;
  }

  private extractDimensions(component: FigmaNode) {
    const bounds = component.absoluteBoundingBox;
    return {
      width: bounds?.width || 0,
      height: bounds?.height || 0,
    };
  }

  private extractColors(component: FigmaNode) {
    const colors: any[] = [];
    
    if (component.fills) {
      component.fills.forEach((fill, index) => {
        if (fill.type === 'SOLID' && fill.color) {
          colors.push({
            property: `fill-${index}`,
            value: this.rgbaToHex(fill.color),
            type: 'fill',
          });
        }
      });
    }

    if (component.strokes) {
      component.strokes.forEach((stroke, index) => {
        if (stroke.type === 'SOLID' && stroke.color) {
          colors.push({
            property: `stroke-${index}`,
            value: this.rgbaToHex(stroke.color),
            type: 'stroke',
          });
        }
      });
    }

    return colors;
  }

  private extractTypography(component: FigmaNode) {
    const typography: any[] = [];
    
    if (component.style) {
      typography.push({
        property: 'text',
        fontFamily: component.style.fontFamily,
        fontSize: component.style.fontSize,
        fontWeight: component.style.fontWeight,
        lineHeight: component.style.lineHeight?.value || component.style.fontSize * 1.2,
      });
    }

    return typography;
  }

  private extractSpacing(component: FigmaNode) {
    // This is simplified - would need more sophisticated logic
    // to extract actual padding/margin from Figma components
    return [];
  }

  private extractEffects(component: FigmaNode) {
    const effects: any[] = [];
    
    if (component.effects) {
      component.effects.forEach((effect, index) => {
        effects.push({
          type: effect.type,
          color: effect.color ? this.rgbaToCSS(effect.color) : undefined,
          offset: effect.offset,
          radius: effect.radius,
          spread: effect.spread || 0,
          visible: effect.visible !== false,
        });
      });
    }

    return effects;
  }

  private extractVariants(component: FigmaNode, file: FigmaFile) {
    // Simplified variant extraction
    // In reality, would need to traverse component set children
    return [];
  }

  private generateComponentInterface(component: FigmaNode) {
    const props: any[] = [];
    const events: any[] = [];

    // Extract props from component property definitions
    if (component.componentPropertyDefinitions) {
      Object.entries(component.componentPropertyDefinitions).forEach(([name, prop]) => {
        props.push({
          name,
          type: this.mapFigmaTypeToGeneric(prop.type),
          required: false,
          default: prop.defaultValue,
          values: prop.variantOptions,
        });
      });
    }

    // Add common events for interactive components
    if (this.isInteractiveComponent(component)) {
      events.push({
        name: 'click',
        type: 'Event',
        description: 'Fired when component is clicked',
      });
    }

    return {
      props,
      events,
      slots: [], // TODO: Extract slot information
    };
  }

  private buildComponentSpecification(
    componentData: ComponentData,
    component: FigmaNode,
    options: { includeAccessibility: boolean; includeInteractions: boolean }
  ): ComponentSpecification {
    const styling = this.extractStyling(component);
    const accessibility = options.includeAccessibility ? this.extractAccessibility(component) : undefined;
    const interactions = options.includeInteractions ? this.extractInteractions(component) : undefined;
    const usage = this.generateUsageGuidelines(componentData);

    return {
      component: componentData,
      styling,
      accessibility,
      interactions,
      usage,
    };
  }

  private extractStyling(component: FigmaNode) {
    const states = this.extractStatesFromLayers(component);
    const baseStyles = this.extractVisualProperties(component);
    
    // Convert states to CSS-like properties
    const stateStyles: Record<string, any> = {};
    Object.entries(states).forEach(([stateName, stateData]) => {
      stateStyles[stateName] = {
        ...this.convertToCSS(stateData.properties),
        ...this.convertEffectsToCSS(stateData.effects),
      };
    });
    
    const baseEffects = this.extractEffects(component);
    
    return {
      baseStyles: {
        ...this.convertToCSS(baseStyles),
        ...this.convertEffectsToCSS(baseEffects),
      },
      variants: {}, // TODO: Extract variant styles
      states: stateStyles,
      stateInfo: states, // Raw state data for advanced consumers
    };
  }

  private extractAccessibility(component: FigmaNode) {
    return {
      role: this.inferAriaRole(component),
      keyboardNavigation: this.extractKeyboardNavigation(component),
    };
  }

  private extractInteractions(component: FigmaNode) {
    const states = this.extractStatesFromLayers(component);
    logger.debug(`Found ${Object.keys(states).length} states in component ${component.name}`, { states: Object.keys(states) });
    
    return {
      hover: states.hover || {},
      active: states.active || {},
      focus: states.focus || {},
      disabled: states.disabled || {},
      ...states, // Include any additional states found
    };
  }

  private generateUsageGuidelines(componentData: ComponentData) {
    return {
      guidelines: [
        `Use ${componentData.name} for consistent UI patterns`,
        'Follow the design system guidelines for proper implementation',
      ],
      examples: [],
      doNot: [],
    };
  }

  private applyFilters(components: ComponentListItem[], filter?: any): ComponentListItem[] {
    if (!filter) return components;

    return components.filter(component => {
      if (filter.type && component.type !== filter.type) return false;
      if (filter.name && !new RegExp(filter.name, 'i').test(component.name)) return false;
      if (filter.published !== undefined && component.published !== filter.published) return false;
      return true;
    });
  }

  private extractDescription(component: FigmaNode): string | undefined {
    // Figma doesn't directly store descriptions in the node structure
    // This would typically come from the component metadata
    return undefined;
  }

  private countVariants(component: FigmaNode): number {
    return component.children?.length || 0;
  }

  private rgbaToHex(rgba: RGBA): string {
    const r = Math.round(rgba.r * 255);
    const g = Math.round(rgba.g * 255);
    const b = Math.round(rgba.b * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  private rgbaToCSS(rgba: RGBA): string {
    const r = Math.round(rgba.r * 255);
    const g = Math.round(rgba.g * 255);
    const b = Math.round(rgba.b * 255);
    const a = rgba.a !== undefined ? rgba.a : 1;
    
    // Use rgba format to preserve alpha channel
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  private mapFigmaTypeToGeneric(figmaType: string): string {
    const typeMap: Record<string, string> = {
      'BOOLEAN': 'boolean',
      'TEXT': 'string',
      'INSTANCE_SWAP': 'Component',
      'VARIANT': 'string',
    };
    return typeMap[figmaType] || 'any';
  }

  private isInteractiveComponent(component: FigmaNode): boolean {
    const interactiveNames = ['button', 'link', 'input', 'select', 'checkbox', 'radio'];
    return interactiveNames.some(name => 
      component.name.toLowerCase().includes(name)
    );
  }

  private inferAriaRole(component: FigmaNode): string | undefined {
    const name = component.name.toLowerCase();
    if (name.includes('button')) return 'button';
    if (name.includes('link')) return 'link';
    if (name.includes('input')) return 'textbox';
    return undefined;
  }

  private extractKeyboardNavigation(component: FigmaNode) {
    const navigation: Array<{ key: string; action: string }> = [];
    
    if (this.isInteractiveComponent(component)) {
      navigation.push(
        { key: 'Enter', action: 'activate' },
        { key: 'Space', action: 'activate' }
      );
    }

    return navigation;
  }

  private extractStatesFromLayers(component: FigmaNode): Record<string, any> {
    const states: Record<string, any> = {};
    const statePatterns = [
      'hover',
      'focus', 
      'active',
      'pressed',
      'disabled',
      'selected',
      'loading',
      'error',
      'success',
      'warning',
      'visited'
    ];

    logger.debug(`Analyzing component ${component.name} for states`);
    
    const analyzeNode = (node: FigmaNode, depth = 0) => {
      const indent = '  '.repeat(depth);
      logger.debug(`${indent}Layer: "${node.name}" (${node.type})`);
      
      // Check if this node represents a state
      const stateName = this.parseStateFromLayerName(node.name, statePatterns);
      if (stateName) {
        logger.debug(`${indent}✅ Found state: ${stateName}`);
        
        // Extract visual properties for this state
        const effects = this.extractEffects(node);
        const properties = this.extractVisualProperties(node);
        
        states[stateName] = {
          layerName: node.name,
          properties,
          colors: this.extractColors(node),
          effects,
          visibility: node.visible !== false,
        };
        
        if (effects.length > 0) {
          logger.debug(`${indent}  📐 Found ${effects.length} effects`, { effects: effects.map(e => `${e.type}(${e.radius}px)`) });
        }
        
        // If this node has children, they might contain additional state details
        if (node.children) {
          states[stateName].childStates = {};
          node.children.forEach(child => {
            const childState = this.extractVisualProperties(child);
            if (Object.keys(childState).length > 0) {
              states[stateName].childStates[child.name] = childState;
            }
          });
        }
      }
      
      // Recursively analyze children
      if (node.children) {
        node.children.forEach(child => analyzeNode(child, depth + 1));
      }
    };

    analyzeNode(component);
    
    logger.debug(`States found for ${component.name}`, { states: Object.keys(states) });
    return states;
  }

  private parseStateFromLayerName(layerName: string, statePatterns: string[]): string | null {
    const name = layerName.toLowerCase();
    
    for (const pattern of statePatterns) {
      // Check for exact matches or common patterns
      if (name === pattern ||
          name.includes(pattern) ||
          name.includes(`state=${pattern}`) ||
          name.includes(`_${pattern}`) ||
          name.includes(`-${pattern}`) ||
          name.includes(`${pattern}_`) ||
          name.includes(`${pattern}-`) ||
          name.startsWith(`${pattern}:`) ||
          name.endsWith(`:${pattern}`)) {
        return pattern;
      }
    }
    
    // Check for common Figma naming conventions
    if (name.includes('state=')) {
      const match = name.match(/state=([^,\s]+)/);
      if (match && statePatterns.includes(match[1])) {
        return match[1];
      }
    }
    
    return null;
  }

  private extractVisualProperties(node: FigmaNode): Record<string, any> {
    const properties: Record<string, any> = {};
    
    // Extract positioning and transforms
    if (node.absoluteBoundingBox) {
      properties.dimensions = {
        width: node.absoluteBoundingBox.width,
        height: node.absoluteBoundingBox.height,
        x: node.absoluteBoundingBox.x,
        y: node.absoluteBoundingBox.y,
      };
    }
    
    // Extract opacity
    if (node.opacity !== undefined && node.opacity !== 1) {
      properties.opacity = node.opacity;
    }
    
    // Extract visibility
    if (node.visible === false) {
      properties.visibility = 'hidden';
    }
    
    // Extract fills (background colors)
    if (node.fills && node.fills.length > 0) {
      properties.fills = node.fills.map(fill => {
        if (fill.type === 'SOLID' && fill.color) {
          return {
            type: fill.type,
            color: this.rgbaToHex(fill.color),
            opacity: fill.opacity || 1,
          };
        }
        return fill;
      });
    }
    
    // Extract strokes (borders)  
    if (node.strokes && node.strokes.length > 0) {
      properties.strokes = node.strokes.map(stroke => {
        if (stroke.type === 'SOLID' && stroke.color) {
          return {
            type: stroke.type,
            color: this.rgbaToHex(stroke.color),
            weight: node.strokeWeight || 1,
          };
        }
        return stroke;
      });
    }
    
    // Extract corner radius
    if (node.cornerRadius !== undefined) {
      properties.cornerRadius = node.cornerRadius;
    }
    
    // Extract text properties for text nodes
    if (node.type === 'TEXT' && node.style) {
      properties.typography = {
        fontFamily: node.style.fontFamily,
        fontSize: node.style.fontSize,
        fontWeight: node.style.fontWeight,
        lineHeight: node.style.lineHeight,
        letterSpacing: node.style.letterSpacing,
      };
    }
    
    return properties;
  }

  private convertToCSS(properties: Record<string, any>): Record<string, any> {
    const css: Record<string, any> = {};
    
    // Convert dimensions
    if (properties.dimensions) {
      css.width = `${properties.dimensions.width}px`;
      css.height = `${properties.dimensions.height}px`;
    }
    
    // Convert opacity
    if (properties.opacity !== undefined) {
      css.opacity = properties.opacity;
    }
    
    // Convert visibility
    if (properties.visibility) {
      css.visibility = properties.visibility;
    }
    
    // Convert fills to background
    if (properties.fills && properties.fills.length > 0) {
      const primaryFill = properties.fills[0];
      if (primaryFill.type === 'SOLID') {
        css.backgroundColor = primaryFill.color;
        if (primaryFill.opacity !== 1) {
          css.backgroundOpacity = primaryFill.opacity;
        }
      }
    }
    
    // Convert strokes to border
    if (properties.strokes && properties.strokes.length > 0) {
      const primaryStroke = properties.strokes[0];
      if (primaryStroke.type === 'SOLID') {
        css.borderColor = primaryStroke.color;
        css.borderWidth = `${primaryStroke.weight}px`;
        css.borderStyle = 'solid';
      }
    }
    
    // Convert corner radius
    if (properties.cornerRadius !== undefined) {
      css.borderRadius = `${properties.cornerRadius}px`;
    }
    
    // Convert typography
    if (properties.typography) {
      Object.assign(css, {
        fontFamily: properties.typography.fontFamily,
        fontSize: `${properties.typography.fontSize}px`,
        fontWeight: properties.typography.fontWeight,
        lineHeight: properties.typography.lineHeight?.value || properties.typography.lineHeight,
      });
    }
    
    return css;
  }

  private convertEffectsToCSS(effects: any[]): Record<string, any> {
    const css: Record<string, any> = {};
    
    if (!effects || effects.length === 0) {
      return css;
    }
    
    const shadows: string[] = [];
    const filters: string[] = [];
    
    effects.forEach(effect => {
      // Skip invisible effects
      if (effect.visible === false) {
        return;
      }
      
      switch (effect.type) {
        case 'DROP_SHADOW':
          const dropShadow = this.convertDropShadowToCSS(effect);
          if (dropShadow) shadows.push(dropShadow);
          break;
          
        case 'INNER_SHADOW':
          const innerShadow = this.convertInnerShadowToCSS(effect);
          if (innerShadow) shadows.push(innerShadow);
          break;
          
        case 'LAYER_BLUR':
          const blur = this.convertBlurToCSS(effect);
          if (blur) filters.push(blur);
          break;
          
        case 'BACKGROUND_BLUR':
          const bgBlur = this.convertBackgroundBlurToCSS(effect);
          if (bgBlur) css.backdropFilter = bgBlur;
          break;
      }
    });
    
    // Combine all shadows into box-shadow (preserves multiple shadows)
    if (shadows.length > 0) {
      css.boxShadow = shadows.join(', ');
    }
    
    // Combine all filters
    if (filters.length > 0) {
      css.filter = filters.join(' ');
    }
    
    return css;
  }

  private convertDropShadowToCSS(effect: any): string | null {
    if (!effect.offset || effect.radius === undefined) return null;
    
    const x = Math.round(effect.offset.x || 0);
    const y = Math.round(effect.offset.y || 0);
    const blur = Math.round(effect.radius || 0);
    const spread = Math.round(effect.spread || 0);
    const color = effect.color || 'rgba(0, 0, 0, 0.25)';
    
    // Format: offset-x offset-y blur-radius spread-radius color
    return `${x}px ${y}px ${blur}px ${spread}px ${color}`;
  }

  private convertInnerShadowToCSS(effect: any): string | null {
    if (!effect.offset || effect.radius === undefined) return null;
    
    const x = Math.round(effect.offset.x || 0);
    const y = Math.round(effect.offset.y || 0);
    const blur = Math.round(effect.radius || 0);
    const spread = Math.round(effect.spread || 0);
    const color = effect.color || 'rgba(0, 0, 0, 0.25)';
    
    // Format: inset offset-x offset-y blur-radius spread-radius color
    return `inset ${x}px ${y}px ${blur}px ${spread}px ${color}`;
  }

  private convertBlurToCSS(effect: any): string | null {
    if (effect.radius === undefined || effect.radius <= 0) return null;
    return `blur(${Math.round(effect.radius)}px)`;
  }

  private convertBackgroundBlurToCSS(effect: any): string | null {
    if (effect.radius === undefined || effect.radius <= 0) return null;
    return `blur(${Math.round(effect.radius)}px)`;
  }
}