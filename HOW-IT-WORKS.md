# CARA KERJA BOT - PENJELASAN LENGKAP

## 1. ARSITEKTUR OVERVIEW

```
User (WhatsApp)
      |
      v
[WhatsApp Web.js Client] ← scan QR, connect ke WA
      |
      v
[Message Handler] ← terima pesan dari user
      |
      v
[Cek: User sudah onboarding?]
      |
      ├─ BELUM → [Onboarding Flow] → Save ke Database
      |
      └─ SUDAH → [Regular Chat Flow]
                      |
                      v
                [Load user profile dari Database]
                      |
                      v
                [Load daily summary dari Database]
                      |
                      v
                [Build context: profile + summary + AGENTS.md]
                      |
                      v
                [Kirim ke LLM API] ← OpenAI-compatible
                      |
                      v
                [Terima response dari LLM]
                      |
                      v
                [Kirim balik ke User via WhatsApp]
```

## 2. DIMANA DATA DISIMPAN?

Ada 4 tempat penyimpanan berbeda:

### A. WhatsApp Session (PERSISTENT)
**Lokasi:** `.wwebjs_auth/session/`

**Isi:** Session WhatsApp (login state, encryption keys)

**Sifat:** PERSISTENT - tidak hilang saat restart

**Fungsi:** Biar tidak perlu scan QR code setiap kali restart

**Cara lihat:**
```bash
ls -la .wwebjs_auth/session/
```

**Cara reset (kalau mau scan QR ulang):**
```bash
rm -rf .wwebjs_auth/
```

---

### B. Database SQLite (PERSISTENT)
**Lokasi:** `data/diet-tracker.db`

**Isi:** 
- User profiles (nama, tinggi, berat, target, TDEE, dll)
- Food entries (log makanan + kalori)
- Activities (log olahraga)
- Weight logs (history berat badan)

**Sifat:** PERSISTENT - permanen sampai dihapus manual

**Fungsi:** Simpan semua data tracking user

**Cara lihat:**
```bash
sqlite3 data/diet-tracker.db

# Di sqlite shell:
.tables                    # Lihat semua table
SELECT * FROM users;       # Lihat semua user
SELECT * FROM food_entries WHERE date = '2026-08-30';
.quit
```

**Struktur detail:**
```sql
-- User profile
CREATE TABLE users (
    whatsapp_id TEXT PRIMARY KEY,        -- 628xxx@c.us
    name TEXT,                           -- "Rio"
    height REAL,                         -- 170
    weight REAL,                         -- 75
    target_weight REAL,                  -- 65
    age INTEGER,                         -- 28
    gender TEXT,                         -- "male"
    activity_level TEXT,                 -- "moderate"
    goal TEXT,                           -- "lose"
    tdee REAL,                           -- 2350
    target_calories REAL,                -- 1850
    onboarding_completed INTEGER,        -- 1 = done
    created_at TEXT,
    updated_at TEXT
);

-- Food log
CREATE TABLE food_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp_id TEXT,
    date TEXT,              -- "2026-08-30"
    timestamp TEXT,         -- "2026-08-30T15:30:00"
    type TEXT,              -- "food" atau "drink"
    description TEXT,       -- "Nasi goreng + teh manis"
    calories REAL,          -- 430
    protein REAL,           -- 15
    carbs REAL,             -- 80
    fats REAL               -- 12
);
```

---

### C. Chat History (IN-MEMORY, TIDAK PERSISTENT)
**Lokasi:** Variable `chatHistory` di `src/client.ts` (Map in-memory)

**Isi:** 20 pesan terakhir per user (user message + assistant response)

**Sifat:** IN-MEMORY - hilang saat restart bot

**Fungsi:** Context conversation untuk LLM (biar LLM ingat percakapan sebelumnya)

