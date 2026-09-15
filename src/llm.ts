import axios from 'axios';
import { config } from './config';
import { Message } from './types';

export class LLMClient {
  private apiUrl: string = '';
  private apiKey: string = '';
  private model: string = '';
  private maxTokens: number = 0;
  private temperature: number = 0.7;

  constructor() {
    this.applyConfig();
  }

  /** Re-read config from config.ts (called after panel settings update) */
  applyConfig(): void {
    this.apiUrl = config.llmApiUrl;
    this.apiKey = config.llmApiKey;
    this.model = config.llmModel;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
  }

  getApiUrl(): string {
    return this.apiUrl;
  }
  getModel(): string {
    return this.model;
  }

  /**
   * Call OpenAI-compatible LLM API
   */
  async chat(messages: Message[]): Promise<string> {
    try {
      // Calculate total input size for logging
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      const estimatedTokens = Math.ceil(totalChars / 4);
      
      console.log(`📊 LLM Request:`);
      console.log(`   Messages: ${messages.length}`);
      console.log(`   Total chars: ${totalChars}`);
      console.log(`   Estimated tokens: ~${estimatedTokens}`);
      
      if (estimatedTokens > 50000) {
        console.warn(`⚠️  Very large context: ${estimatedTokens} tokens`);
      }
      
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 60000, // 60 second timeout
        }
      );

      const content = response.data.choices[0].message.content;
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('LLM API Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        throw new Error(`LLM API failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Test LLM connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const testMessages: Message[] = [
        { role: 'user', content: 'Hello, this is a test. Reply with OK.' }
      ];
      
      const response = await this.chat(testMessages);
      console.log('✓ LLM connection test successful');
      console.log(`  Response: ${response.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error('✗ LLM connection test failed:', error);
      return false;
    }
  }
}
