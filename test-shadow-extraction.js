// Quick test to verify shadow extraction works correctly
const mockEffect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  offset: { x: 0, y: 4 },
  radius: 8,
  spread: 0,
  visible: true
};

const mockDoubleEffect = [
  {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.1 },
    offset: { x: 0, y: 1 },
    radius: 3,
    spread: 0,
    visible: true
  },
  {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 4 },
    radius: 8,
    spread: 0,
    visible: true
  }
];

// Mock ComponentExtractor methods for testing
function rgbaToCSS(rgba) {
  const r = Math.round(rgba.r * 255);
  const g = Math.round(rgba.g * 255);
  const b = Math.round(rgba.b * 255);
  const a = rgba.a !== undefined ? rgba.a : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function convertDropShadowToCSS(effect) {
  if (!effect.offset || effect.radius === undefined) return null;
  
  const x = Math.round(effect.offset.x || 0);
  const y = Math.round(effect.offset.y || 0);
  const blur = Math.round(effect.radius || 0);
  const spread = Math.round(effect.spread || 0);
  const color = effect.color ? rgbaToCSS(effect.color) : 'rgba(0, 0, 0, 0.25)';
  
  return `${x}px ${y}px ${blur}px ${spread}px ${color}`;
}

function convertEffectsToCSS(effects) {
  const css = {};
  
  if (!effects || effects.length === 0) {
    return css;
  }
  
  const shadows = [];
  
  effects.forEach(effect => {
    if (effect.visible === false) {
      return;
    }
    
    if (effect.type === 'DROP_SHADOW') {
      const dropShadow = convertDropShadowToCSS(effect);
      if (dropShadow) shadows.push(dropShadow);
    }
  });
  
  if (shadows.length > 0) {
    css.boxShadow = shadows.join(', ');
  }
  
  return css;
}

// Test single shadow
console.log('Single shadow test:');
const singleResult = convertEffectsToCSS([mockEffect]);
console.log(singleResult);
// Expected: { boxShadow: '0px 4px 8px 0px rgba(0, 0, 0, 0.25)' }

// Test double shadow
console.log('\nDouble shadow test:');
const doubleResult = convertEffectsToCSS(mockDoubleEffect);
console.log(doubleResult);
// Expected: { boxShadow: '0px 1px 3px 0px rgba(0, 0, 0, 0.1), 0px 4px 8px 0px rgba(0, 0, 0, 0.25)' }