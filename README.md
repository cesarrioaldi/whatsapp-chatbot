# WhatsApp Diet Coach Bot

Chatbot WhatsApp (personal trainer / diet & nutrition coach) berbasis LLM API (OpenAI-compatible), dengan RAG search dan panel admin.

## Fitur

- 🤖 LLM API (OpenAI-compatible)
- 📝 Behavior bot dikonfigurasi lewat `AGENTS.md` (hot-reload, tanpa restart)
- 💬 Log makanan/aktivitas lewat blok `[ACTION]`, disimpan ke SQLite
- 🔍 RAG search (duckduckgo via `search-bridge.py`, fallback Wikipedia)
- 🖥 Panel admin (Express) untuk cek log & edit `AGENTS.md`
- 🔄 Session persistence (tidak perlu scan QR ulang)
- ⚡ TypeScript

## Setup

```bash
npm install
cp .env.example .env   # lalu isi sesuai konfigurasi kamu
```

Variabel utama di `.env`:

```env
LLM_API_URL=...
LLM_API_KEY=...
LLM_MODEL=...
BOT_NAME=...
MAX_TOKENS=2000
TEMPERATURE=0.7
AGENTS_MD_PATH=./AGENTS.md
DATABASE_PATH=./data/diet-tracker.db
PANEL_PORT=2999
PANEL_PASSWORD=admin
MAX_MESSAGE_LENGTH=10000
```

## Jalankan

```bash
./start.sh        # build + auto-start search bridge + npm start
```

Atau manual:

```bash
npm run dev       # development (auto-reload)
npm run build && npm start   # production
```

Saat pertama kali jalan, scan QR code yang muncul (WhatsApp → Linked Devices → Link a Device). Session tersimpan di `.wwebjs_auth/`.

## Struktur

```
src/
├── index.ts          # entry point
├── client.ts         # WhatsApp client + message handler
├── llm.ts            # LLM API integration
├── agents-parser.ts  # AGENTS.md parser & watcher
├── config.ts         # config loader (+ util tanggal WIB)
├── database.ts       # SQLite (better-sqlite3)
├── onboarding.ts     # onboarding flow
├── panel.ts          # admin panel (Express)
├── searcher.ts       # RAG search
├── search-bridge.ts  # client ke search-bridge.py
└── types.ts          # TypeScript types
```

## RAG Search

`search-bridge.py` (port 32229) dipakai buat search duckduckgo. Di `start.sh` bridge di-start otomatis. Kalau bridge mati, `searcher.ts` fallback ke Wikipedia (ID/EN).

## Panel Admin

Default di port `2999` (lihat `PANEL_PORT`). Buat lihat log dan edit `AGENTS.md` dari browser.

## Troubleshooting

- **QR tidak muncul** — pastikan terminal cukup lebar; hapus `.wwebjs_auth/` lalu scan ulang.
- **LLM tidak balas** — cek `LLM_API_URL` benar & server LLM jalan.
- **RAG tidak jalan** — cek bridge: `curl "http://localhost:32229/?q=test"`.

## License

MIT
