# WhatsApp Diet Coach Bot

Bot WhatsApp (personal trainer / diet & nutrition coach) berbasis LLM OpenAI-compatible,
dengan RAG search (DuckDuckGo via bridge + fallback Wikipedia), logging makanan/aktivitas
ke SQLite, dan panel admin Express. Bahasa Indonesia (WIB/UTC+7). TypeScript (CommonJS).

## Dev environment

Node 20+, npm. `npm install` lalu `cp .env.example .env` dan isi `LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL`.
Sumber `src/*.ts`; build menghasilkan `dist/*.js` (rootDir=src, outDir=dist). `.env`, `data/`,
`.wwebjs_auth/`, `.wwebjs_cache/` bersifat lokal — jangan commit.

## Build & run

```
npm run build      # tsc (compile check — satu-satunya verifikasi yang ada)
npm run dev        # tsx watch src/index.ts (development, auto-reload)
npm start          # node dist/index.js (butuh `npm run build` dulu)
./start.sh         # build + auto-start search bridge + npm start (produksi)
```

Tidak ada test suite atau linter di repo ini. `npm run build` adalah gate kebenaran.

## Arsitektur (src/)

- `index.ts` — entry point; start bot lalu panel.
- `client.ts` — WhatsApp client (whatsapp-web.js) + handler pesan + RAG loop + parsing blok kontrol.
- `llm.ts` — klien LLM (axios, OpenAI-compatible).
- `agents-parser.ts` — muat & watch file prompt bot (default `./AGENTS.md`; repo ini pakai `./BOT_PROMPT.md` via `AGENTS_MD_PATH`).
- `config.ts` — loader `.env` + util tanggal WIB (`getTodayWIB`, `getNowWIB`, `getYesterdayWIB`).
- `database.ts` — SQLite via better-sqlite3; skema & migrasi inline (`initTables`).
- `onboarding.ts` — alur onboarding multi-langkah.
- `panel.ts` — admin panel Express (log ring buffer + SSE + CRUD + editor prompt).
- `searcher.ts` / `search-bridge.ts` — RAG: bridge Python `ddgs` (port 32229), fallback Wikipedia ID→EN.

## Prompt bot vs instruksi agent

- `BOT_PROMPT.md` = **prompt sistem bot** (persona diet coach). Bot memuat isinya verbatim
  sebagai system prompt via `AGENTS_MD_PATH` (di `.env` = `./BOT_PROMPT.md`), hot-reload
  (fs.watch) dan bisa diedit dari panel admin. Jangan isi dengan instruksi build/coding.
- `AGENTS.md` (file ini) = instruksi untuk coding-agent (Hermes memprioritaskan `.hermes.md` > `AGENTS.md`).

## Blok kontrol LLM (diparse dari respons model)

Bot meminta model mengembalikan blok terstruktur yang diparse & dibuang dari teks balasan (`client.ts`):

- `[ACTION]{json}[/ACTION]` — log makanan/aktivitas ke DB (`type`=food|activity; food pakai `kind`=food|drink).
- `[SEARCH]{"query":"..."}[/SEARCH]` — pemicu pencarian web (max 2 ronde RAG).
- `[QUERY]{"date":"YYYY-MM-DD"}[/QUERY]` — minta data historis DB untuk tanggal tertentu.

## Konvensi

- DB memakai kolom `snake_case`; objek TS/JSON memakai `camelCase` — mapping manual di `database.ts`.
- Tanggal disimpan `YYYY-MM-DD` dalam WIB, bukan UTC. Selalu pakai `getTodayWIB()`/`getNowWIB()`
  dari `config.ts` — jangan `new Date().toISOString()` (geser zona waktu).
- Duplikat log dicegah via `foodEntryExists`/`activityExists` (case-insensitive, per hari).

## Pitfalls

- `.env` HARUS punya `AGENTS_MD_PATH` (di `.env.example` = `./BOT_PROMPT.md`); tanpa file itu bot
  jalan pakai prompt default "helpful assistant".
- Port `32229` dipakai search bridge (Python `ddgs`, dijalankan dari venv Hermes
  `/home/xixi/.hermes/hermes-agent/venv/bin/python`). Bridge dimulai otomatis oleh
  `search-bridge.ts` saat boot. Kalau down, RAG fallback ke Wikipedia.
- Port panel default `2999` (config `PANEL_PORT`), auth lewat header `x-panel-password` (bukan basic auth).
- Chromium wajib ada; `findChrome()` di `client.ts` mengecek path sistem. Tanpa Chrome bot tidak connect.
- QR muncul di terminal (bukan file) — butuh terminal lebar; session tersimpan di `.wwebjs_auth/`.
  Hapus `.wwebjs_auth/` untuk paksa scan ulang.
- Skema DB migrasi inline di `database.ts` (bukan file migrasi terpisah). Jangan hand-edit `data/*.db`.
- `parseActionBlocks` WAJIB membuang blok kontrol mentah dari balasan — kalau regex-nya diubah,
  pastikan blok tidak pernah bocor ke user.
