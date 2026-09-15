# FORMAT EXACT CONTEXT SESSION YANG DIKIRIM KE LLM

## 1. DIMANA SCRIPT BACA AGENTS.MD?

### A. Script Load AGENTS.md (saat bot start)

**File:** `src/agents-parser.ts` line 9-40

```typescript
export function parseAgentsMd(filePath: string): AgentsConfig {
  // Baca file AGENTS.md
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  // Ambil SEMUA isi file sebagai system prompt
  const systemPrompt = content.trim();
  
  return {
    systemPrompt,  // Ini yang akan dikirim ke LLM
    rawContent: content,
  };
}
```

**Dipanggil di:** `src/client.ts` line 35 (constructor)

```typescript
constructor() {
  // ... setup WhatsApp client
  
  // LOAD AGENTS.MD DISINI - saat bot start
  this.agentsConfig = parseAgentsMd(config.agentsMdPath);
  
  // ... setup event handlers
}
```

Jadi **AGENTS.md wajib dibaca saat bot start**, disimpan di `this.agentsConfig.systemPrompt`.

### B. Script Inject AGENTS.md ke LLM (setiap chat)

**File:** `src/client.ts` line 216-222

```typescript
// Build messages with system prompt + user context
const messages: Message[] = [
  {
    role: 'system',
    // AGENTS.MD DIINJECT DISINI + USER CONTEXT
    content: this.agentsConfig.systemPrompt + '\n\n' + userContext,
  },
  ...this.chatHistory[chatId],  // Chat history 20 pesan terakhir
];

// Kirim ke LLM
const response = await this.llm.chat(messages);
```

---

## 2. FORMAT EXACT CONTEXT SESSION

Format yang dikirim ke LLM API adalah **array of messages** dalam format OpenAI:

```json
{
  "model": "kr/claude-sonnet-4.5",
  "messages": [
    {
      "role": "system",
      "content": "... ISI AGENTS.MD + USER CONTEXT ..."
    },
    {
      "role": "user",
      "content": "Pagi ini makan nasi goreng"
    },
    {
      "role": "assistant",
      "content": "Wah nasi goreng! Estimasi 350 kalori..."
    },
    {
      "role": "user",
      "content": "Hari ini gimana?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

---

## 3. CONTOH KONKRET - ISI EXACT MESSAGE ARRAY

Misalnya user **Rio** yang sudah onboarding chat "Hari ini gimana?"

### Message[0] - System Role (AGENTS.MD + Context)

```
role: "system"
content: "
# Personal Trainer - Diet & Nutrition Coach

Kamu adalah personal trainer yang fokus membantu pengguna mencapai target diet...

## Personality

- Supportive dan empathetic - memahami perjuangan diet itu berat
- Motivational tapi realistis - dorong progress kecil, bukan perfeksi
...

[SELURUH ISI AGENTS.MD 6313 characters]

...

Response format: conversational WhatsApp style, max 300 kata.

═══════════════════════════════════════
USER PROFILE & DAILY CONTEXT
═══════════════════════════════════════

👤 User: Rio
📏 Height: 170cm
⚖️ Current Weight: 75kg
🎯 Target Weight: 65kg
📊 Progress: 10.0kg lagi
🎯 Goal: Turun berat
🔥 TDEE: 2350 kalori/hari
🎯 Target Kalori: 1850 kalori/hari

📅 TODAY (2026-08-30):
• Total Kalori: 430/1850 kalori
• Protein: 15.0g
• Carbs: 80.0g
• Fats: 12.0g
• Makanan logged: 1 items
• Aktivitas: 0 activities
• Kalori terbakar: 0 kalori

⚠️ User masih kurang kalori, remind untuk makan cukup!

═══════════════════════════════════════

IMPORTANT INSTRUCTIONS:
1. Gunakan context di atas untuk personalize response
2. Jika user mention makanan/minuman → estimate kalori & suggest logging
3. Jika user mention olahraga/aktivitas → estimate kalori burned & suggest logging
4. Jika user tanya \"hari ini gimana\" → summarize data di atas
5. Selalu supportive berdasarkan progress mereka
6. Remind target kalori jika perlu

Response format: conversational WhatsApp style, max 300 kata.
"
```

**Breakdown:**
- **Line 1-200+**: Seluruh isi AGENTS.md (6313 chars)
- **Line 200-250**: User profile Rio (height, weight, target, TDEE, target calories)
- **Line 250-280**: Daily summary hari ini (kalori consumed, protein, carbs, activities)
- **Line 280-300**: Instructions tambahan untuk LLM

### Message[1] - User Message (dari chat history)

```
role: "user"
content: "Pagi ini makan nasi goreng"
```

### Message[2] - Assistant Response (dari chat history)

```
role: "assistant"
content: "Wah nasi goreng nih! 🍳

