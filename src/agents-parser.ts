import fs from 'fs';
import path from 'path';
import { AgentsConfig } from './types';

/**
 * Parse AGENTS.md file similar to Hermes Agent format
 * Extracts the entire content as system prompt
 */
export function parseAgentsMd(filePath: string): AgentsConfig {
  try {
    const fullPath = path.resolve(filePath);
    
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠ AGENTS.md not found at ${fullPath}, using default prompt`);
      return {
        systemPrompt: 'You are a helpful WhatsApp assistant. Be concise and friendly.',
        rawContent: '',
      };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Use the entire AGENTS.md as system prompt
    // This follows Hermes pattern where the whole file defines agent behavior
    const systemPrompt = content.trim();

    console.log(`✓ Loaded AGENTS.md (${content.length} chars)`);
    
    return {
      systemPrompt,
      rawContent: content,
    };
  } catch (error) {
    console.error('Error parsing AGENTS.md:', error);
    return {
      systemPrompt: 'You are a helpful WhatsApp assistant. Be concise and friendly.',
      rawContent: '',
    };
  }
}

/**
 * Watch AGENTS.md for changes and reload
 */
export function watchAgentsMd(
  filePath: string,
  callback: (config: AgentsConfig) => void
): void {
  const fullPath = path.resolve(filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.warn('⚠ AGENTS.md not found, skipping watch');
    return;
  }

  fs.watch(fullPath, (eventType) => {
    if (eventType === 'change') {
      console.log('📝 AGENTS.md changed, reloading...');
      const newConfig = parseAgentsMd(filePath);
      callback(newConfig);
    }
  });
  
  console.log('👀 Watching AGENTS.md for changes');
}
