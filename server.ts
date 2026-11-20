import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8001);
const BACKEND_TARGET = `http://127.0.0.1:${BACKEND_PORT}`;

let backendUp = false;
let backendProc: ChildProcess | null = null;
let readyPromise: Promise<boolean> | null = null;
let shuttingDown = false;
let respawnCount = 0;

async function isBackendUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_TARGET}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function bootstrapPythonVenv(backendDir: string, pythonBin: string): boolean {
  if (fs.existsSync(pythonBin)) return true;
  console.log('[server] backend/.venv missing; bootstrapping Python environment...');
  const res = spawnSync(
    'sh',
    [
      '-c',
      '(command -v uv >/dev/null 2>&1 || [ -x "$HOME/.local/bin/uv" ] || curl -LsSf https://astral.sh/uv/install.sh | sh) && ' +
        'UV_BIN="$(command -v uv || echo "$HOME/.local/bin/uv")" && ' +
        '"$UV_BIN" venv .venv --python 3.11 && ' +
        '"$UV_BIN" pip install --python .venv/bin/python -r requirements.txt',
    ],
    { cwd: backendDir, stdio: 'inherit' }
  );
  return res.status === 0 && fs.existsSync(pythonBin);
}

function startPythonBackend(): ChildProcess | null {
  const backendDir = path.join(__dirname, 'backend');
  const pythonBin = path.join(backendDir, '.venv', 'bin', 'uvicorn');

  if (!fs.existsSync(pythonBin)) {
    const bootstrapped = bootstrapPythonVenv(backendDir, pythonBin);
    if (!bootstrapped) {
      console.warn(`[server] Missing FastAPI uvicorn binary at ${pythonBin}; /api proxy will wait for external backend on ${BACKEND_TARGET}.`);
      return null;
    }
  }

  const child = spawn(
    pythonBin,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.on('error', (err) => {
    console.error('[fastapi] Failed to start backend process:', err);
    backendUp = false;
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[fastapi] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[fastapi] ${chunk}`);
  });

  child.on('exit', (code) => {
    console.log(`[fastapi] process exited with code ${code}`);
    backendUp = false;
    backendProc = null;
    if (!shuttingDown && respawnCount < 5) {
      respawnCount += 1;
      setTimeout(() => {
        if (!shuttingDown && !backendProc) {
          void ensureBackendReady(20000);
        }
      }, 1000);
    }
  });

  return child;
}

async function ensureBackendReady(timeoutMs = 20000): Promise<boolean> {
  if (backendUp && (await isBackendUp())) {
    return true;
  }
  backendUp = false;
  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = (async () => {
    if (await isBackendUp()) {
      backendUp = true;
      return true;
    }
    if (!backendProc) {
      backendProc = startPythonBackend();
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await isBackendUp()) {
        backendUp = true;
        console.log(`[chargekaro] FastAPI backend ready on ${BACKEND_TARGET}`);
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.warn('[server] Backend health check timed out; requests will retry via proxy.');
    return false;
  })().finally(() => {
    readyPromise = null;
  });

  return readyPromise;
}

async function main() {
  const app = express();
  const server = http.createServer(app);

  // Wait briefly for FastAPI boot if a request arrives in the first few seconds
  app.use('/api', async (_req, _res, next) => {
    if (!backendUp) {
      await ensureBackendReady(20000);
    }
    next();
  });

  const apiProxy = createProxyMiddleware({
    target: BACKEND_TARGET,
    changeOrigin: true,
    xfwd: true,
    pathFilter: '/api',
    on: {
      error: (_err, _req, res) => {
        backendUp = false;
        if (res instanceof http.ServerResponse && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'Backend is starting up. Please retry in a moment.' }));
        }
      },
    },
  });

  const wsProxy = createProxyMiddleware({
    target: BACKEND_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    pathFilter: '/ws',
    on: {
      error: () => {
        // Ignore transient WS proxy errors during startup/reconnect
      },
    },
  });

  app.use(apiProxy);
  app.use(wsProxy);

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
      socket.on('error', () => {});
      void ensureBackendReady(15000).then((ok) => {
        if (ok && !socket.destroyed) {
          wsProxy.upgrade(req, socket as never, head);
        } else if (!socket.destroyed) {
          socket.destroy();
        }
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[chargekaro] Unified server running at http://localhost:${PORT}`);
    void ensureBackendReady(20000);
  });

  const shutdown = () => {
    shuttingDown = true;
    if (backendProc && !backendProc.killed) {
      backendProc.kill('SIGTERM');
    }
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
