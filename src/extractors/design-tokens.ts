import { FigmaClient } from '../figma/client.js';
import { CacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { DesignToken, FigmaStyle, RGBA } from '../types/figma.js';
import { GetDesignTokensArgsSchema } from '../utils/validation.js';

export interface TokenCollection {
  colors: DesignToken[];
  typography: DesignToken[];
  spacing: DesignToken[];
  effects: DesignToken[];
  variables: DesignToken[];
  _metadata?: {
    variablesAvailable: boolean;
    variablesMessage?: string;
    planRequired?: string;
  };
}

export class DesignTokenExtractor {
  constructor(
    private figmaClient: FigmaClient,
    private cache: CacheService
  ) {}

  async extractTokens(args: any): Promise<TokenCollection> {
    const validatedArgs = GetDesignTokensArgsSchema.parse(args);
    const { fileId, tokenTypes, format } = validatedArgs;

    const cacheKey = CacheService.keys.designTokens(fileId);
    const cached = await this.cache.get<TokenCollection>(cacheKey);
    
    if (cached) {
      return this.filterTokenTypes(cached, tokenTypes);
    }

    const stylesResponse = await this.figmaClient.getFileStyles(fileId);
    const styles = stylesResponse.meta.styles;

    // Try to get variables, but handle gracefully if the token doesn't have file_variables:read scope
    let variables: any[] = [];
    let variableCollections: any[] = [];
    
    try {
      logger.debug(`Attempting to fetch variables for file ${fileId}`);
      const variablesResponse = await this.figmaClient.getLocalVariables(fileId);
      variables = variablesResponse.meta.variables || [];
      variableCollections = variablesResponse.meta.variableCollections || [];
      logger.debug(`Successfully fetched ${variables.length} variables and ${variableCollections.length} collections`);
    } catch (error: any) {
      logger.debug('Error fetching variables', {
        message: error.message,
        status: error.status,
        errorData: error.errorData
      });
      
      // Set metadata about variables availability
      let variablesMessage = 'Variables API failed';
      let planRequired: string | undefined;
      
      if (error.status === 403) {
        if (error.message?.includes('file_variables:read')) {
          logger.debug('❌ Figma Variables API not available - Enterprise plan required');
          logger.debug('💡 The file_variables:read scope is only available with Figma Enterprise plans');
          logger.debug('💡 Falling back to legacy styles extraction only');
          logger.debug('💡 To access modern Figma variables, upgrade to Figma Enterprise or use legacy styles');
          variablesMessage = 'Figma Variables require Enterprise plan. Using legacy styles only.';
          planRequired = 'Enterprise';
        } else if (error.message?.includes('scope')) {
          logger.debug('❌ Insufficient permissions for variables API', { errorMessage: error.message });
          logger.debug('💡 Variables API may require Figma Enterprise plan');
          variablesMessage = 'Insufficient permissions for Variables API. May require Enterprise plan.';
          planRequired = 'Enterprise';
        } else {
          logger.debug('❌ Access denied to variables API', { errorMessage: error.message });
          variablesMessage = 'Access denied to Variables API';
        }
      } else {
        logger.debug('Failed to fetch variables, continuing with styles only', { errorMessage: error.message });
        variablesMessage = 'Variables API temporarily unavailable';
      }
      
      // Store variables limitation info for consuming agents
      (global as any).__figmaVariablesMetadata = {
        variablesAvailable: false,
        variablesMessage,
        planRequired
      };
    }

    const tokens = await this.processStylesAndVariables(styles, variables, variableCollections, fileId);
    
    // Add variables metadata to response
    const variablesMetadata = (global as any).__figmaVariablesMetadata;
    if (variablesMetadata) {
      tokens._metadata = variablesMetadata;
    }
    
    logger.debug('Processed tokens', {
      colors: tokens.colors.length,
      typography: tokens.typography.length,
      spacing: tokens.spacing.length,
      effects: tokens.effects.length,
      variables: tokens.variables.length,
      totalStyles: styles.length,
      variablesAvailable: tokens._metadata?.variablesAvailable ?? true
    });
    
    await this.cache.set(cacheKey, tokens, CacheService.ttl.designTokens);

    const filtered = this.filterTokenTypes(tokens, tokenTypes);
    
    // Preserve metadata in filtered result
    if (tokens._metadata) {
      filtered._metadata = tokens._metadata;
    }
    
    logger.debug('Filtered tokens for types', {
      tokenTypes: tokenTypes.join(', '),
      colors: filtered.colors.length,
      typography: filtered.typography.length,
      spacing: filtered.spacing.length,
      effects: filtered.effects.length,
      variables: filtered.variables.length,
      variablesAvailable: filtered._metadata?.variablesAvailable ?? true
    });

    return filtered;
  }

  private async processStylesAndVariables(
    styles: any[], 
    variables: any[], 
    variableCollections: any[], 
    fileId: string
  ): Promise<TokenCollection> {
    const tokens: TokenCollection = {
      colors: [],
      typography: [],
      spacing: [],
      effects: [],
      variables: [],
      _metadata: {
        variablesAvailable: true,
      },
    };

    // Process legacy styles
    for (const style of styles) {
      try {
        const token = await this.convertStyleToToken(style, fileId);
        if (token) {
          const targetCollection = this.getCollectionFromTokenType(token.type);
          if (targetCollection && targetCollection in tokens) {
            const collection = tokens[targetCollection];
            if (Array.isArray(collection)) {
              collection.push(token);
            }
          }
        }
      } catch (error) {
        logger.debug('Failed to process style', { styleKey: style.key, error });
      }
    }

    // Process modern variables
    const collectionsMap = new Map(variableCollections.map((c: any) => [c.id, c]));
    logger.debug('Processing variables with collections', { 
      variablesCount: variables.length, 
      collectionsCount: variableCollections.length 
    });
    
    for (const variable of variables) {
      try {
        logger.debug('Processing variable', { 
          variableName: variable.name, 
          resolvedType: variable.resolvedType 
        });
        const token = await this.convertVariableToToken(variable, collectionsMap);
        if (token) {
          logger.debug('Successfully converted variable to token', { 
            variableName: variable.name, 
            tokenName: token.name 
          });
          tokens.variables.push(token);
          // Also add to appropriate type collection for backward compatibility
          if (token.category) {
            const targetCollection = this.getCollectionFromCategory(token.category);
            if (targetCollection && targetCollection in tokens) {
              const collection = tokens[targetCollection];
              if (Array.isArray(collection)) {
                collection.push(token);
                logger.debug('Added variable to collection', { 
                  tokenName: token.name, 
                  targetCollection 
                });
              }
            }
          }
        } else {
          logger.debug('Variable converted to null token', { variableName: variable.name });
        }
      } catch (error) {
        logger.debug('Failed to process variable', { variableId: variable.id, error });
      }
    }

    return tokens;
  }

  private async convertStyleToToken(style: any, fileId: string): Promise<DesignToken | null> {
    switch (style.style_type) {
      case 'FILL':
        return this.createColorToken(style);
      
      case 'TEXT':
        return this.createTypographyToken(style);
      
      case 'EFFECT':
        return this.createEffectToken(style);
      
      default:
        return null;
    }
  }

  private createColorToken(style: any): DesignToken {
    // Get the first solid fill for simplicity
    const fill = style.fills?.find((f: any) => f.type === 'SOLID');
    const color = fill?.color;
    
    const hexValue = color ? this.rgbaToHex(color) : '#000000';
    
    return {
      name: this.normalizeTokenName(style.name),
      value: hexValue,
      type: 'color',
      description: style.description || undefined,
      category: this.inferColorCategory(style.name),
      usage: this.inferColorUsage(style.name),
    };
  }

  private createTypographyToken(style: any): DesignToken {
    const value = {
      fontFamily: style.font_family || 'inherit',
      fontSize: style.font_size || 16,
      fontWeight: style.font_weight || 400,
      lineHeight: this.extractLineHeight(style),
      letterSpacing: this.extractLetterSpacing(style),
    };

    return {
      name: this.normalizeTokenName(style.name),
      value,
      type: 'typography',
      description: style.description || undefined,
      category: this.inferTypographyCategory(style.name),
    };
  }

  private createEffectToken(style: any): DesignToken {
    const effect = style.effects?.[0];
    if (!effect) {
      return {
        name: this.normalizeTokenName(style.name),
        value: {},
        type: 'effect',
        category: 'effects',
      };
    }

    const value = {
      type: effect.type,
      color: effect.color ? this.rgbaToHex(effect.color) : undefined,
      offset: effect.offset,
      radius: effect.radius,
      spread: effect.spread,
    };

    return {
      name: this.normalizeTokenName(style.name),
      value,
      type: 'effect',
      description: style.description || undefined,
      category: this.inferEffectCategory(style.name),
    };
  }

  private filterTokenTypes(tokens: TokenCollection, tokenTypes: string[]): TokenCollection {
    if (tokenTypes.includes('all')) {
      return tokens;
    }

    const filtered: TokenCollection = {
      colors: [],
      typography: [],
      spacing: [],
      effects: [],
      variables: [],
    };

    if (tokenTypes.includes('colors')) {
      filtered.colors = tokens.colors;
    }
    if (tokenTypes.includes('typography')) {
      filtered.typography = tokens.typography;
    }
    if (tokenTypes.includes('spacing')) {
      filtered.spacing = tokens.spacing;
    }
    if (tokenTypes.includes('effects')) {
      filtered.effects = tokens.effects;
    }
    if (tokenTypes.includes('variables')) {
      filtered.variables = tokens.variables;
    }

    return filtered;
  }

  private normalizeTokenName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private inferColorCategory(name: string): string {
    const categoryMap = {
      primary: ['primary', 'main', 'brand'],
      secondary: ['secondary', 'accent'],
      neutral: ['neutral', 'gray', 'grey', 'black', 'white'],
      semantic: ['success', 'error', 'warning', 'info', 'danger'],
      text: ['text', 'foreground', 'content'],
      background: ['background', 'surface', 'backdrop'],
      border: ['border', 'outline', 'stroke'],
    };

    const lowercaseName = name.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(keyword => lowercaseName.includes(keyword))) {
        return category;
      }
    }

    return 'miscellaneous';
  }

  private inferColorUsage(name: string): string[] {
    const usage: string[] = [];
    const lowercaseName = name.toLowerCase();

    if (lowercaseName.includes('button')) usage.push('buttons');
    if (lowercaseName.includes('text')) usage.push('text');
    if (lowercaseName.includes('background')) usage.push('backgrounds');
    if (lowercaseName.includes('border')) usage.push('borders');
    if (lowercaseName.includes('link')) usage.push('links');
    if (lowercaseName.includes('icon')) usage.push('icons');

    return usage.length > 0 ? usage : ['general'];
  }

  private inferTypographyCategory(name: string): string {
    const lowercaseName = name.toLowerCase();
    
    if (lowercaseName.includes('heading') || lowercaseName.includes('title')) {
      return 'headings';
    }
    if (lowercaseName.includes('body') || lowercaseName.includes('paragraph')) {
      return 'body';
    }
    if (lowercaseName.includes('caption') || lowercaseName.includes('small')) {
      return 'captions';
    }
    if (lowercaseName.includes('label')) {
      return 'labels';
    }
    if (lowercaseName.includes('button')) {
      return 'buttons';
    }

    return 'miscellaneous';
  }

  private inferEffectCategory(name: string): string {
    const lowercaseName = name.toLowerCase();
    
    if (lowercaseName.includes('shadow')) {
      return 'shadows';
    }
    if (lowercaseName.includes('blur')) {
      return 'blur';
    }
    if (lowercaseName.includes('glow')) {
      return 'glow';
    }

    return 'effects';
  }

  private async convertVariableToToken(variable: any, collectionsMap: Map<string, any>): Promise<DesignToken | null> {
    const collection = collectionsMap.get(variable.variableCollectionId);
    const collectionName = collection?.name || 'unknown';
    
    // Get the default mode value (usually the first mode)
    const defaultModeId = collection?.defaultModeId || collection?.modes?.[0]?.modeId;
    const valuesByMode = variable.valuesByMode || {};
    const defaultValue = valuesByMode[defaultModeId];
    
    if (!defaultValue) {
      return null;
    }

    const tokenName = this.normalizeTokenName(`${collectionName}-${variable.name}`);
    
    return {
      name: tokenName,
      value: this.processVariableValue(defaultValue, variable.resolvedType),
      type: this.mapVariableTypeToTokenType(variable.resolvedType),
      description: variable.description || undefined,
      category: this.inferVariableCategory(variable.name, variable.resolvedType),
      collectionName,
      variableId: variable.id,
      modes: Object.keys(valuesByMode).length > 1 ? this.processModes(valuesByMode, variable.resolvedType) : undefined,
    };
  }

  private processVariableValue(value: any, type: string): any {
    switch (type) {
      case 'COLOR':
        return this.rgbaToHex(value);
      case 'FLOAT':
        return value;
      case 'STRING':
        return value;
      case 'BOOLEAN':
        return value;
      default:
        return value;
    }
  }

  private mapVariableTypeToTokenType(type: string): 'color' | 'typography' | 'spacing' | 'effect' | 'content' | 'boolean' | 'unknown' {
    switch (type) {
      case 'COLOR':
        return 'color';
      case 'FLOAT':
        return 'spacing';
      case 'STRING':
        return 'content';
      case 'BOOLEAN':
        return 'boolean';
      default:
        return 'unknown';
    }
  }

  private inferVariableCategory(name: string, type: string): string {
    const lowercaseName = name.toLowerCase();
    
    if (type === 'COLOR') {
      return this.inferColorCategory(name);
    }
    
    if (type === 'FLOAT') {
      if (lowercaseName.includes('spacing') || lowercaseName.includes('gap') || lowercaseName.includes('margin') || lowercaseName.includes('padding')) {
        return 'spacing';
      }
      if (lowercaseName.includes('border') || lowercaseName.includes('stroke')) {
        return 'border';
      }
      if (lowercaseName.includes('radius') || lowercaseName.includes('corner')) {
        return 'radius';
      }
      return 'dimension';
    }
    
    if (type === 'STRING') {
      if (lowercaseName.includes('font') || lowercaseName.includes('family')) {
        return 'font-family';
      }
      return 'content';
    }
    
    return 'miscellaneous';
  }

  private processModes(valuesByMode: any, type: string): any {
    const modes: any = {};
    
    for (const [modeId, value] of Object.entries(valuesByMode)) {
      modes[modeId] = this.processVariableValue(value, type);
    }
    
    return modes;
  }

  private getCollectionFromCategory(category: string): keyof TokenCollection | null {
    const categoryMap: Record<string, keyof TokenCollection> = {
      'primary': 'colors',
      'secondary': 'colors', 
      'neutral': 'colors',
      'semantic': 'colors',
      'text': 'colors',
      'background': 'colors',
      'border': 'colors',
      'spacing': 'spacing',
      'dimension': 'spacing',
      'radius': 'spacing',
      'font-family': 'typography',
      'shadows': 'effects',
      'blur': 'effects',
      'glow': 'effects',
    };
    
    return categoryMap[category] || null;
  }

  private getCollectionFromTokenType(type: string): keyof TokenCollection | null {
    const typeMap: Record<string, keyof TokenCollection> = {
      'color': 'colors',
      'typography': 'typography',
      'spacing': 'spacing',
      'effect': 'effects',
      'content': 'spacing', // Fallback for content tokens
      'boolean': 'spacing', // Fallback for boolean tokens
      'unknown': 'spacing', // Fallback for unknown tokens
    };
    
    return typeMap[type] || null;
  }

  private extractLineHeight(style: any): number {
    if (style.line_height?.unit === 'PIXELS') {
      return style.line_height.value;
    }
    if (style.line_height?.unit === 'PERCENT') {
      return (style.font_size || 16) * (style.line_height.value / 100);
    }
    return (style.font_size || 16) * 1.2; // Default line height
  }

  private extractLetterSpacing(style: any): number {
    if (style.letter_spacing?.unit === 'PIXELS') {
      return style.letter_spacing.value;
    }
    if (style.letter_spacing?.unit === 'PERCENT') {
      return (style.font_size || 16) * (style.letter_spacing.value / 100);
    }
    return 0; // Default letter spacing
  }

  private rgbaToHex(rgba: RGBA): string {
    const r = Math.round(rgba.r * 255);
    const g = Math.round(rgba.g * 255);
    const b = Math.round(rgba.b * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}