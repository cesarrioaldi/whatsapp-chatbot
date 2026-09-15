import dotenv from 'dotenv';
import { Config } from './types';
import path from 'path';

dotenv.config();

export const config: Config = {
  llmApiUrl: process.env.LLM_API_URL || 'http://localhost:8080/v1/chat/completions',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'gpt-3.5-turbo',
  botName: process.env.BOT_NAME || 'WhatsApp Assistant',
  maxTokens: parseInt(process.env.MAX_TOKENS || '2000'),
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
  agentsMdPath: process.env.AGENTS_MD_PATH || './AGENTS.md',
  databasePath: process.env.DATABASE_PATH || './data/diet-tracker.db',
  panelPort: parseInt(process.env.PANEL_PORT || '2999'),
  panelPassword: process.env.PANEL_PASSWORD || 'admin',
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '10000'),
};

export function validateConfig(): void {
  if (!config.llmApiUrl) {
    throw new Error('LLM_API_URL is required in .env file');
  }
  
  console.log('✓ Configuration loaded:');
  console.log(`  - LLM API: ${config.llmApiUrl}`);
  console.log(`  - Model: ${config.llmModel}`);
  console.log(`  - AGENTS.md: ${config.agentsMdPath}`);
  console.log(`  - Database: ${config.databasePath}`);
}

/**
 * Get today's date in WIB (Asia/Jakarta, UTC+7) as YYYY-MM-DD.
 * Uses Intl so it's correct regardless of server timezone.
 */
export function getTodayWIB(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Get yesterday's date in WIB (Asia/Jakarta, UTC+7) as YYYY-MM-DD.
 * Example: today 2026-09-01 → returns 2026-08-31.
 */
export function getYesterdayWIB(): string {
  const now = new Date();
  // Convert to WIB-local wall clock by shifting UTC+7, then subtract 1 day
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  wib.setDate(wib.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC', // the shifted value is already WIB; format as UTC to avoid double-shift
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(wib);
}

/**
 * Get the current timestamp in WIB (Asia/Jakarta, UTC+7) as a local ISO
 * string WITHOUT the 'Z' suffix (which would mark it as UTC).
 * Returns e.g. "2026-08-31T08:05:35" — usable for display & consistent with WIB.
 */
export function getNowWIB(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
