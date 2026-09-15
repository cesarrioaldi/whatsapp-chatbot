import { Client, LocalAuth, Message as WAMessage } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { LLMClient } from './llm';
import { parseAgentsMd, watchAgentsMd } from './agents-parser';
import { config, getTodayWIB, getNowWIB, getYesterdayWIB } from './config';
import { DatabaseService } from './database';
import { OnboardingService } from './onboarding';
import { ChatHistory, Message, AgentsConfig } from './types';
import { execSync } from 'child_process';
import { searchFoodCalories, searchWeb } from './searcher';

// window/WWebJS only exist inside puppeteer's page evaluate() — declare for TS
declare const window: any;

function findChrome(): string | undefined {
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];

  for (const path of possiblePaths) {
    try {
      execSync(`test -f ${path}`);
      return path;
    } catch (e) {
      // Path doesn't exist, continue
    }
  }

  return undefined;
}

export class WhatsAppBot {
  private client: Client;
  private llm: LLMClient;
  private db: DatabaseService;
  private onboarding: OnboardingService;
  private agentsConfig: AgentsConfig;
  private chatHistory: ChatHistory = {};
  private maxHistoryLength = 20;
  private messageCount = 0;
  private isReady = false;
  private botInfo: any = null;
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();

  private async startTypingIndicator(chatId: string, message: WAMessage): Promise<void> {
    // Stop any existing timer for this chat
    this.stopTypingIndicator(chatId);

    // Helper: send typing state via puppeteer evaluate
    const sendTyping = async (id: string) => {
      try {
        await (this.client as any).pupPage.evaluate((chatId: string) => {
          (window as any).WWebJS.sendChatstate('typing', chatId);
        }, id);
        return true;
      } catch {
        return false;
      }
    };

    // Try getChat() first (works for @c.us personal chats)
    let ok = false;
    try {
      const chat = await message.getChat();
      await chat.sendStateTyping();
      ok = true;
    } catch {
      // Fallback: send directly via puppeteer (works for @lid, @g.us)
      ok = await sendTyping(chatId);
    }

    if (!ok) return; // typing not supported for this chat type

    // Refresh typing every 20s (WhatsApp auto-expires after 25s)
    const timer = setInterval(async () => {
      try {
        const chat = await message.getChat();
        await chat.sendStateTyping();
      } catch {
        await sendTyping(chatId);
      }
    }, 20000);

    this.typingTimers.set(chatId, timer);
  }

