/**
 * ジョブ実行ログユーティリティ
 */
export function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data !== undefined && { data }),
  };
  
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

export function logInfo(message: string, data?: unknown) {
  log('info', message, data);
}

export function logWarn(message: string, data?: unknown) {
  log('warn', message, data);
}

export function logError(message: string, data?: unknown) {
  log('error', message, data);
}
