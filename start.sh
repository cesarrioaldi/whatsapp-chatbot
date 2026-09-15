#!/bin/bash
# Quick start script untuk WhatsApp Chatbot

echo "╔═══════════════════════════════════════╗"
echo "║  WhatsApp Chatbot - Quick Start       ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "✗ File .env tidak ditemukan!"
    echo "  Salin dari .env.example:"
    echo "  cp .env.example .env"
    echo ""
    echo "  Lalu edit .env dan isi:"
    echo "  - LLM_API_URL (endpoint LLM kamu)"
    echo "  - LLM_API_KEY (API key jika perlu)"
    echo "  - LLM_MODEL (nama model)"
    exit 1
fi

# Check if dist exists
if [ ! -d dist ]; then
    echo "⚙ Building project..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "✗ Build gagal!"
        exit 1
    fi
    echo "✓ Build berhasil"
    echo ""
fi

echo "🚀 Starting WhatsApp Bot..."

# Start search bridge (Hermes ddgs library) if not already running
BRIDGE_PID=$(ps aux | grep "search-bridge.py" | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$BRIDGE_PID" ]; then
    echo "✓ Search bridge already running (PID $BRIDGE_PID)"
else
    echo "🌐 Starting search bridge on port 32229..."
    nohup /home/xixi/.hermes/hermes-agent/venv/bin/python /home/xixi/whatsapp-chatbot/search-bridge.py 32229 >> /home/xixi/whatsapp-chatbot/data/search-bridge.log 2>&1 &
    sleep 2
    if curl -s -o /dev/null "http://localhost:32229/?q=test"; then
        echo "✓ Search bridge running"
    else
        echo "⚠ Search bridge failed to start — RAG akan pakai Wikipedia fallback"
    fi
fi
echo ""
echo "CATATAN:"
echo "- Scan QR code yang muncul dengan WhatsApp kamu"
echo "- Session akan tersimpan, tidak perlu scan ulang"
echo "- Edit AGENTS.md untuk ubah behavior bot (auto-reload)"
echo "- Ctrl+C untuk stop"
echo ""
echo "═══════════════════════════════════════"
echo ""

npm start
