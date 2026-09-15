# CONTEXT OVERFLOW - APA YANG TERJADI?

## Skenario "Context Penuh"

Ada 3 jenis "penuh" yang bisa terjadi:

### 1. Chat History Penuh (SUDAH DI-HANDLE ✅)
### 2. Token Limit LLM Exceeded (BELUM DI-HANDLE ❌)
### 3. Database Penuh (UNLIKELY, tapi bisa)

---

## 1. CHAT HISTORY PENUH - SUDAH DI-HANDLE ✅

### Apa yang Terjadi?

**Limit:** Max 20 messages per user (10 user + 10 assistant)

**File:** `src/client.ts` line 23 + 210-213

```typescript
private maxHistoryLength = 20; // Max 20 messages

// Saat add message baru:
if (this.chatHistory[chatId].length > this.maxHistoryLength) {
  // Keep only last 20 messages (sliding window)
  this.chatHistory[chatId] = this.chatHistory[chatId].slice(-this.maxHistoryLength);
}
```

### Contoh:

```
Chat history saat ini (20 messages):
[msg1, msg2, msg3, ..., msg18, msg19, msg20]

User kirim message baru:
→ Add msg21 ke array
→ Array jadi 21 messages
→ Trigger trim: slice(-20)
→ Remove msg1 (oldest)
→ Keep [msg2, msg3, ..., msg20, msg21]

Result: Selalu max 20 messages
```

### Efek:

- ✅ Memory tidak overflow
- ✅ Token count terkontrol
- ❌ Bot "lupa" conversation lama (sebelum 20 message terakhir)

### Solusi (kalau mau improve):

**Option A: Save chat history ke database**

```typescript
// Add table di database.ts
CREATE TABLE chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_id TEXT,
  role TEXT,
  content TEXT,
  timestamp TEXT
);

// Save setiap message
this.db.saveChatMessage(chatId, 'user', userMessage);
this.db.saveChatMessage(chatId, 'assistant', response);

// Load last N messages dari DB (instead of memory)
const history = this.db.getChatHistory(chatId, limit=20);
```

**Option B: Summarize old context**

```typescript
// Kalau history > 20, summarize 10 oldest messages
if (this.chatHistory[chatId].length > 20) {
  const oldMessages = this.chatHistory[chatId].slice(0, 10);
  const summary = await this.llm.summarize(oldMessages);
  
  // Replace 10 old messages with 1 summary
  this.chatHistory[chatId] = [
    { role: 'system', content: `Previous conversation summary: ${summary}` },
    ...this.chatHistory[chatId].slice(10)
  ];
}
```

---

## 2. TOKEN LIMIT LLM EXCEEDED - BELUM DI-HANDLE ❌

### Apa yang Terjadi?

**Problem:** Total tokens (input + output) melebihi model's context window

**Current Setup:**
```
System message:
  - AGENTS.md: ~6,313 chars = ~1,578 tokens
  - userContext: ~500 chars = ~125 tokens
  - Total system: ~1,700 tokens

Chat history (max 20 messages):
  - Avg 200 chars per message
  - 20 × 200 = 4,000 chars = ~1,000 tokens

Total INPUT tokens: ~2,700 tokens
Max OUTPUT tokens: 2,000 tokens (config)

TOTAL: ~4,700 tokens
```

**Model Limits:**
- GPT-3.5-turbo: 4K context (BISA OVERFLOW! ❌)
- GPT-4: 8K context (Aman ✅)
- GPT-4-32K: 32K context (Aman ✅)
- Claude Sonnet: 200K context (Super aman ✅)

### Apa yang Terjadi Kalau Overflow?

**Scenario 1: LLM API reject request**

```
Error 400 Bad Request:
{
  "error": {
    "message": "This model's maximum context length is 4096 tokens. 
                However, your messages resulted in 5200 tokens.",
    "type": "invalid_request_error"
  }
}
```

Bot akan:
1. Axios throw error
2. Catch di `handleMessage()`
3. Reply ke user: "Maaf, terjadi kesalahan. Silakan coba lagi."
4. User bingung, conversation stuck

**Scenario 2: LLM truncate silently**