Estimasi kalori:
• Nasi goreng (1 porsi): ~350 kalori
• Total: ~350 kalori

Mau aku log ke database?

Btw protein nya cukup ga nih? Coba tambah telur atau ayam biar kenyang lebih lama 💪"
```

### Message[3] - User Message (pesan baru)

```
role: "user"
content: "Hari ini gimana?"
```

---

## 4. FULL EXAMPLE - REQUEST KE LLM API

```http
POST http://localhost:20218/v1/chat/completions
Content-Type: application/json
Authorization: Bearer your-api-key-here

{
  "model": "kr/claude-sonnet-4.5",
  "temperature": 0.7,
  "max_tokens": 2000,
  "messages": [
    {
      "role": "system",
      "content": "# Personal Trainer - Diet & Nutrition Coach\n\nKamu adalah personal trainer...\n\n[6313 chars dari AGENTS.MD]\n\n...Response format: conversational WhatsApp style, max 300 kata.\n\n═══════════════════════════════════════\nUSER PROFILE & DAILY CONTEXT\n═══════════════════════════════════════\n\n👤 User: Rio\n📏 Height: 170cm\n⚖️ Current Weight: 75kg\n🎯 Target Weight: 65kg\n📊 Progress: 10.0kg lagi\n🎯 Goal: Turun berat\n🔥 TDEE: 2350 kalori/hari\n🎯 Target Kalori: 1850 kalori/hari\n\n📅 TODAY (2026-08-30):\n• Total Kalori: 430/1850 kalori\n• Protein: 15.0g\n• Carbs: 80.0g\n• Fats: 12.0g\n• Makanan logged: 1 items\n• Aktivitas: 0 activities\n• Kalori terbakar: 0 kalori\n\n⚠️ User masih kurang kalori, remind untuk makan cukup!\n\n═══════════════════════════════════════\n\nIMPORTANT INSTRUCTIONS:\n1. Gunakan context di atas untuk personalize response\n2. Jika user mention makanan/minuman → estimate kalori & suggest logging\n3. Jika user mention olahraga/aktivitas → estimate kalori burned & suggest logging\n4. Jika user tanya \"hari ini gimana\" → summarize data di atas\n5. Selalu supportive berdasarkan progress mereka\n6. Remind target kalori jika perlu\n\nResponse format: conversational WhatsApp style, max 300 kata."
    },
    {
      "role": "user",
      "content": "Pagi ini makan nasi goreng"
    },
    {
      "role": "assistant",
      "content": "Wah nasi goreng nih! 🍳\n\nEstimasi kalori:\n• Nasi goreng (1 porsi): ~350 kalori\n• Total: ~350 kalori\n\nMau aku log ke database?\n\nBtw protein nya cukup ga nih? Coba tambah telur atau ayam biar kenyang lebih lama 💪"
    },
    {
      "role": "user",
      "content": "Hari ini gimana?"
    }
  ]
}
```

---

## 5. DIMANA CODE YANG BUILD FORMAT INI?

### A. Load AGENTS.md (bot start)

**File:** `src/client.ts` line 35

```typescript
constructor() {
  // ...
  this.agentsConfig = parseAgentsMd(config.agentsMdPath);
  // ...
}
```

**Function:** `src/agents-parser.ts` line 9-40

```typescript
export function parseAgentsMd(filePath: string): AgentsConfig {
  const content = fs.readFileSync(fullPath, 'utf-8');
  const systemPrompt = content.trim();
  
  return {
    systemPrompt,  // Seluruh isi AGENTS.md
    rawContent: content,
  };
}
```

### B. Build User Context (setiap chat)

**File:** `src/client.ts` line 240-282

```typescript
private buildUserContext(profile: any, summary: any): string {
  const weightChange = profile.weight - profile.targetWeight;
  const progress = weightChange > 0 ? `${Math.abs(weightChange).toFixed(1)}kg lagi` : 'target tercapai!';

  return `
═══════════════════════════════════════
USER PROFILE & DAILY CONTEXT
═══════════════════════════════════════

👤 User: ${profile.name}
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

${summary.totalCalories > profile.targetCalories ? '⚠️ User sudah over target kalori hari ini!' : ''}
${summary.totalCalories < profile.targetCalories * 0.7 ? '⚠️ User masih kurang kalori, remind untuk makan cukup!' : ''}

═══════════════════════════════════════

IMPORTANT INSTRUCTIONS:
1. Gunakan context di atas untuk personalize response
2. Jika user mention makanan/minuman → estimate kalori & suggest logging
3. Jika user mention olahraga/aktivitas → estimate kalori burned & suggest logging
4. Jika user tanya "hari ini gimana" → summarize data di atas
5. Selalu supportive berdasarkan progress mereka
6. Remind target kalori jika perlu

Response format: conversational WhatsApp style, max 300 kata.
  `.trim();
}
```

### C. Combine AGENTS.md + User Context + Chat History (setiap chat)

**File:** `src/client.ts` line 216-225

```typescript
// Build messages with system prompt + user context
const messages: Message[] = [
  {
    role: 'system',
    content: this.agentsConfig.systemPrompt + '\n\n' + userContext,
    //       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^         ^^^^^^^^^^^^
    //       AGENTS.md (6313 chars)                   User context (profile + today)
  },
  ...this.chatHistory[chatId],  // Spread 20 chat history terakhir
];

