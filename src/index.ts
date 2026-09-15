import { WhatsAppBot } from './client';
import { validateConfig } from './config';
import { PanelServer } from './panel';
import { ensureSearchBridge } from './search-bridge';

async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   WhatsApp Chatbot with LLM + AGENTS.md   ║');
  console.log('╚═══════════════════════════════════════╝\n');

  try {
    // Validate configuration
    validateConfig();

    // Ensure search bridge (ddgs library) is running — RAG depends on it
    ensureSearchBridge();

    // Create and start bot
    const bot = new WhatsAppBot();
    await bot.start();

    // Start admin panel
    const panel = new PanelServer(bot);
    await panel.start();

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n\n⚠ Shutting down gracefully...');
      await panel.stop();
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('✗ Fatal error:', error);
    process.exit(1);
  }
}

main();
