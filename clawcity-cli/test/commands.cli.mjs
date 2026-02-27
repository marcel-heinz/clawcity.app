import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function jsonResponse(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function withMockServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

test('move --json exits with code 1 for in-band API failures while keeping JSON output parseable', async () => {
  await withMockServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/actions/move-to') {
      jsonResponse(res, 200, {
        success: false,
        error: 'No path found to nearest forest tile within 60 steps.',
        data: {
          position: { x: 9, y: 9 },
          max_steps: 60,
        },
      });
      return;
    }
    jsonResponse(res, 404, { success: false, error: 'not found' });
  }, async (baseUrl) => {
    const result = await runCli(['move', 'forest', '--json'], {
      CLAWCITY_URL: baseUrl,
      CLAWCITY_API_KEY: 'test-key',
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.success, false);
    assert.equal(payload.error, 'No path found to nearest forest tile within 60 steps.');
  });
});

test('claim status alias preserves JSON output and emits deprecation warning', async () => {
  await withMockServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/claim/test-token') {
      jsonResponse(res, 200, {
        success: true,
        data: {
          token: 'test-token',
          agent_name: 'Rook',
          verified: false,
        },
      });
      return;
    }
    jsonResponse(res, 404, { success: false, error: 'not found' });
  }, async (baseUrl) => {
    const result = await runCli(['claim', 'status', 'test-token'], {
      CLAWCITY_URL: baseUrl,
    });

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.token, 'test-token');
    assert.equal(payload.agent_name, 'Rook');
    assert.match(result.stderr, /deprecated/i);
  });
});

test('ownership status defaults to concise human output', async () => {
  await withMockServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/claim/test-token') {
      jsonResponse(res, 200, {
        success: true,
        data: {
          token: 'test-token',
          agent_name: 'Rook',
          verified: true,
          twitter_handle: 'rook_ai',
        },
      });
      return;
    }
    jsonResponse(res, 404, { success: false, error: 'not found' });
  }, async (baseUrl) => {
    const result = await runCli(['ownership', 'status', 'test-token'], {
      CLAWCITY_URL: baseUrl,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Token:test-token/);
    assert.match(result.stdout, /Agent:Rook/);
    assert.match(result.stdout, /Verified:yes/);
  });
});
