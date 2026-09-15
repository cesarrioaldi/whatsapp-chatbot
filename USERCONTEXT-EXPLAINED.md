# userContext - DIMANA DISIMPAN?

## JAWABAN SINGKAT:

**`userContext` TIDAK DISIMPAN DI MANAPUN.**

Itu adalah **variabel lokal temporary** yang di-generate fresh setiap kali user chat, lalu di-inject ke LLM, lalu **dibuang** setelah selesai.

---

## PENJELASAN DETAIL:

### 1. Lifecycle userContext

```
User chat → Bot receive message
    ↓
Load profile dari database (SELECT * FROM users)
    ↓
Load today summary dari database (SELECT SUM(...) FROM food_entries)
    ↓
BUILD userContext (format string dari data DB)  ← GENERATED HERE
    ↓
Inject ke messages array → Send to LLM
    ↓
Receive LLM response → Reply to user
    ↓
userContext DIBUANG (out of scope)  ← DELETED HERE
```

### 2. Code Exact

**File:** `src/client.ts` line 186-238

```typescript
private async handleRegularChat(
  message: WAMessage,
  chatId: string,
  userMessage: string
): Promise<void> {
  // Step 1: Load data dari DATABASE
  const profile = this.db.getUserProfile(chatId);  
  // ↑ Dari table users
  
  const today = new Date().toISOString().split('T')[0];
  const summary = this.db.getDailySummary(chatId, today);
  // ↑ Calculate dari table food_entries hari ini
  
  // Step 2: BUILD userContext (TEMPORARY, tidak disave)
  const userContext = this.buildUserContext(profile!, summary);
  // ↑ Variabel lokal, cuma ada di function ini
  
  // Step 3: Build messages array
  const messages: Message[] = [
    {
      role: 'system',
      content: this.agentsConfig.systemPrompt + '\n\n' + userContext,
      //                                                  ^^^^^^^^^^^
      //                                                  Inject disini
    },
    ...this.chatHistory[chatId],
  ];
  
  // Step 4: Send to LLM
  const response = await this.llm.chat(messages);
  
  // Step 5: Reply to user
  await message.reply(response);
  
  // userContext HILANG setelah function selesai (out of scope)
}
```

### 3. Function buildUserContext

**File:** `src/client.ts` line 240-282

```typescript
private buildUserContext(profile: any, summary: any): string {
  // Pure function: terima input, return formatted string
  // TIDAK save ke database, TIDAK save ke memory
  
  const weightChange = profile.weight - profile.targetWeight;
  const progress = weightChange > 0 ? 
    `${Math.abs(weightChange).toFixed(1)}kg lagi` : 
    'target tercapai!';

  // Return formatted string
  return `
═══════════════════════════════════════
USER PROFILE & DAILY CONTEXT
═══════════════════════════════════════

👤 User: ${profile.name}
📏 Height: ${profile.height}cm
⚖️ Current Weight: ${profile.weight}kg
...
  `.trim();
  
  // String ini langsung dikembalikan, tidak disimpan
}
```

---

## DATA YANG DIGUNAKAN UNTUK BUILD userContext

userContext di-build dari data yang **SUDAH DISIMPAN** di database:

### A. User Profile (PERSISTENT - dari database)

**Table:** `users`
**Data:**
- name, height, weight, target_weight
- age, gender, activity_level, goal
- tdee, target_calories
- onboarding_completed

**Loaded via:**
```typescript
const profile = this.db.getUserProfile(chatId);
// SELECT * FROM users WHERE whatsapp_id = ?
```

### B. Daily Summary (CALCULATED on-the-fly dari database)

**Source:** Table `food_entries` + `activities`
**Calculated:**
- Total calories hari ini (SUM dari food_entries)
- Total protein, carbs, fats (SUM dari food_entries)
- Food count (COUNT dari food_entries)
- Activity count (COUNT dari activities)
- Calories burned (SUM dari activities)

**Calculated via:**
```typescript
const summary = this.db.getDailySummary(chatId, today);
```

**Function:** `src/database.ts` line 227-245

```typescript
getDailySummary(whatsappId: string, date: string): DailySummary {
  // Load dari database
  const foods = this.getFoodEntriesByDate(whatsappId, date);
  // SELECT * FROM food_entries WHERE whatsapp_id = ? AND date = ?
  
  const activities = this.getActivitiesByDate(whatsappId, date);
  // SELECT * FROM activities WHERE whatsapp_id = ? AND date = ?
  
  // Calculate summary (in-memory calculation)
  const totalCalories = foods.reduce((sum, f) => sum + f.calories, 0);
  const totalProtein = foods.reduce((sum, f) => sum + (f.protein || 0), 0);
  // ... dst
  
  // Return object (tidak disave kemana-mana)
  return {
    date,
    totalCalories,
    totalProtein,
    totalCarbs,
    totalFats,
    foodCount: foods.length,
    activityCount: activities.length,
    caloriesBurned,
  };
}
```

---

## KENAPA TIDAK DISIMPAN?

### 1. Tidak Perlu

userContext adalah **derived data** (data turunan) yang bisa di-generate kapan saja dari data source (database).