// Send to LLM
const response = await this.llm.chat(messages);
```

### D. Send ke LLM API

**File:** `src/llm.ts` line 27-48

```typescript
async chat(messages: Message[]): Promise<string> {
  const response = await axios.post(
    this.apiUrl,  // http://localhost:20218/v1/chat/completions
    {
      model: this.model,           // kr/claude-sonnet-4.5
      messages: messages,          // Array yang kita build di atas
      max_tokens: this.maxTokens,  // 2000
      temperature: this.temperature, // 0.7
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
    }
  );

  return response.data.choices[0].message.content;
}
```

---

## 6. URUTAN EKSEKUSI (STEP BY STEP)

### Saat Bot Start (1x)
1. `src/index.ts` → panggil `new WhatsAppBot()`
2. `src/client.ts` constructor → panggil `parseAgentsMd()`
3. `src/agents-parser.ts` → baca file AGENTS.md
4. Save ke `this.agentsConfig.systemPrompt`
5. Setup file watcher untuk hot-reload

### Saat User Chat (setiap pesan)
1. WhatsApp receive message → trigger `handleMessage()`
2. Check onboarding status
3. Kalau sudah onboarding → `handleRegularChat()`
4. Load user profile dari database
5. Load today's summary dari database
6. Build user context (function `buildUserContext()`)
7. Build messages array:
   - Index 0: system = AGENTS.md + user context
   - Index 1-N: chat history dari memory
8. Send ke LLM API (HTTP POST)
9. Receive response dari LLM
10. Save response ke chat history
11. Send to WhatsApp user

---

## 7. CARA DEBUG - LIHAT EXACT CONTEXT YANG DIKIRIM

### Option 1: Tambah console.log

Edit `src/client.ts` line 216-225:

```typescript
const messages: Message[] = [
  {
    role: 'system',
    content: this.agentsConfig.systemPrompt + '\n\n' + userContext,
  },
  ...this.chatHistory[chatId],
];

// DEBUG: Print exact context yang dikirim ke LLM
console.log('\n=== CONTEXT SENT TO LLM ===');
console.log(JSON.stringify(messages, null, 2));
console.log('=== END CONTEXT ===\n');

const response = await this.llm.chat(messages);
```

Rebuild & run:
```bash
npm run build
npm start
```

Saat user chat, console akan print exact JSON yang dikirim ke LLM.

### Option 2: Log ke file

Edit `src/llm.ts` line 27:

```typescript
async chat(messages: Message[]): Promise<string> {
  // Save request ke file untuk debugging
  const fs = require('fs');
  const logFile = `./logs/llm-request-${Date.now()}.json`;
  fs.mkdirSync('./logs', { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(messages, null, 2));
  console.log(`📝 LLM request saved to ${logFile}`);
  
  // Continue normal flow
  const response = await axios.post(...);
  ...
}
```

Setiap request ke LLM akan disave ke file `logs/llm-request-*.json`.

---

## 8. KEY TAKEAWAYS

✅ **AGENTS.md dibaca WAJIB saat bot start** (line 35 di client.ts)

✅ **Format context = AGENTS.md + User Profile + Daily Summary + Chat History**

✅ **Chat history max 20 messages** (in-memory, hilang saat restart)

✅ **User profile & daily data dari database** (persistent)

✅ **System message selalu index 0** dalam messages array

✅ **Hot-reload: edit AGENTS.md → auto-reload tanpa restart** (file watcher)

✅ **OpenAI-compatible format** (role: system/user/assistant)

---

File ini ada di: `/home/xixi/whatsapp-chatbot/CONTEXT-FORMAT.md`
Silakan dibaca bareng sama source code untuk lebih jelas!
