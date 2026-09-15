# WhatsApp Chatbot dengan LLM

Chatbot WhatsApp yang menggunakan LLM API (OpenAI-compatible) dengan konfigurasi agent dari AGENTS.md.

## Fitur

- 🤖 Integrasi dengan LLM API (OpenAI-compatible)
- 💬 Chat history per kontak
- 📝 Konfigurasi agent dari AGENTS.md (hot-reload)
- 🔄 Session persistence (tidak perlu scan QR ulang)
- ⚡ TypeScript untuk type safety

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Konfigurasi

Salin `.env.example` ke `.env` dan sesuaikan:

```bash
cp .env.example .env
```

Edit `.env`:

```env
LLM_API_URL=http://localhost:8080/v1/chat/completions
LLM_API_KEY=your-api-key-here
LLM_MODEL=gpt-3.5-turbo
BOT_NAME=WhatsApp Assistant
MAX_TOKENS=2000
TEMPERATURE=0.7
AGENTS_MD_PATH=./AGENTS.md
```

### 3. Konfigurasi Agent

Edit `AGENTS.md` untuk mengatur behavior bot. File ini akan di-reload otomatis saat diubah.

Contoh:

```markdown
# Customer Support Bot

You are a friendly customer support assistant.

## Personality
- Professional yet warm
- Patient and helpful
- Responds in user's language

## Guidelines
- Keep responses concise for mobile
- Use emojis sparingly
- Escalate complex issues
```

### 4. Jalankan

Development mode (auto-reload):

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

### 5. Scan QR Code

Saat pertama kali jalan, akan muncul QR code di terminal. Scan dengan WhatsApp di hp kamu:

1. Buka WhatsApp
2. Tap Menu (⋮) → Linked Devices
3. Tap "Link a Device"
4. Scan QR code di terminal

Session akan tersimpan di folder `.wwebjs_auth/`, jadi tidak perlu scan ulang.

## Struktur Project

```
whatsapp-chatbot/
├── src/
│   ├── index.ts          # Entry point
│   ├── client.ts         # WhatsApp client + message handler
│   ├── llm.ts            # LLM API integration
│   ├── agents-parser.ts  # AGENTS.md parser
│   ├── config.ts         # Configuration loader
│   └── types.ts          # TypeScript types
├── AGENTS.md             # Agent configuration
├── .env                  # Environment variables
├── .env.example          # Environment template
├── package.json
└── tsconfig.json
```

## Testing LLM Connection

Bot akan mencoba koneksi ke LLM API saat startup. Pastikan:

1. LLM server sudah running
2. `LLM_API_URL` benar
3. `LLM_API_KEY` valid (jika diperlukan)

## Hot-reload AGENTS.md

Kamu bisa edit `AGENTS.md` saat bot sedang berjalan. Perubahan akan langsung diterapkan tanpa restart.

## Chat History

- Setiap chat disimpan terpisah per kontak
- Menyimpan max 20 pesan terakhir (configurable di `client.ts`)
- History direset saat bot restart

## Troubleshooting

### QR Code tidak muncul
- Pastikan terminal cukup lebar
- Coba hapus folder `.wwebjs_auth/` dan scan ulang

### LLM tidak response
- Cek LLM server running: `curl http://localhost:8080/v1/models`
- Cek API key benar di `.env`
- Lihat log error di terminal

### Bot tidak balas pesan
- Cek log di terminal untuk error
- Pastikan pesan bukan dari status/broadcast
- Cek AGENTS.md valid (tidak ada syntax error)

## Production Tips

1. **Persistent Session**: Backup folder `.wwebjs_auth/` agar tidak perlu scan QR ulang
2. **Process Manager**: Gunakan PM2 atau systemd untuk auto-restart
3. **Monitoring**: Log ke file atau monitoring service
4. **Rate Limiting**: Tambahkan rate limit untuk mencegah spam

Contoh dengan PM2:

```bash
npm run build
pm2 start dist/index.js --name whatsapp-bot
pm2 save
pm2 startup
```

## License

MIT