**Format:**
```typescript
chatHistory = {
  "628123456789@c.us": [
    { role: "user", content: "Pagi ini sarapan nasi goreng" },
    { role: "assistant", content: "Wah nasi goreng! Estimasi 350 kalori..." },
    { role: "user", content: "Berapa target kalori aku?" },
    { role: "assistant", content: "Target kamu 1850 kalori/hari..." },
    // ... max 20 messages
  ],
  "628987654321@c.us": [ ... ]  // User lain
}
```

**Kenapa hilang saat restart?**
- Disimpan di RAM, bukan disk
- Kalo restart, chat history reset dari awal
- User profile & data tracking tetap aman di database

**Cara lihat (saat running):**
- Tidak bisa lihat langsung (in-memory)
- Hanya bisa lihat di log terminal saat bot running

---

### D. Onboarding State (IN-MEMORY, TIDAK PERSISTENT)
**Lokasi:** Variable `onboardingState` di `src/onboarding.ts` (Map in-memory)

**Isi:** Progress onboarding user yang sedang proses (belum selesai)

**Sifat:** IN-MEMORY - hilang saat restart

**Fungsi:** Track progres onboarding multi-step

**Format:**
```typescript
onboardingState = {
  "628123456789@c.us": {
    whatsappId: "628123456789@c.us",
    name: "Rio",          // ✓ sudah ditanya
    height: 170,          // ✓ sudah ditanya
    weight: 75,           // ✓ sudah ditanya
    // targetWeight: belum
    // goal: belum
    // activityLevel: belum
  }
}
```

**Apa yang terjadi kalau restart di tengah onboarding?**
- Onboarding state hilang
- User harus mulai onboarding dari awal lagi
- Solusi: bisa save partial state ke database (future improvement)

---

## 3. FLOW MESSAGE HANDLING - DETAIL

### Saat user kirim pesan:

**Step 1: Receive Message**
```typescript
// di src/client.ts
this.client.on('message_create', async (message) => {
  await this.handleMessage(message);
});
```

**Step 2: Filter**
- Skip kalau dari status broadcast
- Skip kalau dari bot sendiri (fromMe)
- Skip kalau pesan kosong

**Step 3: Check Onboarding**
```typescript
if (!this.onboarding.isOnboarded(chatId)) {
  // User belum onboarding → masuk onboarding flow
  await this.handleOnboarding(message, chatId, userMessage);
} else {
  // User sudah onboarding → regular chat
  await this.handleRegularChat(message, chatId, userMessage);
}
```

**Step 4A: Onboarding Flow (kalau belum onboarded)**
```
1. Check onboarding state dari memory
2. Kalau belum mulai → kirim welcome message
3. Kalau sudah mulai → parse jawaban user
4. Validate jawaban (angka valid? pilihan valid?)
5. Update onboarding state
6. Check apakah sudah lengkap?
   - Kalau lengkap → calculate TDEE, save ke database, kirim completion message
   - Kalau belum → tanya pertanyaan next
```

**Step 4B: Regular Chat Flow (kalau sudah onboarded)**
```
1. Load user profile dari database
   SELECT * FROM users WHERE whatsapp_id = ?

2. Load daily summary dari database
   SELECT SUM(calories), SUM(protein), ...
   FROM food_entries
   WHERE whatsapp_id = ? AND date = '2026-08-30'

3. Build user context:
   - Profile (nama, berat, target, TDEE, target kalori)
   - Today's data (kalori consumed, protein, activities, dll)
   - Progress indicator

4. Load chat history dari memory (20 pesan terakhir)

5. Build messages array untuk LLM:
   [
     { role: "system", content: AGENTS.md + user context },
     { role: "user", content: "message 1" },
     { role: "assistant", content: "response 1" },
     { role: "user", content: "message 2" },
     ...
     { role: "user", content: "message baru dari user" }
   ]

6. Kirim ke LLM API (HTTP POST ke endpoint kamu)

7. Terima response dari LLM

8. Save response ke chat history (in-memory)

9. Send response ke user via WhatsApp
```

---

## 4. CONTOH KONKRET - USER FLOW

### Scenario 1: User Baru Pertama Kali Chat

