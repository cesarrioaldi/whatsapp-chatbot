# FITUR BARU - Database & Onboarding

## Overview

Bot sekarang punya sistem tracking lengkap dengan database SQLite:
- ✅ Multi-user support (setiap WhatsApp number punya data sendiri)
- ✅ Onboarding wajib untuk user baru
- ✅ Tracking makanan, minuman, aktivitas, kalori
- ✅ Weight logging & history
- ✅ Daily summary otomatis
- ✅ Personalized response berdasarkan profile & progress

## Database Structure

Database SQLite tersimpan di `data/diet-tracker.db` dengan 4 tables:

### 1. Users Table
Menyimpan profile user:
- whatsapp_id (primary key)
- name, height, weight, target_weight
- age, gender, activity_level, goal
- tdee, target_calories (dihitung otomatis)
- onboarding_completed flag

### 2. Food Entries Table
Log makanan & minuman:
- whatsapp_id, date, timestamp
- type (food/drink)
- description, calories
- protein, carbs, fats (opsional)

### 3. Activities Table
Log aktivitas olahraga:
- whatsapp_id, date, timestamp
- description, duration (minutes)
- calories_burned

### 4. Weight Logs Table
History berat badan:
- whatsapp_id, date
- weight, notes

## Onboarding Flow (User Baru)

Saat user pertama kali chat, bot akan minta data:

```
Bot: 🌟 Selamat datang di Personal Trainer Diet Coach!
     Aku akan bantu kamu mencapai target diet kamu. 
     Tapi sebelumnya, aku perlu kenalan dulu sama kamu!
     
     Pertama, siapa nama kamu? 😊

User: Rio

Bot: Halo Rio! Tinggi badan kamu berapa cm?

User: 170

Bot: Berat badan kamu sekarang berapa kg?

User: 75

Bot: Target berat badan yang kamu mau berapa kg?

User: 65

Bot: Goal kamu apa nih? Tulis salah satu:
     - "turun" (untuk nurunin berat)
     - "naik" (untuk naikin berat)
     - "maintain" (untuk maintain berat)

User: turun

Bot: Aktivitas fisik kamu sehari-hari gimana? Pilih salah satu:
     - "santai" (jarang gerak, banyak duduk)
     - "ringan" (jalan-jalan, aktivitas ringan)
     - "sedang" (olahraga 3-5x seminggu)
     - "aktif" (olahraga intensif hampir tiap hari)
     - "sangat aktif" (atlet/kerja fisik berat)

User: sedang

Bot: Terakhir, umur kamu berapa tahun? (opsional)

User: 28

Bot: Gender kamu? (cowok/cewek) - opsional

User: cowok

Bot: ✅ Onboarding selesai! Welcome, Rio! 🎉

     📊 Profile kamu:
     • Tinggi: 170cm
     • Berat sekarang: 75kg
     • Target: 65kg
     • Goal: turunin dari 75kg ke 65kg
     • Aktivitas: Sedang (olahraga 3-5x/minggu)

     🔥 Kalori harian kamu:
     • TDEE (maintenance): ~2350 kalori
     • Target diet: ~1850 kalori/hari

     Aku siap bantu kamu! Mulai sekarang kamu bisa:
     📝 Log makanan & minuman
     💪 Log aktivitas olahraga
     ⚖️ Update berat badan
     📊 Lihat progress harian

     Yuk mulai! Ada makan apa hari ini? 😊
```

## TDEE & Target Calories Calculation

Bot otomatis hitung:

**BMR (Basal Metabolic Rate)** - Mifflin-St Jeor Equation:
- Male: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age + 5
- Female: BMR = 10 × weight(kg) + 6.25 × height(cm) - 5 × age - 161

**TDEE (Total Daily Energy Expenditure)**:
- Sedentary: BMR × 1.2
- Light: BMR × 1.375
- Moderate: BMR × 1.55
- Active: BMR × 1.725
- Very Active: BMR × 1.9

**Target Calories**:
- Lose weight: TDEE - 500 (deficit 500 kalori)
- Gain weight: TDEE + 300 (surplus 300 kalori)
- Maintain: TDEE

## Cara Pakai Bot (Setelah Onboarding)

### 1. Log Makanan

User bisa cerita makan apa, AI akan extract & suggest logging:

```
User: Pagi ini sarapan nasi goreng sama teh manis

Bot: Wah nasi goreng nih! 🍳

     Estimasi kalori:
     • Nasi goreng (1 porsi): ~350 kalori
     • Teh manis: ~80 kalori
     Total: ~430 kalori

     Mau aku log ke database? 
     
     Btw protein nya cukup ga nih? Coba tambah telur atau ayam 
     biar kenyang lebih lama 💪
```

### 2. Lihat Progress Harian

