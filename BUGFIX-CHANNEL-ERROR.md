# BUG FIX: Channel/Group Message Error

## Problem

Error saat receive message dari channel/broadcast list:
```
📨 Message from 55757366136929@lid:
Error: r: r
  at Client.getChatById
```

- `@lid` = List/Channel ID (bukan personal chat)
- WhatsApp Web.js `getChat()` tidak support chat type ini
- Bot crash dan reply error

## Root Cause

**File:** `src/client.ts` line 121

```typescript
const chat = await message.getChat();  // ← Error untuk non-personal chat
await chat.sendStateTyping();
```

WhatsApp chat types:
- `@c.us` = Personal chat ✅ (supported)
- `@g.us` = Group chat ⚠️ (mungkin support, tapi tidak untuk diet bot)
- `@lid` = Channel/List ❌ (tidak support)
- `@newsletter` = Newsletter ❌ (tidak support)

## Fix Applied

**File:** `src/client.ts` line 118-135

```typescript
// Filter: only process personal chats
if (!chatId.endsWith('@c.us')) {
  console.log(`⏭️  Skipped non-personal chat: ${chatId}`);
  return;
}

// Get chat with error handling
let chat;
try {
  chat = await message.getChat();
  await chat.sendStateTyping();
} catch (chatError) {
  console.error(`⚠️  Failed to get chat, continuing without typing indicator`);
  // Continue processing even if getChat() fails
}
```

## Changes

1. **Filter chat types** - hanya proses `@c.us` (personal chat)
2. **Error handling** - wrap `getChat()` in try-catch
3. **Continue processing** - kalau getChat() fail, lanjut tanpa typing indicator

## Expected Behavior (After Fix)

### Scenario 1: Message from Channel/List

```
📨 Message from 55757366136929@lid:
   "hai ini siapa?"
⏭️  Skipped non-personal chat: 55757366136929@lid
```

Bot tidak reply, tidak error.

### Scenario 2: Message from Group

```
📨 Message from 12345678@g.us:
   "hai"
⏭️  Skipped non-personal chat: 12345678@g.us
```

Bot tidak reply, tidak error.

### Scenario 3: Message from Personal Chat

```
📨 Message from 628123456789@c.us:
   "hai"
✓ Bot processes normally
✓ Onboarding atau regular chat
```

Bot reply normal.

## Testing

Rebuild:
```bash
npm run build
npm start
```

Test:
1. Kirim message dari channel → bot skip (no error)
2. Kirim message dari personal chat → bot reply normal

## Notes

Diet bot dirancang untuk personal 1-on-1 coaching. Group/channel support tidak diperlukan karena:
- Profile data per-person (privacy)
- Personal tracking (food, weight)
- Intimate conversation style

Kalau nanti mau support group chat, perlu logic berbeda (multiple users in one chat).
