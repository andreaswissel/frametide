import { z } from 'zod';

// Figma API Response Types
export interface FigmaFile {
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  componentSets: Record<string, FigmaComponentSet>;
  schemaVersion: number;
  styles: Record<string, FigmaStyle>;
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  absoluteBoundingBox?: Rectangle;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: Effect[];
  characters?: string;
  style?: TypeStyle;
  componentPropertyDefinitions?: Record<string, ComponentProperty>;
  variantGroupProperties?: Record<string, VariantProperty>;
  componentPropertyReferences?: Record<string, string>;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  componentSetId?: string;
  documentationLinks: DocumentationLink[];
}

export interface FigmaComponentSet {
  key: string;
  name: string;
  description: string;
  documentationLinks: DocumentationLink[];
}

export interface FigmaStyle {
  key: string;
  name: string;
  description: string;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
  fills?: Paint[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: LineHeight;
  letterSpacing?: LetterSpacing;
  effects?: Effect[];
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Paint {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE';
  visible?: boolean;
  opacity?: number;
  color?: RGBA;
  gradientStops?: ColorStop[];
  gradientTransform?: Transform;
  scaleMode?: string;
  imageTransform?: Transform;
  scalingFactor?: number;
  imageRef?: string;
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorStop {
  position: number;
  color: RGBA;
}

export interface Transform extends Array<number[]> {}

export interface Effect {
  type: 'INNER_SHADOW' | 'DROP_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  visible?: boolean;
  radius: number;
  color?: RGBA;
  offset?: Vector;
  spread?: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textAutoResize?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  letterSpacing?: LetterSpacing;
  lineHeight?: LineHeight;
  fills?: Paint[];
}

export interface LineHeight {
  value: number;
  unit: 'PIXELS' | 'PERCENT';
}

export interface LetterSpacing {
  value: number;
  unit: 'PIXELS' | 'PERCENT';
}

export interface ComponentProperty {
  type: 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT';
  defaultValue: boolean | string;
  variantOptions?: string[];
  preferredValues?: any[];
}

export interface VariantProperty {
  values: string[];
}

export interface DocumentationLink {
  uri: string;
}

// Our processed types
export const ComponentDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['COMPONENT', 'COMPONENT_SET']),
  description: z.string().optional(),
  properties: z.object({
    dimensions: z.object({
      width: z.number(),
      height: z.number(),
      minWidth: z.number().optional(),
      maxWidth: z.number().optional(),
    }),
    colors: z.array(z.object({
      property: z.string(),
      value: z.string(),
      token: z.string().optional(),
      type: z.string(),
    })),
    typography: z.array(z.object({
      property: z.string(),
      fontFamily: z.string(),
      fontSize: z.number(),
      fontWeight: z.number(),
      lineHeight: z.number(),
      token: z.string().optional(),
    })),
    spacing: z.array(z.object({
      property: z.string(),
      top: z.number().optional(),
      right: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional(),
      token: z.string().optional(),
    })),
    effects: z.array(z.object({
      type: z.string(),
      color: z.string().optional(),
      offset: z.object({ x: z.number(), y: z.number() }).optional(),
      radius: z.number().optional(),
      token: z.string().optional(),
    })),
  }),
  variants: z.array(z.object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string()),
    overrides: z.record(z.any()),
  })).optional(),
  componentInterface: z.object({
    props: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      default: z.any().optional(),
      description: z.string().optional(),
      values: z.array(z.string()).optional(),
    })),
    events: z.array(z.object({
      name: z.string(),
      type: z.string(),
      description: z.string().optional(),
      parameters: z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
      })).optional(),
    })),
    slots: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      required: z.boolean(),
    })).optional(),
  }),
});

export type ComponentData = z.infer<typeof ComponentDataSchema>;

export const DesignTokenSchema = z.object({
  name: z.string(),
  value: z.union([z.string(), z.number(), z.object({})]),
  type: z.enum(['color', 'typography', 'spacing', 'effect', 'content', 'boolean', 'unknown']),
  description: z.string().optional(),
  category: z.string().optional(),
  usage: z.array(z.string()).optional(),
  collectionName: z.string().optional(),
  variableId: z.string().optional(),
  modes: z.record(z.any()).optional(),
});

export type DesignToken = z.infer<typeof DesignTokenSchema>;

export const ComponentSpecificationSchema = z.object({
  component: ComponentDataSchema,
  styling: z.object({
    baseStyles: z.record(z.any()),
    variants: z.record(z.record(z.any())),
    states: z.record(z.record(z.any())),
    responsive: z.record(z.record(z.any())).optional(),
  }),
  accessibility: z.object({
    role: z.string().optional(),
    ariaLabel: z.string().optional(),
    keyboardNavigation: z.array(z.object({
      key: z.string(),
      action: z.string(),
    })).optional(),
    contrastRequirements: z.object({
      normal: z.string(),
      large: z.string(),
    }).optional(),
  }).optional(),
  interactions: z.object({
    hover: z.record(z.any()).optional(),
    active: z.record(z.any()).optional(),
    focus: z.record(z.any()).optional(),
    disabled: z.record(z.any()).optional(),
  }).optional(),
  usage: z.object({
    guidelines: z.array(z.string()).optional(),
    examples: z.array(z.object({
      title: z.string(),
      code: z.string(),
    })).optional(),
    doNot: z.array(z.string()).optional(),
  }).optional(),
});

export type ComponentSpecification = z.infer<typeof ComponentSpecificationSchema>;