Kalau disimpan, malah:
- Duplicate data
- Bisa out-of-sync kalau user update profile
- Waste storage

### 2. Selalu Fresh

Karena di-generate setiap chat, data selalu up-to-date:
- User baru log makanan → daily summary langsung update
- User update weight → profile langsung update

### 3. Lightweight

String formatted context cuma dipake sekali (untuk 1 chat), lalu dibuang. Efficient.

---

## YANG PERSISTENT VS YANG TEMPORARY

### ✅ PERSISTENT (Disimpan di Database)

1. **User Profile**
   - Lokasi: Table `users`
   - Contoh: name="Rio", weight=75, target_weight=65

2. **Food Entries**
   - Lokasi: Table `food_entries`
   - Contoh: "Nasi goreng", 350 calories, date="2026-08-30"

3. **Activities**
   - Lokasi: Table `activities`
   - Contoh: "Jogging 30 menit", 250 calories burned

4. **Weight Logs**
   - Lokasi: Table `weight_logs`
   - Contoh: date="2026-08-30", weight=75kg

### ❌ TEMPORARY (Tidak Disimpan)

1. **userContext**
   - Generated on-the-fly dari database
   - Cuma ada saat execute function
   - Dibuang setelah send ke LLM

2. **Daily Summary Object**
   - Calculated on-the-fly dari food_entries
   - Return value dari function
   - Dibuang setelah dipakai untuk build userContext

3. **messages Array**
   - Built untuk 1 request LLM
   - Dibuang setelah dapat response

---

## FLOW DATA - VISUAL

```
[DATABASE] ─────────────────┐
│                           │
│ ┌─────────────┐          │
│ │   users     │          │  PERSISTENT
│ │  Rio, 75kg  │          │  (disimpan permanen)
│ └─────────────┘          │
│                           │
│ ┌─────────────┐          │
│ │food_entries │          │
│ │ nasi goreng │          │
│ │  350 cal    │          │
│ └─────────────┘          │
└───────────────────────────┘
        │
        │ Load via SQL SELECT
        ↓
[IN-MEMORY] ────────────────┐
│                           │
│  profile = {             │  TEMPORARY
│    name: "Rio",          │  (di-generate saat chat,
│    weight: 75            │   lalu dibuang)
│  }                        │
│                           │
│  summary = {             │
│    totalCalories: 350    │
│  }                        │
│                           │
│  userContext = `         │
│    User: Rio             │
│    Weight: 75kg          │
│    Calories: 350/1850    │
│  `                        │
└───────────────────────────┘
        │
        │ Inject ke messages array
        ↓
[HTTP REQUEST] ─────────────┐
│                           │
│  POST /v1/chat/...       │  TEMPORARY
│  {                        │  (HTTP request,
│    messages: [           │   selesai lalu dibuang)
│      {                    │
│        role: "system",   │
│        content: AGENTS + │
│                userContext│
│      }                    │
│    ]                      │
│  }                        │
└───────────────────────────┘
        │
        │ Send to LLM
        ↓
[LLM Response] ─────────────┐
│                           │
│  "Hari ini sudah 350    │  TEMPORARY
│   kalori, sisa 1500      │  (response langsung
│   kalori lagi..."        │   dikirim ke user)
└───────────────────────────┘
        │
        │ Reply to WhatsApp
        ↓
   [USER receives message]
```

---

## CARA LIHAT userContext (Debugging)

Karena temporary, tidak bisa lihat setelah selesai. Tapi bisa debug saat running:

### Option 1: Console.log

Edit `src/client.ts` line 197 (setelah build userContext):

```typescript
const userContext = this.buildUserContext(profile!, summary);

// DEBUG: Print userContext
console.log('\n════════════════════════════════════');
console.log('USER CONTEXT GENERATED:');
console.log(userContext);
console.log('════════════════════════════════════\n');

// Continue normal flow
if (!this.chatHistory[chatId]) {
  this.chatHistory[chatId] = [];
}
```

Rebuild & run:
```bash
npm run build
npm start
```

Saat user chat, console akan print exact userContext yang di-generate.

### Option 2: Save to File

Edit `src/client.ts` line 197:

```typescript
const userContext = this.buildUserContext(profile!, summary);

// DEBUG: Save to file
const fs = require('fs');
fs.mkdirSync('./logs', { recursive: true });
const logFile = `./logs/userContext-${chatId}-${Date.now()}.txt`;
fs.writeFileSync(logFile, userContext);
console.log(`📝 userContext saved to ${logFile}`);

// Continue normal flow
```

Setiap chat akan save userContext ke file `logs/userContext-*.txt`.

---

## KEY TAKEAWAYS

✅ **userContext = temporary string** generated setiap chat

✅ **Source data = database** (users table + food_entries table)

✅ **Tidak disimpan** - langsung inject ke LLM lalu dibuang

✅ **Selalu fresh** - calculate ulang dari database setiap chat

✅ **Efficient** - tidak duplicate data, tidak waste storage

✅ **Debug via console.log atau save to file** (edit client.ts)

---

Sudah jelas? Intinya userContext itu cuma "formatted view" dari data database, bukan storage sendiri.
