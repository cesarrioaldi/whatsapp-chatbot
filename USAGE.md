# CARA PENGGUNAAN - WhatsApp Chatbot

## 1. Konfigurasi LLM API

Edit file `.env` dan sesuaikan dengan LLM kamu:

```bash
nano .env
```

Isi dengan konfigurasi LLM kamu:

```env
# Ganti dengan endpoint LLM kamu
LLM_API_URL=http://localhost:8080/v1/chat/completions

# API key (kosongkan jika tidak perlu)
LLM_API_KEY=your-api-key-here

# Nama model
LLM_MODEL=gpt-3.5-turbo

# Konfigurasi bot
BOT_NAME=WhatsApp Assistant
MAX_TOKENS=2000
TEMPERATURE=0.7

# Path ke AGENTS.md
AGENTS_MD_PATH=./AGENTS.md
```

## 2. Konfigurasi Agent Behavior

Edit `AGENTS.md` untuk mengatur cara bot berperilaku:

```bash
nano AGENTS.md
```

Format mirip Hermes AGENTS.md. Contoh:

```markdown
# Customer Support Bot

Kamu adalah asisten customer support yang ramah dan profesional.

## Personality

- Ramah dan sabar
- Responsif dan cepat
- Menggunakan bahasa sesuai pelanggan
- Pakai emoji secukupnya 😊

## Guidelines

- Jawaban singkat dan jelas (WhatsApp = mobile)
- Jika pertanyaan kompleks, minta detail lebih lanjut
- Selalu ucapkan terima kasih
- Jangan gunakan markdown formatting (WhatsApp tidak support)

## Capabilities

Kamu bisa:
- Menjawab pertanyaan umum
- Memberikan informasi produk
- Membantu troubleshooting dasar
- Escalate ke human jika diperlukan

## Response Style

- Max 300 kata per pesan
- Gunakan bullet points jika perlu listing
- Hindari jargon teknis
```

File ini akan di-reload otomatis saat kamu edit (tanpa restart bot).

## 3. Jalankan Bot

Cara termudah:

```bash
cd ~/whatsapp-chatbot
./start.sh
```

Atau manual:

```bash
cd ~/whatsapp-chatbot
npm start
```

## 4. Scan QR Code

Saat pertama kali jalan, terminal akan tampilkan QR code.

Scan dengan WhatsApp:
1. Buka WhatsApp di hp
2. Tap menu (3 titik) → Linked Devices
3. Tap "Link a Device"
4. Scan QR code di terminal

Session akan tersimpan di folder `.wwebjs_auth/`, jadi tidak perlu scan ulang setiap kali restart.

## 5. Testing

Kirim pesan ke nomor WhatsApp yang sudah di-link. Bot akan otomatis balas sesuai AGENTS.md kamu.

Log akan muncul di terminal:

```
📨 Message from 6281234567890@c.us:
   "Halo, apa kabar?"

✓ Replied to 6281234567890@c.us
   "Halo! Saya baik, terima kasih. Ada yang bisa saya bantu?"
```

## 6. Edit Agent Behavior (Hot Reload)

Kamu bisa edit `AGENTS.md` saat bot sedang running:

```bash
nano AGENTS.md
```

Save file, dan bot otomatis reload tanpa restart. Akan muncul log:

```
📝 AGENTS.md changed, reloading...
✓ AGENTS.md reloaded
```

## Tips & Troubleshooting

### Bot tidak balas
- Cek LLM server running: `curl http://localhost:8080/v1/models`
- Cek API key di `.env` benar
- Lihat error di terminal

### QR Code tidak muncul
- Pastikan terminal cukup lebar
- Hapus session lama: `rm -rf .wwebjs_auth/` lalu scan ulang

### WhatsApp disconnect
- Session expired, scan QR ulang
- Atau hp tidak punya koneksi internet

### LLM response lambat
- Normal, tergantung kecepatan LLM server kamu
- User akan lihat "typing..." indicator

### Chat history penuh
- Default max 20 pesan per chat
- Edit di `src/client.ts` line 29: `private maxHistoryLength = 20;`
- Rebuild: `npm run build`

## Production Deployment

Untuk production, pakai process manager seperti PM2:

```bash
npm install -g pm2

# Build dulu
npm run build

# Start dengan PM2
pm2 start dist/index.js --name whatsapp-bot

# Save config
pm2 save

# Auto-start on boot
pm2 startup
```

Monitor logs:
```bash
pm2 logs whatsapp-bot
```

Restart bot:
```bash
pm2 restart whatsapp-bot
```

## Backup Session

Session WhatsApp tersimpan di `.wwebjs_auth/`. Backup folder ini agar tidak perlu scan QR ulang:

```bash
tar -czf whatsapp-session-backup.tar.gz .wwebjs_auth/
```

Restore:
```bash
tar -xzf whatsapp-session-backup.tar.gz
```

## Struktur Project

```
whatsapp-chatbot/
├── src/                      # Source code TypeScript
│   ├── index.ts             # Entry point
│   ├── client.ts            # WhatsApp client logic
│   ├── llm.ts               # LLM API integration
│   ├── agents-parser.ts     # AGENTS.md parser & watcher
│   ├── config.ts            # Config loader
│   └── types.ts             # TypeScript types
├── dist/                     # Compiled JavaScript (auto-generated)
├── AGENTS.md                 # Agent behavior config (EDIT INI!)
├── .env                      # Environment variables (EDIT INI!)
├── .env.example             # Template
├── .wwebjs_auth/            # WhatsApp session (auto-generated)
├── start.sh                 # Quick start script
├── package.json
├── tsconfig.json
└── README.md
```

## Fitur

✅ OpenAI-compatible LLM API  
✅ AGENTS.md hot-reload  
✅ Per-chat history (20 pesan terakhir)  
✅ Session persistence (tidak perlu scan QR ulang)  
✅ Typing indicator  
✅ Auto Chrome/Chromium detection  
✅ TypeScript untuk type safety  

## Limitasi

- Unofficial WhatsApp API (bisa di-ban jika spam)
- Tidak support media (gambar/video/audio) - hanya teks
- Tidak support group chat (bisa ditambah sendiri di `client.ts`)
- Chat history direset saat restart (bisa ditambah database)

## Next Steps

1. Test dengan akun WhatsApp kamu
2. Sesuaikan AGENTS.md untuk use case kamu
3. Deploy ke VPS jika mau 24/7
4. Tambah fitur sesuai kebutuhan (database, group chat, media, dll)

Selamat mencoba! 🚀