Beberapa API silently truncate input (potong oldest messages). User tidak tau kenapa bot "lupa" context.

### Solusi (perlu ditambahkan):

**Option A: Token Counting + Dynamic Trimming**

Install `tiktoken` atau `gpt-tokenizer`:

```bash
npm install gpt-tokenizer
```

```typescript
import { encode } from 'gpt-tokenizer';

private async handleRegularChat(...) {
  const userContext = this.buildUserContext(profile!, summary);
  
  // Calculate token count
  const systemTokens = encode(this.agentsConfig.systemPrompt + userContext).length;
  const maxHistoryTokens = 2000; // Reserve 2000 tokens for history
  const maxOutputTokens = 2000;
  const modelMaxTokens = 4096; // Get from config
  
  // Build messages
  const messages: Message[] = [
    { role: 'system', content: this.agentsConfig.systemPrompt + userContext },
  ];
  
  // Add history messages, but stop if exceed token limit
  let historyTokens = 0;
  for (let i = this.chatHistory[chatId].length - 1; i >= 0; i--) {
    const msg = this.chatHistory[chatId][i];
    const msgTokens = encode(msg.content).length;
    
    if (historyTokens + msgTokens > maxHistoryTokens) {
      console.log(`⚠️ Trimming history: would exceed token limit`);
      break;
    }
    
    messages.unshift(msg); // Add to front
    historyTokens += msgTokens;
  }
  
  const totalTokens = systemTokens + historyTokens + maxOutputTokens;
  console.log(`📊 Token usage: ${totalTokens}/${modelMaxTokens}`);
  
  if (totalTokens > modelMaxTokens) {
    throw new Error('Context too large even after trimming');
  }
  
  const response = await this.llm.chat(messages);
  // ...
}
```

**Option B: Compress AGENTS.md Dynamically**

Kalau AGENTS.md terlalu panjang (6313 chars), bisa dikompress:

```typescript
// Jangan kirim full AGENTS.md setiap kali
// Extract core instructions only
private getCoreInstructions(): string {
  return `
You are a supportive Personal Trainer for diet & nutrition.

User: ${profile.name}, ${profile.weight}kg → target ${profile.targetWeight}kg
Goal: ${profile.goal}
Target: ${profile.targetCalories} cal/day
Today: ${summary.totalCalories} cal consumed

Guidelines:
- Supportive & motivational tone
- Estimate calories when user mentions food
- Remind target if over/under
- Max 300 words, WhatsApp style
  `.trim();
}

// Use compressed version instead of full AGENTS.md
const messages: Message[] = [
  {
    role: 'system',
    content: this.getCoreInstructions(),  // ~300 chars instead of 6313
  },
  ...this.chatHistory[chatId],
];
```

**Option C: Error Handling + Fallback**

```typescript
// src/llm.ts
async chat(messages: Message[]): Promise<string> {
  try {
    const response = await axios.post(this.apiUrl, {
      model: this.model,
      messages: messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    }, {
      headers: { ... },
      timeout: 60000,
    });
    
    return response.data.choices[0].message.content;
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMsg = error.response?.data?.error?.message || '';
      
      // Detect token limit error
      if (errorMsg.includes('maximum context length') || 
          errorMsg.includes('too many tokens')) {
        console.error('⚠️ Token limit exceeded!');
        
        // Fallback: retry with compressed context
        throw new Error('CONTEXT_TOO_LARGE');
      }
    }
    throw error;
  }
}

// client.ts - catch and retry
try {
  const response = await this.llm.chat(messages);
} catch (error) {
  if (error.message === 'CONTEXT_TOO_LARGE') {
    // Retry with shorter history
    console.log('🔄 Retrying with compressed context...');
    const shorterMessages = [
      messages[0], // Keep system message
      ...messages.slice(-5) // Keep only last 5 messages
    ];
    const response = await this.llm.chat(shorterMessages);
    await message.reply(response);
    return;
  }
  throw error;
}
```

---

## 3. DATABASE PENUH - UNLIKELY TAPI BISA

### Apa yang Terjadi?

**Problem:** SQLite file terlalu besar (GB-scale data)

