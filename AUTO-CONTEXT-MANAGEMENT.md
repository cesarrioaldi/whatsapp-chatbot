# AUTO CONTEXT MANAGEMENT - CURRENT STATE

## TL;DR

**Current Implementation:**
- ✅ Chat history auto-trim (sliding window, max 20 messages)
- ❌ NO auto token counting
- ❌ NO intelligent compression/summarization
- ❌ NO dynamic compaction saat mendekati limit

**Risk:** Bot bisa crash kalau hit model's token limit (terutama GPT-3.5 4K)

---

## 1. YANG SUDAH ADA (Basic Protection)

### A. Chat History Sliding Window

**File:** `src/client.ts` line 223-226

```typescript
// Trim history if too long
if (this.chatHistory[chatId].length > this.maxHistoryLength) {
  // Keep only last 20 messages
  this.chatHistory[chatId] = this.chatHistory[chatId].slice(-this.maxHistoryLength);
}
```

**How it works:**
- Max 20 messages per user (10 user + 10 assistant)
- Oldest messages dropped automatically
- Simple, predictable, no intelligence

**Pros:**
- ✅ Simple & reliable
- ✅ Memory bounded
- ✅ No additional compute

**Cons:**
- ❌ Bot "lupa" conversation lama
- ❌ Tidak aware token count (bisa overflow kalau messages panjang)
- ❌ No context preservation (bisa lose important info)

### B. Fixed-Size userContext

**File:** `src/client.ts` line 253-281

```typescript
private buildUserContext(profile: any, summary: any): string {
  // Always ~500 chars regardless of data size
  return `
  User: ${profile.name}
  Height: ${profile.height}cm
  Weight: ${profile.weight}kg
  Target: ${profile.targetWeight}kg
  ...
  TODAY:
  Total Calories: ${summary.totalCalories} cal  ← Aggregate, not detail
  Food count: ${summary.foodCount} items
  `;
}
```

**Size:** ~500 chars = ~125 tokens (FIXED)

**Why fixed?**
- Aggregate data only (SUM, COUNT), not individual entries
- Database size doesn't affect context size

---

## 2. YANG BELUM ADA (Missing Features)

### A. Token Counting ❌

Bot **TIDAK** count tokens before sending to LLM.

**Risk:**
```
Current context:
- AGENTS.md: ~1,578 tokens
- userContext: ~125 tokens
- Chat history: 20 × ~50 tokens = 1,000 tokens
- Total: ~2,703 tokens

If model = GPT-3.5 (4K limit):
- Input: 2,703 tokens
- Output: 2,000 tokens (configured max)
- Total: 4,703 tokens → OVERFLOW! ❌
```

Bot akan crash dengan error:
```
Error 400: maximum context length is 4096 tokens
```

### B. Dynamic Compression ❌

Bot **TIDAK** compress/summarize saat mendekati limit.

Ideal behavior (not implemented):
```
If estimated_tokens > model_limit * 0.8:
  → Compress AGENTS.md (extract core only)
  → Summarize old messages
  → Trim chat history more aggressively
```

### C. Intelligent Summarization ❌

Bot **TIDAK** summarize old context.

Ideal behavior (not implemented):
```
If chat_history > 20 messages:
  → Summarize oldest 10 messages into 1 summary message
  → Keep recent 10 messages verbatim
  → Preserve important context (user goals, decisions)
```

---

## 3. ERROR HANDLING (Current State)

### Scenario: Context Overflow

**File:** `src/llm.ts` line 27-48

```typescript
async chat(messages: Message[]): Promise<string> {
  try {
    const response = await axios.post(this.apiUrl, { messages, ... });
    return response.data.choices[0].message.content;
  } catch (error) {
    // Generic error handling - NO specific token limit detection
    console.error('LLM API Error:', error);
    throw new Error(`LLM API failed: ${error.message}`);
  }
}
```

**What happens:**
1. LLM API returns 400 error
2. Bot logs error
3. Bot replies: "Maaf, terjadi kesalahan. Silakan coba lagi."
4. User confused (tidak tau kenapa error)
5. **Conversation stuck** (context masih penuh, retry will fail again)

