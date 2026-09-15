# CRITICAL: Channel/List Problem untuk Diet Bot

## Problem

Diet bot dirancang untuk **personal 1-on-1 coaching** dengan data pribadi:
- Berat badan, tinggi badan, target
- Food entries (makanan yang dimakan)
- Weight logs (history berat badan)

**Database key = WhatsApp ID (chatId)**

## Apa yang Terjadi di Channel/List?

### Skenario:

1. **User A** kirim message di channel: "hai"
   - `message.from` = `55757366136929@lid` (channel ID)
   - Bot save profile dengan key `55757366136929@lid`
   - User A onboarding: nama = "Alice", berat = 60kg

2. **User B** kirim message di channel yang sama: "halo"
   - `message.from` = `55757366136929@lid` (SAMA!)
   - Bot load profile dengan key `55757366136929@lid`
   - Bot pikir user B adalah Alice dengan berat 60kg ❌

**Semua user di channel SHARE PROFILE yang sama!**

### Privacy & Data Collision:

- ❌ User A's personal data (weight, food log) terlihat oleh bot saat user B chat
- ❌ User B's input overwrite user A's data
- ❌ No privacy protection
- ❌ Not suitable untuk health data

## Solusi

### Option 1: Individual User ID (Recommended)

Pakai `message.author` atau participant ID instead of channel ID:

```typescript
// Get actual user ID, not channel ID
let userId: string;
if (chatId.includes('@lid') || chatId.includes('@g.us')) {
  // Channel or group: use author/participant
  userId = message.author || message._data.participant || chatId;
} else {
  // Personal chat: use chatId
  userId = chatId;
}

// Use userId for database operations
const profile = this.db.getUserProfile(userId);
```

**Pros:**
- Setiap user punya profile sendiri
- Privacy protected

**Cons:**
- Bot tidak bisa tag/mention user di channel (WhatsApp limitation)
- Bot reply visible untuk semua (public conversation)
- Not ideal untuk sensitive health data

### Option 2: Channel = Public Mode (No Personal Data)

Bot di channel jadi "general advisor" without tracking:

```typescript
if (chatId.includes('@lid')) {
  // Channel mode: no onboarding, no tracking
  // Just answer questions based on AGENTS.md
  const messages = [
    { role: 'system', content: AGENTS.md },
    { role: 'user', content: userMessage }
  ];
  const response = await this.llm.chat(messages);
  await message.reply(response);
  return;
}

// Personal chat: full tracking + onboarding
// ...
```

**Pros:**
- Simple, no data collision
- Public Q&A mode

**Cons:**
- No personalization
- No tracking features

### Option 3: Hybrid (Recommended)

Bot aware context dan behave differently:

```typescript
const isChannel = chatId.includes('@lid');
const isGroup = chatId.includes('@g.us');

if (isChannel || isGroup) {
  // Public mode: general advice, no personal tracking
  await this.handlePublicChat(message, chatId, userMessage);
} else {
  // Personal mode: full features with tracking
  await this.handlePrivateChat(message, chatId, userMessage);
}
```

## User's Use Case

**Question untuk user:**

Kalau bot di-deploy ke channel untuk "public":

1. **Apakah user expect bot track data mereka?**
   - Ya → perlu Option 1 (individual user ID)
   - Tidak → perlu Option 2 atau 3 (general advisor mode)

2. **Apakah user OK dengan public conversation?**
   - User A: "Berat badan aku 90kg, mau turun 20kg"
   - Bot: "Ok Alice, target 70kg. TDEE kamu 2500 kalori..."
   - **Semua member channel bisa baca** ← Privacy concern!

3. **Ideal use case?**
   - **Personal chat:** Private coaching with full tracking ✅
   - **Channel:** Public Q&A, general tips, education (no tracking) ✅
   - **Channel dengan tracking:** Technically possible tapi privacy risk ⚠️

## Recommendation

**BEST PRACTICE:**

1. **Personal Chat (1-on-1):** Full diet bot features
   - Onboarding
   - Food/activity tracking
   - Personalized advice
   - Private conversation

2. **Channel/Group:** General advisor mode
   - No onboarding
   - No tracking
   - Answer general questions
   - Public education

3. **Direct users ke personal chat untuk tracking:**
   ```
   Bot di channel:
   "Untuk tracking makanan dan program diet personal, 
    chat aku langsung di personal chat ya! 
    Kirim 'hai' ke nomor ini: [bot number]"
   ```

---

**Action Required:**

User harus decide:
1. Channel untuk apa? (tracking atau general advisor?)
2. OK dengan privacy implications?
3. Mau implement mana? (Option 1, 2, atau 3?)
