import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';

/**
 * Search bridge management.
 *
 * The RAG searcher calls a local Python bridge (search-bridge.py) that uses the
 * same `ddgs` library as Hermes' web_search. This module ensures the bridge is
 * running when the bot starts — whether started via start.sh, `npm start`, or
 * the panel's /api/restart (which spawns node directly, bypassing start.sh).
 */

const BRIDGE_PORT = 32229;
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}/`;
const PYTHON_BIN = '/home/xixi/.hermes/hermes-agent/venv/bin/python';
const BRIDGE_SCRIPT = path.join(__dirname, '..', 'search-bridge.py');
const LOG_FILE = path.join(__dirname, '..', 'data', 'search-bridge.log');

/** Check whether the bridge HTTP endpoint is up. */
export function isSearchBridgeUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BRIDGE_URL}?q=ping&limit=1`, { timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Start the bridge as a detached background process (survives bot restart). */
function startBridgeProcess(): void {
  try {
    if (!fs.existsSync(PYTHON_BIN) || !fs.existsSync(BRIDGE_SCRIPT)) {
      console.warn('⚠ Search bridge: python/script not found, skipping');
      return;
    }
    // Ensure log dir exists
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const logFd = fs.openSync(LOG_FILE, 'a');
    const child = spawn(PYTHON_BIN, [BRIDGE_SCRIPT, String(BRIDGE_PORT)], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    fs.closeSync(logFd);
    console.log(`🌐 Search bridge starting (PID ${child.pid}) on port ${BRIDGE_PORT}...`);
  } catch (e) {
    console.warn('⚠ Search bridge start failed:', (e as Error).message);
  }
}

/** Ensure the bridge is up; start it if not. Returns true when ready. */
export async function ensureSearchBridge(): Promise<boolean> {
  if (await isSearchBridgeUp()) {
    console.log('✓ Search bridge already running');
    return true;
  }

  console.log('🌐 Search bridge not running, starting...');
  startBridgeProcess();

  // Wait up to ~20s for the bridge to come up (Python + ddgs import takes ~8s)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isSearchBridgeUp()) {
      console.log('✓ Search bridge running on port ' + BRIDGE_PORT);
      return true;
    }
  }

  console.warn('⚠ Search bridge did not start in time — RAG will use Wikipedia fallback');
  return false;
}