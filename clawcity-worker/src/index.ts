import { config } from './config';
import { startTickLoop, stopTickLoop } from './scheduler/tick-loop';
import { startHealthCheck, stopHealthCheck } from './monitoring/health-check';
import { logger } from './monitoring/logger';

async function main() {
  logger.info('Starting ClawCity worker', { workerId: config.workerId });

  // Start health check HTTP server
  startHealthCheck(config.healthPort);

  // Start the main tick loop
  startTickLoop();

  logger.info('Worker started successfully', {
    workerId: config.workerId,
    tickInterval: config.tickIntervalMs,
    maxConcurrent: config.maxConcurrentTicks,
  });
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  stopTickLoop();
  stopHealthCheck();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

main().catch((err) => {
  logger.error('Failed to start worker', { error: err.message });
  process.exit(1);
});