```
User: Hari ini gimana?

Bot: 📊 Progress hari ini (2026-08-30):
     
     Total Kalori: 1230/1850 kalori ✅
     • Protein: 45g
     • Carbs: 180g
     • Fats: 35g
     
     Masih ada sisa 620 kalori nih! Makan malam bisa pilih:
     - Protein tinggi (ayam/ikan/telur)
     - Sayur banyak
     - Nasi/karbo secukupnya
     
     Kalorinya pas buat makan enak tanpa guilt! 😋
```

### 3. Log Olahraga

```
User: Tadi jogging 30 menit

Bot: Mantap! 🏃‍♂️💨
     
     Jogging 30 menit burn sekitar 250-300 kalori tergantung 
     pace kamu. Keringatnya deras ga?
     
     Jangan lupa:
     • Minum air cukup
     • Makan protein dalam 1 jam pasca olahraga
     • Stretch biar ga pegel besok
     
     Keep it up! 💪
```

### 4. Update Berat Badan

```
User: Berat badan aku sekarang 73kg

Bot: Nice! Turun 2kg dari awal (75kg) 🎉
     
     Progress: 2kg/10kg target (20% done!)
     
     Kalau konsisten kayak gini, estimasi target tercapai 
     dalam 4-5 bulan. Slow and steady wins the race!
     
     Tips maintain momentum:
     • Tetap di kalori target (1850/hari)
     • Protein cukup (min 90g/hari)
     • Olahraga 3-5x/minggu
     
     You got this! 💪✨
```

## User Context yang Dikirim ke LLM

Setiap kali user chat, bot inject context ke LLM:

```
USER PROFILE & DAILY CONTEXT

👤 User: Rio
📏 Height: 170cm
⚖️ Current Weight: 75kg
🎯 Target Weight: 65kg
📊 Progress: 10kg lagi
🎯 Goal: Turun berat
🔥 TDEE: 2350 kalori/hari
🎯 Target Kalori: 1850 kalori/hari

📅 TODAY (2026-08-30):
• Total Kalori: 1230/1850 kalori
• Protein: 45g
• Carbs: 180g
• Fats: 35g
• Makanan logged: 3 items
• Aktivitas: 1 activities
• Kalori terbakar: 250 kalori
```

LLM bisa pakai data ini untuk:
- Personalize response
- Estimate kalori makanan yang disebutkan user
- Suggest logging
- Remind target kalori
- Motivasi berdasarkan progress real

## Database Queries

Lihat data user di database:

```bash
# Masuk ke sqlite
sqlite3 data/diet-tracker.db

# Lihat semua user
SELECT whatsapp_id, name, weight, target_weight, goal FROM users;

# Lihat food entries hari ini
SELECT * FROM food_entries 
WHERE date = '2026-08-30' 
ORDER BY timestamp DESC;

# Lihat weight history satu user
SELECT date, weight FROM weight_logs 
WHERE whatsapp_id = '628123456789@c.us' 
ORDER BY date DESC 
LIMIT 10;

# Daily summary
SELECT 
  date,
  SUM(calories) as total_cal,
  COUNT(*) as food_count
FROM food_entries 
WHERE whatsapp_id = '628123456789@c.us'
GROUP BY date
ORDER BY date DESC
LIMIT 7;
```

## Backup Database

Database di `data/diet-tracker.db` - backup secara berkala:

```bash
# Backup
cp data/diet-tracker.db data/diet-tracker-backup-$(date +%Y%m%d).db

# Atau compress
tar -czf diet-tracker-backup-$(date +%Y%m%d).tar.gz data/

# Restore
cp data/diet-tracker-backup-20260830.db data/diet-tracker.db
```

## Limitasi Saat Ini

1. **Log makanan tidak otomatis** - user mention makanan, tapi AI belum auto-log ke DB. AI cuma suggest & estimate. Perlu extend logic untuk parse intent "log this".

2. **No structured commands** - semua via natural language. Bisa tambah command kayak:
   - `/log makan nasi goreng 400 kalori`
   - `/summary` untuk daily summary
   - `/progress` untuk weight history

3. **No reminder/notification** - bot tidak bisa push message ke user (WhatsApp Web limitation). User harus chat first.

4. **Single instance** - satu bot handle semua user. Kalau banyak user simultan, bisa bottleneck.

## Next Features (Future)

1. Auto-parse & log makanan dari chat natural
2. Weekly summary & report
3. Food database Indonesia (tempe, nasi goreng, rendang, dll dengan kalori akurat)
4. Export data to CSV/PDF
5. Foto makanan → AI vision estimate kalori
6. Group chat support (challenge, leaderboard)
7. Integration dengan fitness tracker (Strava, Google Fit)

## Troubleshooting

**Database locked error:**
- Bot crash tanpa graceful shutdown
- Fix: tutup semua koneksi: `pkill -f "node dist/index.js"`

**User stuck di onboarding:**
- Manual reset: delete from database
- `sqlite3 data/diet-tracker.db "DELETE FROM users WHERE whatsapp_id='628xxx@c.us';"`

**Wrong calculation:**
- Check user profile di database
- Recalculate TDEE manual, compare dengan bot

---

Dokumentasi lengkap bot + database ada di README.md & USAGE.md