**No recovery mechanism!**

---

## 4. SOLUSI YANG BISA DIIMPLEMENTASIKAN

### Option A: Token Counting + Hard Limit (Simple)

Install token counter:
```bash
npm install gpt-tokenizer
```

Implement:
```typescript
import { encode } from 'gpt-tokenizer';

private async handleRegularChat(...) {
  // Build messages
  const messages = [ ... ];
  
  // Count tokens
  const totalTokens = messages.reduce((sum, m) => 
    sum + encode(m.content).length, 0
  );
  
  console.log(`📊 Context: ${totalTokens} tokens`);
  
  // Hard limit check
  const modelLimit = 4096; // From config
  const maxOutput = 2000;
  
  if (totalTokens + maxOutput > modelLimit) {
    // Trim chat history more aggressively
    const maxHistory = Math.floor((modelLimit - maxOutput - systemTokens) / 100);
    this.chatHistory[chatId] = this.chatHistory[chatId].slice(-maxHistory);
    
    // Rebuild messages
    messages = [ systemMsg, ...trimmedHistory ];
  }
  
  const response = await this.llm.chat(messages);
  ...
}
```

**Pros:**
- ✅ Prevent overflow
- ✅ Auto-trim based on actual token count
- ✅ Simple to implement

**Cons:**
- ❌ Still loses old context
- ❌ No intelligence (hard cut)

### Option B: Intelligent Summarization (Advanced)

```typescript
private async compressContext(
  messages: Message[], 
  targetTokens: number
): Promise<Message[]> {
  const currentTokens = this.countTokens(messages);
  
  if (currentTokens <= targetTokens) {
    return messages; // No compression needed
  }
  
  // Split into system, old conversation, recent conversation
  const systemMsg = messages[0];
  const oldMsgs = messages.slice(1, -10); // Oldest messages
  const recentMsgs = messages.slice(-10); // Keep last 10 verbatim
  
  // Summarize old messages
  const summary = await this.llm.chat([
    { 
      role: 'system', 
      content: 'Summarize this conversation in 2-3 sentences. Focus on: user goals, decisions made, important facts mentioned.'
    },
    ...oldMsgs
  ]);
  
  // Rebuild with summary
  return [
    systemMsg,
    { 
      role: 'system', 
      content: `Previous conversation summary: ${summary}` 
    },
    ...recentMsgs
  ];
}
```

**Pros:**
- ✅ Preserve context semantically
- ✅ Intelligent compression
- ✅ Better user experience

**Cons:**
- ❌ Additional LLM call (cost & latency)
- ❌ Complex to implement
- ❌ Summary quality depends on LLM

### Option C: Compress AGENTS.md (Practical)

```typescript
private getCompressedSystemPrompt(profile: UserProfile, summary: DailySummary): string {
  // Instead of full AGENTS.md (6313 chars), extract core
  return `
You are a supportive Personal Trainer AI for diet & nutrition.

Key personality:
- Supportive & motivational (not judgmental)
- Conversational WhatsApp style
- Max 300 words, use emoji

User Profile:
- ${profile.name}, ${profile.weight}kg → target ${profile.targetWeight}kg
- Goal: ${profile.goal}
- Target: ${profile.targetCalories} cal/day

Today: ${summary.totalCalories}/${profile.targetCalories} cal, ${summary.foodCount} foods logged

Guidelines:
1. Estimate calories when user mentions food
2. Suggest logging if appropriate
3. Remind target if over/under
4. Always supportive & practical
  `.trim();
}
```

**Size:** ~400 chars vs 6313 chars (93% reduction!)

**Pros:**
- ✅ Massive token saving
- ✅ Still captures core behavior
- ✅ Fast, no extra LLM calls

**Cons:**
- ❌ Lose detailed instructions
- ❌ Behavior might be less refined

---

## 5. MONITORING (What to Add)

### A. Context Size Logging

Add to `src/client.ts` before LLM call:

