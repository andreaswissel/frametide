#!/usr/bin/env node

import { FigmaClient } from '../figma/client.js';

async function checkScopes() {
  try {
    const client = new FigmaClient();
    
    // Test with user's file ID first, then fallback to known file
    const userFileId = process.argv[2];
    const testFileId = userFileId || 'hch8YlkgaUIx3rBFnjUIIDdx'; // Figma's own design system file
    
    if (userFileId) {
      console.log(`📁 Testing with your file: ${userFileId}`);
    } else {
      console.log(`📁 Testing with sample file: ${testFileId}`);
      console.log(`💡 To test your file, run: npm run check-scopes YOUR_FILE_ID`);
    }
    
    console.log('🔍 Testing Figma API scopes...\n');
    
    // Test basic file access
    try {
      console.log('✅ Testing file access...');
      const file = await client.getFile(testFileId);
      console.log(`   ✅ File access works: "${file.name}"`);
    } catch (error: any) {
      console.log(`   ❌ File access failed: ${error.message}`);
      return;
    }
    
    // Test styles access  
    try {
      console.log('✅ Testing styles access...');
      const styles = await client.getFileStyles(testFileId);
      console.log(`   ✅ Styles access works: ${styles.meta.styles.length} styles found`);
    } catch (error: any) {
      console.log(`   ❌ Styles access failed: ${error.message}`);
    }
    
    // Test variables access
    try {
      console.log('✅ Testing variables access...');
      const variables = await client.getLocalVariables(testFileId);
      console.log(`   ✅ Variables access works: ${variables.meta.variables.length} variables, ${variables.meta.variableCollections.length} collections`);
    } catch (error: any) {
      console.log(`   ❌ Variables access failed: ${error.message}`);
      if (error.status === 403) {
        console.log('   💡 This means your token needs additional scopes for variables');
        console.log('   💡 Try enabling "File content" and/or "Dev resources" scopes');
      }
    }
    
    console.log('\n🏁 Scope check complete!');
    
  } catch (error) {
    console.error('Failed to check scopes:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkScopes();
}

export { checkScopes };