```
User: Halo
   |
   v
[Bot check database] → User tidak ada
   |
   v
[Start onboarding] → Save state ke memory
   |
   v
Bot: 🌟 Selamat datang! Siapa nama kamu?
   |
   v
User: Rio
   |
   v
[Parse answer] → name = "Rio"
[Update state di memory] → { whatsappId, name: "Rio" }
   |
   v
Bot: Halo Rio! Tinggi badan kamu berapa cm?
   |
   v
User: 170
   |
   v
[Parse answer] → height = 170
[Update state] → { ..., height: 170 }
   |
   v
Bot: Berat badan kamu sekarang berapa kg?

... (dst sampai semua data lengkap)

   |
   v
[All data complete!]
[Calculate TDEE] → 2350 kalori
[Calculate target] → 1850 kalori (deficit 500)
   |
   v
[INSERT INTO users] → Save ke database
[DELETE from onboarding state] → Hapus dari memory
   |
   v
Bot: ✅ Onboarding selesai! Welcome, Rio! 🎉
     Target: 1850 kalori/hari
     Yuk mulai tracking!
```

### Scenario 2: User yang Sudah Onboarding Chat

```
User: Pagi ini makan nasi goreng
   |
   v
[Bot check database] → User ada, onboarding_completed = 1
   |
   v
[Load profile dari DB]
   SELECT * FROM users WHERE whatsapp_id = '628xxx@c.us'
   → Rio, 170cm, 75kg, target 65kg, 1850 kalori/hari
   |
   v
[Load today's summary dari DB]
   SELECT SUM(calories), ... FROM food_entries WHERE date = today
   → Total: 0 kalori (belum ada entry hari ini)
   |
   v
[Build context]
   USER PROFILE:
   - Name: Rio
   - Weight: 75kg → Target: 65kg
   - Target Calories: 1850/hari
   
   TODAY (2026-08-30):
   - Total Calories: 0/1850
   - Foods: 0 items
   |
   v
[Load chat history dari memory]
   (kosong kalau baru restart, atau ada 20 pesan terakhir)
   |
   v
[Add user message ke history]
   chatHistory["628xxx"] = [
     { role: "user", content: "Pagi ini makan nasi goreng" }
   ]
   |
   v
[Build messages untuk LLM]
   [
     {
       role: "system",
       content: "AGENTS.md content + Rio's profile + today's summary"
     },
     {
       role: "user",
       content: "Pagi ini makan nasi goreng"
     }
   ]
   |
   v
[HTTP POST ke LLM API]
   POST http://localhost:8080/v1/chat/completions
   Body: { model, messages, temperature, max_tokens }
   |
   v
[LLM Response]
   "Wah nasi goreng nih! 🍳
   Estimasi kalori: ~350 kalori
   Mau aku log ke database?
   Btw protein cukup ga? Coba tambah telur..."
   |
   v
[Add response ke chat history]
   chatHistory["628xxx"] = [
     { role: "user", content: "Pagi ini makan nasi goreng" },
     { role: "assistant", content: "Wah nasi goreng..." }
   ]
   |
   v
[Send via WhatsApp]
   message.reply("Wah nasi goreng...")
   |
   v
User receives message on WhatsApp
```

---

## 5. PERSISTENCE - APA YANG HILANG SAAT RESTART?

### ❌ HILANG (In-Memory):
1. **Chat history** - percakapan terakhir
2. **Onboarding state** - kalau user lagi tengah-tengah onboarding
3. **Bot runtime state** - uptime, cache, dll

### ✅ TETAP ADA (Persistent):
1. **User profiles** - semua data user di database
2. **Food entries** - semua log makanan
3. **Activities** - semua log olahraga
4. **Weight logs** - semua history berat badan
5. **WhatsApp session** - tidak perlu scan QR ulang

---

## 6. CARA MONITORING DATA

### Lihat user yang sudah register:
```bash
sqlite3 data/diet-tracker.db "SELECT whatsapp_id, name, weight, target_weight FROM users;"
```

### Lihat food entries hari ini:
```bash
sqlite3 data/diet-tracker.db "SELECT * FROM food_entries WHERE date = '2026-08-30';"
```