```typescript
const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
const estimatedTokens = Math.ceil(totalChars / 4);

console.log(`📊 Context stats:`);
console.log(`   Messages: ${messages.length}`);
console.log(`   Total chars: ${totalChars}`);
console.log(`   Estimated tokens: ${estimatedTokens}`);

if (estimatedTokens > 3000) {
  console.warn(`⚠️  Large context! May hit token limit.`);
}
```

### B. Error Detection

Add to `src/llm.ts`:

```typescript
catch (error) {
  if (axios.isAxiosError(error)) {
    const errorMsg = error.response?.data?.error?.message || '';
    
    // Detect token limit
    if (errorMsg.includes('maximum context length') || 
        errorMsg.includes('too many tokens')) {
      console.error('🚨 TOKEN LIMIT EXCEEDED!');
      throw new Error('CONTEXT_TOO_LARGE');
    }
  }
  throw error;
}
```

---

## 6. REKOMENDASI UNTUK PROJECT INI

### Priority 1: Add Token Counting + Monitoring (CRITICAL)

**Why:** Know when overflow akan terjadi

**Implement:**
1. Install `gpt-tokenizer`
2. Add logging before LLM call
3. Add `MODEL_MAX_TOKENS` to config

**Effort:** 30 minutes

### Priority 2: Compress AGENTS.md (HIGH)

**Why:** Save ~1400 tokens instantly

**Implement:**
1. Create `getCompressedSystemPrompt()` function
2. Use when estimated tokens > threshold

**Effort:** 1 hour

### Priority 3: Error Handling + Retry (MEDIUM)

**Why:** Graceful degradation instead of crash

**Implement:**
1. Detect token limit errors
2. Retry with compressed context
3. Inform user if retry fails

**Effort:** 1-2 hours

### Priority 4: Intelligent Summarization (LOW - NICE TO HAVE)

**Why:** Best UX, but complex

**Implement when:**
- Bot stable in production
- Have budget for extra LLM calls
- Need perfect context preservation

**Effort:** 4-8 hours

---

## 7. CURRENT RISK ASSESSMENT

### With Current Implementation:

**Model: GPT-3.5 (4K tokens)**
- Risk: **HIGH** 🔴
- Bisa overflow kalau chat history panjang
- No recovery mechanism

**Model: GPT-4 (8K tokens)**
- Risk: **LOW** 🟢
- Unlikely overflow dengan current chat history limit

**Model: Claude Sonnet (200K tokens)**
- Risk: **VERY LOW** 🟢
- Practically impossible to overflow

### Your Current Setup:

```
LLM_MODEL=kr/claude-sonnet-4.5
```

**Risk: VERY LOW** 🟢

Claude Sonnet 4.5 punya 200K context window. Dengan current implementation:
- AGENTS.md: 1,578 tokens
- userContext: 125 tokens
- Chat history (20 msgs): ~1,000 tokens
- **Total: ~2,700 tokens / 200,000 = 1.35%**

**Kamu aman! Auto-compaction tidak urgent untuk setup ini.**

---

## 8. KESIMPULAN

### Current State:

✅ **Basic protection:** Chat history sliding window (max 20)
✅ **Fixed userContext:** Tidak grow dengan database size
❌ **NO token counting:** Tidak aware context size
❌ **NO auto-compression:** Tidak adaptive
❌ **NO error recovery:** Crash kalau overflow

### For Your Setup (Claude Sonnet):

🟢 **SAFE** - 200K context window, current usage ~2.7K tokens

Auto-compaction **tidak diperlukan** untuk production sekarang.

### Future-Proofing:

Kalau nanti:
- Switch ke model lebih kecil (GPT-3.5)
- Chat history jadi sangat panjang
- AGENTS.md diperbesar

Maka perlu implement:
1. Token counting + monitoring
2. AGENTS.md compression
3. Error handling + retry

---

**Mau saya implement token counting + monitoring sekarang untuk safety?** (30 menit)

Atau untuk setup kamu sekarang (Claude Sonnet 200K), **tidak urgent** - current implementation sudah cukup aman.
