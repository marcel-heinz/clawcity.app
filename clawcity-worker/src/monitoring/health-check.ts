import http from 'http';
import { logger } from './logger';

let server: http.Server | null = null;
let lastTickTime = Date.now();

export function updateLastTick() {
  lastTickTime = Date.now();
}

export function startHealthCheck(port: number) {
  server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const staleSec = (Date.now() - lastTickTime) / 1000;
      const healthy = staleSec < 120; // Unhealthy if no tick in 2 minutes

      res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: healthy ? 'ok' : 'unhealthy',
        lastTick: new Date(lastTickTime).toISOString(),
        staleSec: Math.round(staleSec),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info(`Health check server listening on port ${port}`);
  });
}

export function stopHealthCheck() {
  if (server) {
    server.close();
    server = null;
  }
}