  private async stopTypingIndicator(chatId: string): Promise<void> {
    const timer = this.typingTimers.get(chatId);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(chatId);
    }
    // Clear typing state
    try {
      await (this.client as any).pupPage.evaluate((id: string) => {
        (window as any).WWebJS.sendChatstate('stop', id);
      }, chatId);
    } catch {
      // ignore
    }
  }

  // --- Panel accessors ---
  getDb(): DatabaseService {
    return this.db;
  }
  getLlm(): LLMClient {
    return this.llm;
  }
  getAgentsConfig(): AgentsConfig {
    return this.agentsConfig;
  }
  getChatHistoryCount(): number {
    return Object.keys(this.chatHistory).length;
  }
  getMessageCount(): number {
    return this.messageCount;
  }
  isClientReady(): boolean {
    return this.isReady;
  }
  getBotInfo(): any {
    return this.botInfo;
  }
  getChatHistorySize(): number {
    let total = 0;
    for (const key of Object.keys(this.chatHistory)) {
      total += this.chatHistory[key].length;
    }
    return total;
  }
  /** Re-read AGENTS.md manually (used by panel editor) */
  reloadAgentsConfig(): void {
    this.agentsConfig = parseAgentsMd(config.agentsMdPath);
    console.log('✓ AGENTS.md reloaded (from panel)');
  }
  /** Apply LLM config changes from panel */
  applyLlmConfig(): void {
    this.llm.applyConfig();
    console.log('✓ LLM config applied (from panel)');
  }
  /** Reset a user's onboarding (set onboarding_completed=0 + clear in-memory state) */
  resetUserOnboarding(userId: string): void {
    this.db.resetOnboarding(userId);
    this.onboarding.clearOnboardingState(userId);
    delete this.chatHistory[userId];
    console.log(`✓ Onboarding reset for ${userId} (from panel)`);
  }
  /** Delete user entirely */
  deleteUser(userId: string): void {
    this.db.deleteUser(userId);
    this.onboarding.clearOnboardingState(userId);
    delete this.chatHistory[userId];
    console.log(`✓ User deleted: ${userId} (from panel)`);
  }

  constructor() {
    const chromePath = findChrome();
    
    if (!chromePath) {
      console.warn('⚠ Chrome/Chromium not found, using Puppeteer default');
    } else {
      console.log(`✓ Using Chrome: ${chromePath}`);
    }

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
      }),
      puppeteer: chromePath ? {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: chromePath,
      } : {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }
    });

    this.llm = new LLMClient();
    this.db = new DatabaseService();
    this.onboarding = new OnboardingService(this.db);
    this.agentsConfig = parseAgentsMd(config.agentsMdPath);

    this.setupEventHandlers();
    this.setupAgentsWatcher();
  }

  private setupEventHandlers(): void {
    this.client.on('qr', (qr) => {
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', async () => {
      console.log('✓ WhatsApp client is ready!');
      console.log(`✓ Bot name: ${config.botName}`);
      this.isReady = true;
      // Get bot info safely
      try {
        const info = await (this.client as any).getInfo?.();
        if (info) {
          this.botInfo = {
            pushname: info.pushname,
            wid: info.wid?._serialized,
            phone: info.phone,
            platform: info.platform,
            me: info.me?._serialized,
          };
        } else {
          this.botInfo = { pushname: config.botName };
        }
      } catch {
        this.botInfo = { pushname: config.botName };
      }
    });

    this.client.on('authenticated', () => {
      console.log('✓ WhatsApp authenticated');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('✗ Authentication failed:', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('✗ WhatsApp disconnected:', reason);
    });

    this.client.on('message_create', async (message) => {
      // DEBUG: Log every message received
      console.log(`\n🔍 RAW MESSAGE RECEIVED:`);
      console.log(`   From: ${message.from}`);
      console.log(`   FromMe: ${message.fromMe}`);
      console.log(`   Body: "${message.body}"`);
      
      await this.handleMessage(message);
    });
  }

  private setupAgentsWatcher(): void {
    watchAgentsMd(config.agentsMdPath, (newConfig) => {
      this.agentsConfig = newConfig;
      console.log('✓ AGENTS.md reloaded');
    });
  }

  private async handleMessage(message: WAMessage): Promise<void> {
    let chatId = '';
    try {
      if (message.from === 'status@broadcast') return;
      if (message.fromMe) return;

      this.messageCount++;

      chatId = message.from;
      const userMessage = message.body;

      if (!userMessage || userMessage.trim().length === 0) return;

      // Validate message length (config-driven so panel can change it)
      const maxMessageLength = config.maxMessageLength;
      if (userMessage.length > maxMessageLength) {
        console.warn(`⚠️  Message too long: ${userMessage.length} chars (max ${maxMessageLength})`);
        await message.reply(
          `⚠️ Pesan kamu terlalu panjang (${userMessage.length} karakter).\n\n` +
          `Maksimal ${maxMessageLength} karakter per pesan ya!\n\n` +
          `Coba kirim dalam beberapa pesan yang lebih pendek, atau ringkas poinnya aja 😊`
        );
        return;
      }

      // Log chat type for debugging
      const chatType = chatId.includes('@c.us') ? 'personal' :
                       chatId.includes('@g.us') ? 'group' :
                       chatId.includes('@lid') ? 'list/channel' : 'unknown';
      
      console.log(`\n📨 Message from ${chatId} [${chatType}]:`);
      console.log(`   "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
      console.log(`   Length: ${userMessage.length} chars`);

      // Get chat for potential typing later (best-effort)
      let chat;
      try {
        chat = await message.getChat();
      } catch (chatError) {
        // Continue processing even if getChat() fails
      }

      // Get actual user ID (not channel ID)
      let userId: string;
      const isChannel = chatId.includes('@lid');
      const isGroup = chatId.includes('@g.us');
      
      if (isChannel || isGroup) {
        // For channel/group: use author ID (individual user)
        userId = message.author || chatId;
        console.log(`   [Channel/Group - Individual user: ${userId}]`);
      } else {
        // For personal chat: use chatId
        userId = chatId;
      }

      // Check if user is onboarded
      if (!this.onboarding.isOnboarded(userId)) {
        await this.handleOnboarding(message, userId, userMessage);
        return;
      }

      // Regular chat with LLM (user is onboarded)
      await this.handleRegularChat(message, userId, userMessage);

    } catch (error) {
      console.error('Error handling message:', error);
      
      // Stop typing indicator if LLM/processing failed
      if (chatId) {
        await this.stopTypingIndicator(chatId);
      }

      // Log full error for debugging
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
      }
      
      try {
        await message.reply('Maaf, terjadi kesalahan. Silakan coba lagi.');
      } catch (replyError) {
        console.error('Failed to send error message:', replyError);
      }
    }
  }

  private async handleOnboarding(
    message: WAMessage,
    chatId: string,
    userMessage: string
  ): Promise<void> {
    let state = this.onboarding.getOnboardingState(chatId);

    // Start onboarding if not started
    if (!state) {
      this.onboarding.startOnboarding(chatId);
      const welcomeMsg = this.onboarding.getOnboardingPrompt();
      await message.reply(welcomeMsg);
      return;
    }

    // Parse user answer
    const result = this.onboarding.parseOnboardingAnswer(state, userMessage);

    if (!result.success) {
      await message.reply(result.error || 'Maaf, jawaban tidak valid. Coba lagi ya!');
      return;
    }

    // Update state
    this.onboarding.updateOnboardingState(chatId, result.data!);
    state = this.onboarding.getOnboardingState(chatId)!;

    // Check if onboarding complete
    const profile = this.onboarding.completeOnboarding(chatId);
    if (profile) {
      const completionMsg = this.onboarding.getOnboardingCompletionMessage(profile);
      await message.reply(completionMsg);
      console.log(`✓ User ${chatId} completed onboarding: ${profile.name}`);
      return;
    }

    // Ask next question
    const nextQuestion = this.onboarding.getNextOnboardingQuestion(state);
    if (nextQuestion) {
      await message.reply(nextQuestion);
    }
  }

  private async handleRegularChat(
    message: WAMessage,
    chatId: string,
    userMessage: string
  ): Promise<void> {
    // Get user profile and today's summary
    const profile = this.db.getUserProfile(chatId);
    const today = getTodayWIB();
    const yesterday = getYesterdayWIB();
    const summary = this.db.getDailySummary(chatId, today);
    const yesterdaySummary = this.db.getDailySummary(chatId, yesterday);
    // Fetch detail entries so the AI can see what was actually logged
    const todayFoods = this.db.getFoodEntriesByDate(chatId, today);
    const todayActivities = this.db.getActivitiesByDate(chatId, today);
    const yesterdayFoods = this.db.getFoodEntriesByDate(chatId, yesterday);
    const yesterdayActivities = this.db.getActivitiesByDate(chatId, yesterday);

    // Build context for LLM
    const userContext = this.buildUserContext(
      profile!,
      summary,
      todayFoods,
      todayActivities,
      yesterday,
      yesterdaySummary,
      yesterdayFoods,
      yesterdayActivities
    );

    // Initialize chat history
    if (!this.chatHistory[chatId]) {
      this.chatHistory[chatId] = [];
    }

    // Add user message
    this.chatHistory[chatId].push({
      role: 'user',
      content: userMessage,
    });

    // Trim history
    if (this.chatHistory[chatId].length > this.maxHistoryLength) {
      this.chatHistory[chatId] = this.chatHistory[chatId].slice(-this.maxHistoryLength);
    }

    // Build messages with system prompt + user context
    const messages: Message[] = [
      {
        role: 'system',
        content: this.agentsConfig.systemPrompt + '\n\n' + userContext,
      },
      ...this.chatHistory[chatId],
    ];

    // Start typing indicator (refresh every 20s while LLM works)
    await this.startTypingIndicator(chatId, message);

    // === RAG LOOP ===
    // If the LLM emits a [SEARCH] block, it means it doesn't know the answer.
    // We search the web, inject the results, and ask the LLM again (max 2 rounds).
    // Fallback: if the LLM says "I don't know" but didn't emit [SEARCH], search anyway.
    let response = await this.llm.chat(messages);
    let searchRounds = 0;
    const maxSearchRounds = 2;

    while (searchRounds < maxSearchRounds) {
      // Priority 1: [QUERY] block — AI asks for historical DB data (custom date)
      let dbDate = this.extractDateQuery(response);
      if (dbDate) {
        console.log(`🗄️ RAG: AI minta data tanggal ${dbDate} dari database`);
        // Strip the [QUERY] block from the draft response
        response = response.replace(/\[QUERY\][\s\S]*?\[\/QUERY\]/gi, '').trim();

        // Query the database for that date
        const daySummary = this.db.getDailySummary(chatId, dbDate);
        const dayFoods = this.db.getFoodEntriesByDate(chatId, dbDate);
        const dayActivities = this.db.getActivitiesByDate(chatId, dbDate);

        const dbResult =
          `BERIKUT DATA DARI DATABASE UNTUK TANGGAL ${dbDate}:\n\n` +
          `📊 TOTAL: ${daySummary.totalCalories} kalori | ` +
          `Protein ${daySummary.totalProtein.toFixed(1)}g | ` +
          `Karbo ${daySummary.totalCarbs.toFixed(1)}g | ` +
          `Lemak ${daySummary.totalFats.toFixed(1)}g | ` +
          `${daySummary.foodCount} makanan | ${daySummary.activityCount} aktivitas | ` +
          `${daySummary.caloriesBurned} kalori terbakar\n\n` +
          (dayFoods.length > 0
            ? `📋 MAKANAN:\n${dayFoods.slice(0, 20).map((f, i) => `  ${i + 1}. ${f.description} (${f.type === 'drink' ? 'minuman' : 'makanan'}) — ${f.calories} kkal${f.protein ? `, protein ${f.protein}g` : ''}${f.carbs ? `, karbo ${f.carbs}g` : ''}${f.fats ? `, lemak ${f.fats}g` : ''}`).join('\n')}\n` : `📋 MAKANAN: tidak ada data untuk tanggal ini\n`) +
          (dayActivities.length > 0
            ? `\n🏃 AKTIVITAS:\n${dayActivities.slice(0, 10).map((a, i) => `  ${i + 1}. ${a.description}${a.duration ? ` (${a.duration} menit)` : ''}${a.caloriesBurned ? ` — ${a.caloriesBurned} kkal` : ''}`).join('\n')}\n`
            : ``) +
          `\nGunakan data ini untuk menjawab pertanyaan user. ` +
          `JANGAN tampilkan blok ini mentah — rangkum secara natural dalam Bahasa Indonesia.`;

        const dbMessage: Message = { role: 'system', content: dbResult };
        response = await this.llm.chat([...messages, dbMessage]);
        searchRounds++;
        continue;
      }

      // Priority 2: [SEARCH] block — AI asks for web search
      let searchQuery = this.extractSearchQuery(response);
      // Fallback: detect "I don't know" signals in the response even without [SEARCH]
      if (!searchQuery) {
        searchQuery = this.getAutoSearchQuery(userMessage, response);
      }
      if (!searchQuery) break;

      console.log(`🔎 RAG: AI tidak yakin, mencari di web: "${searchQuery}"`);
      // Strip the [SEARCH] block from the draft response
      response = response.replace(/\[SEARCH\][\s\S]*?\[\/SEARCH\]/gi, '').trim();

      // Perform web search
      let searchResult: string;
      try {
        searchResult = await searchFoodCalories(searchQuery);
      } catch (e) {
        console.error('⚠️ Search failed:', e);
        searchResult = `Gagal mencari "${searchQuery}". Gunakan perkiraan berdasarkan pengetahuan umum.`;
      }

      // Inject search results as a system message and re-ask the LLM
      const ragMessage: Message = {
        role: 'system',
        content:
          `BERIKUT HASIL PENCARIAN WEB UNTUK MENJAWAB PERTANYAAN USER:\n\n` +
          `${searchResult}\n\n` +
          `Gunakan informasi ini untuk menjawab dengan data akurat. ` +
          `Jika user menyebut makanan/minuman yang dikonsumsi, tetap sertakan [ACTION] block. ` +
          `JANGAN tampilkan teks ini atau hasil pencarian mentah ke user — rangkum secara natural.`,
      };
      const draftMessages: Message[] = [...messages, ragMessage];
      response = await this.llm.chat(draftMessages);
      searchRounds++;
    }

    // Parse action blocks (food/activity logging) from LLM response
    const { cleanText, actions } = this.parseActionBlocks(response);
    if (actions.length > 0) {
      this.logActions(chatId, actions);
      console.log(`   📝 ${actions.length} action(s) logged to DB`);
    }
    const replyText = cleanText || 'Oke, siap! 😊';

    // Add to history
    this.chatHistory[chatId].push({
      role: 'assistant',
      content: replyText,
    });

    // Send response
    await message.reply(replyText);

    // Stop typing indicator
    await this.stopTypingIndicator(chatId);

    console.log(`✓ Replied to ${chatId} (${profile!.name})`);
    console.log(`   "${replyText.substring(0, 100)}${replyText.length > 100 ? '...' : ''}"`);
  }

  /**
   * Detect "I don't know" signals in the LLM response and derive a search query
   * from the user's message. Used as a fallback when the LLM didn't emit [SEARCH].
   */
  private getAutoSearchQuery(userMessage: string, response: string): string | null {
    const lowerResp = response.toLowerCase();

    // "I don't know" signals in Indonesian (and some English)
    const notSureSignals = [
      'belum pernah denger', 'belum pernah dengar',
      'tidak tahu', 'ga tau', 'gak tau', 'nggak tau', 'nggak tahu', 'tidak tau',
      'tidak kenal', 'ga kenal', 'gak kenal', 'belum tau', 'belum tahu',
      'tidak yakin', 'ga yakin', 'tidak familiar', 'belum familiar', 'kurang familiar',
      'kurang tahu', 'kurang tau', 'tidak menemukan', 'tidak ada data',
      "don't know", "do not know", 'not sure', 'never heard', 'not familiar',
      'tidak hafal', 'ga hafal', 'kurang hafal', 'belum pernah nemu', 'belum nemu',
      'belum pernah lihat', 'belum pernah ketemu', 'belum pernah denger nama',
      'belum pernah dengar nama', 'tidak ada info', 'gak ada info',
      'tidak bisa membantu', 'ga bisa bantu',
    ];
    const notSure = notSureSignals.some((s) => lowerResp.includes(s));
    if (!notSure) return null;

    // Only auto-search if the user asked a question
    const isQuestion = userMessage.includes('?') ||
      /(berapa|apa|siapa|dimana|di mana|kapan|kenapa|bagaimana|gimana|taunya|tau gak|tau ga|apakah|info|jelasin)/i.test(userMessage);
    if (!isQuestion) return null;

    // Derive query: strip greeting/question filler words from user message
    const query = userMessage
      .replace(/\?/g, '')
      .replace(/^(kamu|lo|elu|anda|kau|kalian|bot|a\.i|ai)\s+/i, '')
      .replace(/^(tau|tahu|kenal|apakah|bisa|tolong|info|infokan|jelasin|coba|gimana|bagaimana)\s+/i, '')
      .replace(/\b(kalori|berapa|brand|merek|nama|namanya|tentang)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (query.length < 3) return null;
    return query;
  }

  /**
   * Extract a date query from the LLM response if it contains a [QUERY] block.
   * Format: [QUERY]{"date":"2026-08-30"}[/QUERY]
   * Returns the date string (YYYY-MM-DD) or null. Validates the date format.
   */
  private extractDateQuery(response: string): string | null {
    const match = response.match(/\[QUERY\]([\s\S]*?)\[\/QUERY\]/i);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      const date = parsed?.date?.trim();
      // Validate YYYY-MM-DD format
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const d = new Date(date + 'T00:00:00');
        // Check date is valid (not NaN) and not in the far future
        if (!isNaN(d.getTime()) && d <= new Date()) {
          return date;
        }
      }
    } catch {
      // Invalid JSON, ignore
    }
    return null;
  }

  /**
   * Extract a search query from the LLM response if it contains a [SEARCH] block.
   * Format: [SEARCH]{"query":"kalori nasi goreng"}[/SEARCH]
   * Returns null if no search requested.
   */
  private extractSearchQuery(response: string): string | null {
    const match = response.match(/\[SEARCH\]([\s\S]*?)\[\/SEARCH\]/i);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1].trim());
      const query = parsed?.query;
      if (typeof query === 'string' && query.trim().length > 0) {
        return query.trim();
      }
    } catch {
      // Fallback: use raw inner text as query
      const raw = match[1].trim();
      if (raw.length > 0) return raw;
    }
    return null;
  }

  /**
   * Extract [ACTION] JSON blocks from LLM response and return clean text + parsed actions.
   * Also strips model <thinking>...</thinking> blocks so they never reach the user.
   */
  private parseActionBlocks(response: string): { cleanText: string; actions: any[] } {
    const actionRegex = /\[ACTION\]([\s\S]*?)\[\/ACTION\]/g;
    const actions: any[] = [];
    let cleanText = response.replace(actionRegex, (_match, jsonStr) => {
      // ALWAYS strip the block from the reply — even if the JSON is malformed,
      // it must never leak to the client.
      try {
        const parsed = JSON.parse(jsonStr.trim());
        if (parsed && parsed.type) {
          actions.push(parsed);
        }
      } catch (e) {
        console.warn('⚠️ Failed to parse action block:', jsonStr.substring(0, 200));
      }
      return ''; // remove block from reply text unconditionally
    });

    // Strip any unclosed / leftover control-block tags so they can't leak to the client
    cleanText = cleanText
      .replace(/\[ACTION\][\s\S]*$/gi, '')          // trailing unclosed [ACTION]...
      .replace(/\[\/?ACTION\]/gi, '')                // stray [ACTION] / [/ACTION] tags
      .replace(/\[SEARCH\]([\s\S]*?)\[\/SEARCH\]/gi, '')
      .replace(/\[QUERY\]([\s\S]*?)\[\/QUERY\]/gi, '')
      .replace(/\[\/?(SEARCH|QUERY)\]/gi, '');       // stray [SEARCH]/[QUERY] tags

    // Strip model thinking/reasoning blocks (Claude-style <thinking>...</thinking>)
    cleanText = cleanText.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    // Also strip any other common reasoning artifacts
    cleanText = cleanText.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
    // Strip <thinking_mode>...</thinking_mode> blocks (some models emit these)
    cleanText = cleanText.replace(/<thinking_mode>[\s\S]*?<\/thinking_mode>/g, '');
    // Strip standalone <thinking_mode> / </thinking_mode> / <thinking_mode>enabled</thinking_mode> tags
    cleanText = cleanText.replace(/<\/?thinking_mode>/g, '');
    // Strip any other XML-like thinking tags
    cleanText = cleanText.replace(/<[^>]*thinking[^>]*>[\s\S]*?<\/[^>]*thinking[^>]*>/gi, '');

    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return { cleanText, actions };
  }

  /**
   * Resolve which day an action belongs to.
   * The LLM may set action.date = "YYYY-MM-DD" when the user reports something
   * they consumed/did on a PREVIOUS day (e.g. "tadi malem sebelum tidur makan...").
   * Otherwise the entry lands on today.
   */
  private resolveActionDate(action: any): string {
    const today = getTodayWIB();
    const raw = typeof action.date === 'string' ? action.date.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(raw + 'T00:00:00');
      if (!isNaN(d.getTime()) && raw <= today) {
        return raw;
      }
    }
    return today;
  }

  /** Persist parsed actions (food/activity) to the database */
  private logActions(chatId: string, actions: any[]): void {
    const timestamp = getNowWIB();
    for (const action of actions) {
      const date = this.resolveActionDate(action);
      if (action.type === 'food') {
        const desc = (action.description || 'makanan').trim();
        // Skip duplicates already logged on that day (e.g. user clarifying "yang greek")
        if (this.db.foodEntryExists(chatId, date, desc)) {
          console.log(`   ⏭️ Duplicate food skipped: ${desc} (already logged ${date})`);
          continue;
        }
        this.db.addFoodEntry({
          whatsappId: chatId,
          date,
          timestamp,
          type: action.kind === 'drink' ? 'drink' : 'food',
          description: desc,
          calories: Number(action.calories) || 0,
          protein: action.protein != null ? Number(action.protein) : undefined,
          carbs: action.carbs != null ? Number(action.carbs) : undefined,
          fats: action.fats != null ? Number(action.fats) : undefined,
        });
        console.log(`   🍽️ Logged food: ${desc} (${action.calories} kcal) → ${date}`);
      } else if (action.type === 'activity') {
        const desc = (action.description || 'aktivitas').trim();
        if (this.db.activityExists(chatId, date, desc)) {
          console.log(`   ⏭️ Duplicate activity skipped: ${desc} (already logged ${date})`);
          continue;
        }
        this.db.addActivity({
          whatsappId: chatId,
          date,
          timestamp,
          description: desc,
          duration: action.duration != null ? Number(action.duration) : undefined,
          caloriesBurned: action.caloriesBurned != null ? Number(action.caloriesBurned) : undefined,
        });
        console.log(`   💪 Logged activity: ${desc} (${action.caloriesBurned} kcal) → ${date}`);
      }
    }
  }

  private buildUserContext(
    profile: any,
    summary: any,
    foods: any[] = [],
    activities: any[] = [],
    yesterdayDate?: string,
    yesterdaySummary?: any,
    yesterdayFoods: any[] = [],
    yesterdayActivities: any[] = []
  ): string {
    const weightChange = profile.weight - profile.targetWeight;
    const progress = weightChange > 0 ? `${Math.abs(weightChange).toFixed(1)}kg lagi` : 'target tercapai!';

    // Current date/time
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    });

    // Build detail food list (max 15 items to keep context size reasonable)
    let foodDetail = '';
    if (foods.length > 0) {
      const list = foods.slice(0, 15);
      foodDetail = list.map((f, i) =>
        `  ${i+1}. ${f.description} (${f.type === 'drink' ? 'minuman' : 'makanan'}) — ${f.calories} kkal${f.protein ? `, protein ${f.protein}g` : ''}${f.carbs ? `, karbo ${f.carbs}g` : ''}${f.fats ? `, lemak ${f.fats}g` : ''}`
      ).join('\n');
    }

    // Build detail activity list
    let activityDetail = '';
    if (activities.length > 0) {
      const list = activities.slice(0, 10);
      activityDetail = list.map((a, i) =>
        `  ${i+1}. ${a.description}${a.duration ? ` (${a.duration} menit)` : ''}${a.caloriesBurned ? ` — ${a.caloriesBurned} kkal terbakar` : ''}`
      ).join('\n');
    }

    return `
═══════════════════════════════════════
USER PROFILE & DAILY CONTEXT
═══════════════════════════════════════

🕐 CURRENT DATE & TIME:
${dateStr}, ${timeStr} WIB

👤 User: ${profile.name}
${profile.gender ? `🚻 Gender: ${profile.gender === 'female' ? 'Perempuan' : 'Laki-laki'}` : ''}
${profile.age ? `🎂 Umur: ${profile.age} tahun${profile.birthYear ? ` (lahir ${profile.birthYear})` : ''}` : ''}
📏 Height: ${profile.height}cm
⚖️ Current Weight: ${profile.weight}kg
🎯 Target Weight: ${profile.targetWeight}kg
📊 Progress: ${progress}
🎯 Goal: ${profile.goal === 'lose' ? 'Turun berat' : profile.goal === 'gain' ? 'Naik berat' : 'Maintain'}
🔥 TDEE: ${profile.tdee} kalori/hari
🎯 Target Kalori: ${profile.targetCalories} kalori/hari

📅 TODAY (${summary.date}):
• Total Kalori: ${summary.totalCalories}/${profile.targetCalories} kalori
• Protein: ${summary.totalProtein.toFixed(1)}g
• Carbs: ${summary.totalCarbs.toFixed(1)}g
• Fats: ${summary.totalFats.toFixed(1)}g
• Makanan logged: ${summary.foodCount} items
• Aktivitas: ${summary.activityCount} activities
• Kalori terbakar: ${summary.caloriesBurned} kalori

${foodDetail ? `\n📋 DETAIL MAKANAN HARI INI:\n${foodDetail}\n` : ''}
${activityDetail ? `\n🏃 DETAIL AKTIVITAS HARI INI:\n${activityDetail}\n` : ''}

${yesterdaySummary ? `📅 KEMARIN (${yesterdayDate}):\n• Total Kalori: ${yesterdaySummary.totalCalories} kalori${profile.targetCalories ? ` (target ${profile.targetCalories})` : ''}\n• Protein: ${yesterdaySummary.totalProtein.toFixed(1)}g\n• Carbs: ${yesterdaySummary.totalCarbs.toFixed(1)}g\n• Fats: ${yesterdaySummary.totalFats.toFixed(1)}g\n• Makanan logged: ${yesterdaySummary.foodCount} items\n• Aktivitas: ${yesterdaySummary.activityCount} activities\n${yesterdayFoods.length > 0 ? `\n📋 DETAIL MAKANAN KEMARIN:\n${yesterdayFoods.slice(0, 15).map((f, i) => `  ${i+1}. ${f.description} (${f.type === 'drink' ? 'minuman' : 'makanan'}) — ${f.calories} kkal${f.protein ? `, protein ${f.protein}g` : ''}${f.carbs ? `, karbo ${f.carbs}g` : ''}${f.fats ? `, lemak ${f.fats}g` : ''}`).join('\n')}\n` : ''}` : ''}

${summary.totalCalories > profile.targetCalories ? '⚠️ User sudah over target kalori hari ini!' : ''}
${summary.totalCalories < profile.targetCalories * 0.7 ? '⚠️ User masih kurang kalori, remind untuk makan cukup!' : ''}

═══════════════════════════════════════

IMPORTANT INSTRUCTIONS:
0. PENCARIAN WAJIB untuk brand/restoran spesifik (misal "HAKA DIMSUM", "McD", "Starbucks", "KFC", "Hime no Coffee"):
   - Jika user TANYA TENTANG brand/restoran (misal "tau brand X?", "kenal restoran Y?", "ada gak X?") → SEARCH dulu, JANGAN ngarang info brand
   - Jika user TANYA KALORI makanan dari brand → SEARCH "<nama brand> <nama makanan> kalori"
   - JANGAN jawab tentang brand dari pengetahuan umum — selalu SEARCH untuk verify
   - Hanya jawab dari pengetahuan umum untuk makanan GENERIK tanpa brand (nasi, telur, ayam, tempe dll)
   - Jika ragu sedikit pun → SEARCH, jangan tebak!
   Format:
   [SEARCH]
   {"query":"<query pencarian>"}
   [/SEARCH]
   Contoh:
   - User: "tau brand hime no coffee?" → emit [SEARCH]{"query":"hime no coffee"}[/SEARCH]
   - User: "kalori dimsum HAKA" → emit [SEARCH]{"query":"haka dimsum kalori per porsi"}[/SEARCH]
   - User: "kalori big mac" → emit [SEARCH]{"query":"big mac kalori"}[/SEARCH]
1. Gunakan context di atas untuk personalize response
2. Jika user mention makanan/minuman yang mereka KONSUMSI → SERTAKAN action block food di akhir response, lalu kasih feedback. Format:
   [ACTION]
   {"type":"food","kind":"food","description":"<nama makanan/minuman>","calories":<perkiraan kalori>,"protein":<gram>,"carbs":<gram>,"fats":<gram>}
   [/ACTION]
   Untuk minuman, set "kind":"drink".
   PENTING SOAL TANGGAL: jika user melaporkan makanan yang dikonsumsi pada hari SEBELUMNYA (misal "tadi malem sebelum tidur aku makan...", "kemarin aku makan..."), TAMBAHKAN field "date":"YYYY-MM-DD" sesuai hari konsumsinya. Contoh: hari ini 14 Sept, user bilang "tadi malem makan lontong" → {"type":"food",...,"date":"2026-09-13"}. Kalau makanan dikonsumsi HARI INI, JANGAN tambahkan field date.
3. Jika user mention olahraga/aktivitas yang mereka LAKUKAN → SERTAKAN action block activity di akhir response:
   [ACTION]
   {"type":"activity","description":"<nama aktivitas>","duration":<menit>,"caloriesBurned":<perkiraan>}
   [/ACTION]
   Sama seperti makanan: jika aktivitas dilakukan di hari SEBELUMNYA, tambahkan "date":"YYYY-MM-DD".
4. JANGAN sertakan action block jika user hanya:
   - Mengklarifikasi/mengkonfirmasi makanan yang SUDAH disebut (misal user bilang "yogurt" lalu "yang greek" → jangan log lagi)
   - Menjawab pertanyaan bot tentang makanan (misal "berapa kalori nasi?")
   - Membahas/rekomendasi makanan, bukan mengkonsumsi
   - MENYATAKAN NIAT/RENCANA makan yang BELUM terjadi ("aku mau makan...", "pengen...", "nanti...", "besok...") — jangan log, itu belum dikonsumsi
   - TANYA PILIHAN / minta rekomendasi ("mau makan X atau Y ya?", "enakan mana?", "mending makan apa?") — jangan log salah satu apalagi keduanya
   Hanya log saat user MELAPORKAN makanan yang SUDAH/SEDANG mereka konsumsi ("aku makan...", "aku tadi makan...", "aku barusan...") dan belum pernah disebut sebelumnya.
5. Block [ACTION]...[/ACTION] adalah instruksi internal untuk bot, JANGAN jelaskan atau tampilkan ke user — tulis di akhir response dan bot akan otomatis menghapusnya sebelum kirim.
6. Jika user tanya "hari ini gimana" atau "aku makan apa" → JAWAB dengan DETIL dari "DETAIL MAKANAN HARI INI" (sebutkan nama makanan, kalori, makro per item). JANGAN bilang "aku cuma bisa lihat summary" — kamu punya akses penuh ke detail di context ini. Jika DETAIL MAKANAN kosong, baru bilang belum ada yang tercatat.
7. Jika user tanya tentang data KEMARIN ("kemarin aku makan apa", "kemarin dapat berapa kalori", "total kemarin") → JAWAB dari blok "📅 KEMARIN (tanggal)" di context ini — kamu punya akses penuh ke summary + detail makanan kemarin. JANGAN bilang "tidak bisa lihat data kemarin" selama blok KEMARIN ada di context. Jika blok KEMARIN tidak ada / kosong, baru bilang tidak ada data tercatat untuk hari itu.
8. Jika user tanya data tanggal LAIN (2 hari lalu, minggu lalu, tanggal custom seperti "25 Agustus") yang TIDAK ada di context → keluarkan block query database:
   [QUERY]
   {"date":"YYYY-MM-DD"}
   [/QUERY]
   Bot akan ambil data dari database untuk tanggal itu lalu bertanya lagi padamu. Format tanggal harus YYYY-MM-DD (contoh: 2026-08-29). JANGAN mengarang data untuk tanggal yang tidak ada di context — selalu gunakan [QUERY] dulu.
9. Selalu supportive berdasarkan progress mereka
10. Remind target kalori jika perlu

Response format: conversational WhatsApp style, max 300 kata.
    `.trim();
  }

  async start(): Promise<void> {
    console.log('🚀 Starting WhatsApp Bot...\n');
    await this.client.initialize();
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping WhatsApp Bot...');
    this.db.close();
    await this.client.destroy();
  }
}
