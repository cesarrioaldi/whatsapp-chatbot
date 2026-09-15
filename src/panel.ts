import express from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { config, getTodayWIB, getNowWIB } from './config';
import { WhatsAppBot } from './client';

// ---------------- Log bus (captures console -> ring buffer + SSE) ----------------

interface LogEntry {
  ts: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

const MAX_BUFFER = 300;
const logBuffer: LogEntry[] = [];
const logSubscribers = new Set<(entry: LogEntry) => void>();

function pushLog(level: LogEntry['level'], args: unknown[]): void {
  const message = args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ');
  const entry: LogEntry = { ts: getNowWIB(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
  for (const cb of logSubscribers) {
    try {
      cb(entry);
    } catch (e) {
      // subscriber died
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function hookConsole(): void {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    pushLog('log', args);
    origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushLog('warn', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    pushLog('error', args);
    origError(...args);
  };
}

// ---------------- .env helpers ----------------

function getEnvFilePath(): string {
  return path.join(process.cwd(), '.env');
}

function updateEnvFile(patch: Record<string, string>): void {
  const envPath = getEnvFilePath();
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  for (const [key, value] of Object.entries(patch)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += (content.endsWith('\n') ? '' : '\n') + line + '\n';
    }
  }

  fs.writeFileSync(envPath, content);
}

// ---------------- Panel server ----------------

export class PanelServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private bot: WhatsAppBot;
  private port: number;

  constructor(bot: WhatsAppBot) {
    this.bot = bot;
    this.port = config.panelPort;
    this.app = express();
    this.app.use(express.json({ limit: '5mb' }));
    hookConsole();
    this.setupRoutes();
  }

  private isAuthorized(req: express.Request): boolean {
    const pw = req.header('x-panel-password');
    return pw === config.panelPassword;
  }

  private setupRoutes(): void {
    // Static frontend
    const publicDir = path.join(process.cwd(), 'public');
    this.app.use(express.static(publicDir));

    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });

    // Auth middleware for /api
    this.app.use('/api', (req, res, next) => {
      if (!this.isAuthorized(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });

    // ---- Dashboard stats ----
    this.app.get('/api/stats', (_req, res) => {
      const stats = this.bot.getDb().getStats();
      const today = getTodayWIB();
      // Count today's food/activity across all users
      const allFood = this.bot.getDb().getAllFoodEntries();
      const allActivity = this.bot.getDb().getAllActivities();
      const todayFood = allFood.filter((f) => f.date === today).length;
      const todayActivity = allActivity.filter((a) => a.date === today).length;

      res.json({
        ...stats,
        todayFood,
        todayActivity,
        messageCount: this.bot.getMessageCount(),
        activeChats: this.bot.getChatHistoryCount(),
        chatHistorySize: this.bot.getChatHistorySize(),
        ready: this.bot.isClientReady(),
        botInfo: this.bot.getBotInfo(),
        llmUrl: this.bot.getLlm().getApiUrl(),
        llmModel: this.bot.getLlm().getModel(),
        agentsChars: this.bot.getAgentsConfig().rawContent.length,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    });

    // ---- Users ----
    this.app.get('/api/users', (_req, res) => {
      const users = this.bot.getDb().getAllUsers();
      res.json({ users });
    });

    this.app.post('/api/users/:id/reset', (req, res) => {
      const id = req.params.id as string;
      const profile = this.bot.getDb().getUserProfile(id);
      if (!profile) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      this.bot.resetUserOnboarding(id);
      res.json({ ok: true, message: `Onboarding reset for ${profile.name}` });
    });

    this.app.post('/api/users/:id/delete', (req, res) => {
      const id = req.params.id as string;
      const profile = this.bot.getDb().getUserProfile(id);
      this.bot.deleteUser(id);
      res.json({ ok: true, message: `Deleted ${profile?.name || id}` });
    });

    this.app.put('/api/users/:id', (req, res) => {
      const id = req.params.id as string;
      const updated = this.bot.getDb().updateUser(id, req.body || {});
      if (!updated) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ ok: true, message: `User updated: ${updated.name}`, user: updated });
    });

    // ---- Data viewer ----
    // Build a map of whatsappId -> name so entries show user name not raw ID
    const userMap = (): Record<string, string> => {
      const map: Record<string, string> = {};
      for (const u of this.bot.getDb().getAllUsers()) {
        map[u.whatsappId] = u.name;
      }
      return map;
    };
    const withUserName = (entries: any[]): any[] => {
      const map = userMap();
      return entries.map((e) => ({ ...e, userName: map[e.whatsappId] || e.whatsappId }));
    };

    this.app.get('/api/data/food', (req, res) => {
      const userId = (req.query.userId as string) || undefined;
      const date = (req.query.date as string) || undefined;
      res.json({ entries: withUserName(this.bot.getDb().getAllFoodEntries(userId, date)) });
    });

    this.app.get('/api/data/activities', (req, res) => {
      const userId = (req.query.userId as string) || undefined;
      const date = (req.query.date as string) || undefined;
      res.json({ entries: withUserName(this.bot.getDb().getAllActivities(userId, date)) });
    });

    this.app.get('/api/data/weight', (req, res) => {
      const userId = (req.query.userId as string) || undefined;
      res.json({ entries: withUserName(this.bot.getDb().getAllWeightLogs(userId)) });
    });

    // Delete individual entries
    this.app.delete('/api/data/food/:id', (req, res) => {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      this.bot.getDb().deleteFoodEntry(id);
      res.json({ ok: true, message: `Food entry ${id} deleted` });
    });

    this.app.delete('/api/data/activities/:id', (req, res) => {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      this.bot.getDb().deleteActivity(id);
      res.json({ ok: true, message: `Activity ${id} deleted` });
    });

    this.app.delete('/api/data/weight/:id', (req, res) => {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      this.bot.getDb().deleteWeightLog(id);
      res.json({ ok: true, message: `Weight log ${id} deleted` });
    });

    // ---- AGENTS.md editor ----
    this.app.get('/api/agents', (_req, res) => {
      const content = fs.readFileSync(config.agentsMdPath, 'utf8');
      res.json({ content, path: config.agentsMdPath, chars: content.length });
    });

    this.app.put('/api/agents', (req, res) => {
      const content = (req.body?.content as string) || '';
      if (!content) {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      fs.writeFileSync(config.agentsMdPath, content, 'utf8');
      this.bot.reloadAgentsConfig();
      res.json({ ok: true, message: 'AGENTS.md saved & reloaded', chars: content.length });
    });

    // ---- Settings ----
    this.app.get('/api/settings', (_req, res) => {
      res.json({
        llmApiUrl: config.llmApiUrl,
        llmModel: config.llmModel,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        maxMessageLength: config.maxMessageLength,
        botName: config.botName,
        agentsMdPath: config.agentsMdPath,
        databasePath: config.databasePath,
        panelPort: config.panelPort,
      });
    });

    this.app.put('/api/settings', (req, res) => {
      const body = req.body || {};
      const changes: Record<string, string> = {};
      const apply: (keyof typeof config)[] = [];

      if (typeof body.llmApiUrl === 'string' && body.llmApiUrl.trim()) {
        config.llmApiUrl = body.llmApiUrl.trim();
        changes.LLM_API_URL = config.llmApiUrl;
        apply.push('llmApiUrl');
      }
      if (typeof body.llmModel === 'string' && body.llmModel.trim()) {
        config.llmModel = body.llmModel.trim();
        changes.LLM_MODEL = config.llmModel;
        apply.push('llmModel');
      }
      if (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2) {
        config.temperature = body.temperature;
        changes.TEMPERATURE = String(config.temperature);
        apply.push('temperature');
      }
      if (typeof body.maxTokens === 'number' && body.maxTokens > 0) {
        config.maxTokens = Math.floor(body.maxTokens);
        changes.MAX_TOKENS = String(config.maxTokens);
        apply.push('maxTokens');
      }
      if (typeof body.maxMessageLength === 'number' && body.maxMessageLength > 0) {
        config.maxMessageLength = Math.floor(body.maxMessageLength);
        changes.MAX_MESSAGE_LENGTH = String(config.maxMessageLength);
      }
      if (typeof body.botName === 'string' && body.botName.trim()) {
        config.botName = body.botName.trim();
        changes.BOT_NAME = config.botName;
      }

      updateEnvFile(changes);
      if (apply.length > 0) {
        this.bot.applyLlmConfig();
      }
      res.json({ ok: true, message: 'Settings updated & saved to .env' });
    });

    // ---- LLM test ----
    this.app.post('/api/llm/test', async (_req, res) => {
      try {
        const ok = await this.bot.getLlm().testConnection();
        res.json({ ok, message: ok ? 'LLM connection OK' : 'LLM connection FAILED' });
      } catch (e) {
        res.json({ ok: false, message: String(e) });
      }
    });

    this.app.post('/api/restart', (_req, res) => {
      res.json({ ok: true, message: 'Restarting bot...' });
      console.log('♻️ Restart requested from panel');

      // Give the response a moment to flush before killing this process
      setTimeout(() => {
        // Spawn a brand-new detached instance of the bot
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['dist/index.js'], {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          stdio: 'inherit',
        });
        child.unref();

        // Kill this (old) process after the new one has a chance to start
        setTimeout(() => {
          console.log('🛑 Killing old process, new instance taking over...');
          process.exit(0);
        }, 1500);
      }, 300);
    });

    // ---- Logs ----
    this.app.get('/api/logs', (_req, res) => {
      res.json({ logs: logBuffer });
    });

    this.app.get('/api/logs/stream', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');

      const send = (entry: LogEntry) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      };

      // Send initial buffer
      for (const entry of logBuffer) {
        send(entry);
      }

      logSubscribers.add(send);
      req.on('close', () => {
        logSubscribers.delete(send);
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tryListen = (attempt: number = 0): void => {
        this.server = this.app.listen(this.port, () => {
          console.log(`🌐 Admin Panel running at http://localhost:${this.port}`);
          console.log(`   Password: ${config.panelPassword}`);
          resolve();
        });
        this.server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE' && attempt < 10) {
            console.log(`⚠️ Port ${this.port} busy, retrying in 1s (attempt ${attempt + 1}/10)`);
            setTimeout(() => tryListen(attempt + 1), 1000);
            return;
          }
          console.error(`✗ Panel failed to start on port ${this.port}:`, err.message);
          reject(err);
        });
      };
      tryListen(0);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}
