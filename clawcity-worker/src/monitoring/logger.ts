export const logger = {
  info(message: string, data?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', message, ...data, ts: new Date().toISOString() }));
  },
  warn(message: string, data?: Record<string, unknown>) {
    console.warn(JSON.stringify({ level: 'warn', message, ...data, ts: new Date().toISOString() }));
  },
  error(message: string, data?: Record<string, unknown>) {
    console.error(JSON.stringify({ level: 'error', message, ...data, ts: new Date().toISOString() }));
  },
  debug(message: string, data?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(JSON.stringify({ level: 'debug', message, ...data, ts: new Date().toISOString() }));
    }
  },
};