### Lihat daily summary satu user:
```bash
sqlite3 data/diet-tracker.db "
  SELECT 
    date,
    SUM(calories) as total_cal,
    COUNT(*) as foods
  FROM food_entries 
  WHERE whatsapp_id = '628123456789@c.us'
  GROUP BY date
  ORDER BY date DESC
  LIMIT 7;
"
```

### Export semua user ke CSV:
```bash
sqlite3 -header -csv data/diet-tracker.db "SELECT * FROM users;" > users.csv
```

---

## 7. DEBUGGING TIPS

### Lihat log real-time:
```bash
# Run bot di foreground
npm start

# Atau dengan PM2
pm2 logs whatsapp-bot --lines 100
```

### Test database connection:
```bash
sqlite3 data/diet-tracker.db ".tables"
```

### Reset satu user (hapus profile):
```bash
sqlite3 data/diet-tracker.db "DELETE FROM users WHERE whatsapp_id = '628xxx@c.us';"
# User akan onboarding ulang
```

### Backup database:
```bash
cp data/diet-tracker.db data/backup-$(date +%Y%m%d).db
```

---

## 8. LIMITASI YANG PERLU DIPAHAMI

1. **Chat history hilang saat restart**
   - LLM tidak ingat conversation sebelum restart
   - Solusi: bisa save conversation history ke database (future)

2. **Onboarding interrupted saat restart**
   - User harus mulai dari awal lagi
   - Solusi: save partial state ke database

3. **No automatic logging**
   - AI hanya estimate & suggest, tidak auto-log ke database
   - User harus explicitly confirm untuk log
   - Solusi: parse intent & auto-log (future)

4. **Single instance bottleneck**
   - Satu bot handle semua user
   - Kalau banyak user simultan, bisa slow
   - Solusi: load balancing / multiple instances

5. **WhatsApp rate limits**
   - WhatsApp Web bisa ban kalau spam
   - Keep response time reasonable
   - Don't send too many messages too fast

---

## 9. FILES PENTING

```
whatsapp-chatbot/
├── src/
│   ├── index.ts           # Entry point, start bot
│   ├── client.ts          # WhatsApp client, message handler
│   ├── llm.ts             # LLM API integration
│   ├── database.ts        # SQLite CRUD operations
│   ├── onboarding.ts      # Onboarding logic & TDEE calculation
│   ├── agents-parser.ts   # Load AGENTS.md, watch for changes
│   ├── config.ts          # Load .env config
│   └── types.ts           # TypeScript interfaces
│
├── data/
│   └── diet-tracker.db    # SQLite database (PERSISTENT)
│
├── .wwebjs_auth/
│   └── session/           # WhatsApp session (PERSISTENT)
│
├── AGENTS.md              # Bot personality & instructions
├── .env                   # LLM API config (SECRET!)
├── DATABASE.md            # Dokumentasi ini
└── start.sh               # Quick start script
```

---

## 10. NEXT STEPS BUAT KAMU

1. **Baca file source code:**
   ```bash
   # Mulai dari entry point
   cat src/index.ts
   
   # Lihat message handler
   cat src/client.ts | less
   
   # Lihat onboarding logic
   cat src/onboarding.ts | less
   ```

2. **Test onboarding flow:**
   - Delete semua user dari database
   - Start bot
   - Chat dari WhatsApp kamu
   - Ikuti onboarding
   - Check database setelah selesai

3. **Explore database:**
   ```bash
   sqlite3 data/diet-tracker.db
   .schema users
   .schema food_entries
   SELECT * FROM users;
   ```

4. **Modify AGENTS.md:**
   - Edit personality, tone, guidelines
   - Save file
   - Bot auto-reload (hot-reload)
   - Test apakah behavior berubah

5. **Test dengan multiple user:**
   - Chat dari 2 nomor berbeda
   - Check apakah data terpisah
   - Check database

---

Sudah lebih jelas? Ada bagian tertentu yang mau dijelasin lebih detail?