**Current:**
- Database: `data/diet-tracker.db` (40KB fresh)
- No size limit di code
- SQLite max size: 140 TB (praktikal limit: disk space)

**Realistic Scenario:**

Misalnya 1000 users, each:
- 1 profile entry: ~500 bytes
- 5 food entries per day × 365 days: ~500 KB/year
- 2 activity entries per day × 365 days: ~200 KB/year
- 1 weight log per week × 52 weeks: ~10 KB/year

Per user per year: ~710 KB
1000 users: ~710 MB/year

**Aman untuk bertahun-tahun!** Unlikely jadi masalah.

### Jika Benar-Benar Penuh:

**Option A: Auto-archive old data**

```typescript
// Cron job: archive data older than 1 year
async archiveOldData() {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoffDate = oneYearAgo.toISOString().split('T')[0];
  
  // Move to archive database
  this.db.exec(`
    ATTACH DATABASE 'data/archive.db' AS archive;
    
    INSERT INTO archive.food_entries 
    SELECT * FROM food_entries WHERE date < '${cutoffDate}';
    
    DELETE FROM food_entries WHERE date < '${cutoffDate}';
    
    DETACH DATABASE archive;
  `);
  
  console.log(`✓ Archived data older than ${cutoffDate}`);
}
```

**Option B: Vacuum database**

```bash
# Reclaim unused space
sqlite3 data/diet-tracker.db "VACUUM;"
```

---

## REKOMENDASI IMPLEMENTASI

### Priority 1: Token Limit Protection (HIGH PRIORITY)

```typescript
// Add to .env
MODEL_MAX_TOKENS=4096

// Add to config.ts
export const config: Config = {
  // ...
  modelMaxTokens: parseInt(process.env.MODEL_MAX_TOKENS || '4096'),
};

// Add token counting
npm install gpt-tokenizer

// Implement dynamic trimming di client.ts
// (code di atas - Option A)
```

### Priority 2: Better Error Handling (MEDIUM)

```typescript
// src/llm.ts - detect token errors
// src/client.ts - catch and retry with compressed context
// (code di atas - Option C)
```

### Priority 3: Chat History Persistence (LOW - NICE TO HAVE)

```typescript
// Add chat_history table
// Save every message to DB
// Load from DB instead of memory
// (code di atas - Option A di section 1)
```

---

## MONITORING - CARA CEK CONTEXT SIZE

### Add Logging

Edit `src/client.ts` sebelum send ke LLM:

```typescript
const messages: Message[] = [ ... ];

// Calculate size
const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
const estimatedTokens = Math.ceil(totalChars / 4); // Rough estimate

console.log(`📊 Context stats:`);
console.log(`   - Messages: ${messages.length}`);
console.log(`   - Total chars: ${totalChars}`);
console.log(`   - Estimated tokens: ${estimatedTokens}`);
console.log(`   - System message: ${messages[0].content.length} chars`);

if (estimatedTokens > 3000) {
  console.warn(`⚠️  Large context! May hit token limit.`);
}

const response = await this.llm.chat(messages);
```

### Dashboard Query

Check database growth:

```sql
-- Total users
SELECT COUNT(*) FROM users;

-- Total food entries
SELECT COUNT(*) FROM food_entries;

-- Entries per user
SELECT 
  whatsapp_id, 
  COUNT(*) as entries,
  MIN(date) as first_entry,
  MAX(date) as last_entry
FROM food_entries
GROUP BY whatsapp_id
ORDER BY entries DESC
LIMIT 10;

-- Database size
SELECT page_count * page_size / 1024 / 1024 as size_mb 
FROM pragma_page_count(), pragma_page_size();
```

---

## KEY TAKEAWAYS

✅ **Chat history overflow: HANDLED** (max 20 messages sliding window)

❌ **Token limit overflow: NOT HANDLED** (bisa error kalau model kecil)

✅ **Database overflow: UNLIKELY** (710 MB per 1000 users per year)

**Action Items:**
1. Tambah token counting & dynamic trimming
2. Add error handling untuk token limit
3. Add logging untuk monitor context size
4. Optional: compress AGENTS.md atau save chat history to DB

Mau saya implementasikan token limit protection sekarang?
