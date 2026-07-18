/**
 * Global error logger and reporting utility
 */

import { isDebugMode } from "./config";

export interface ErrorLog {
  timestamp: Date;
  level: "error" | "warn" | "info";
  message: string;
  error?: Error;
  context?: Record<string, any>;
}

const errorLogs: ErrorLog[] = [];
const MAX_LOGS = 50;

function addLog(log: ErrorLog) {
  errorLogs.push(log);
  if (errorLogs.length > MAX_LOGS) {
    errorLogs.shift();
  }
}

/**
 * Log an error with context
 */
export function logError(
  message: string,
  error?: Error,
  context?: Record<string, any>
) {
  const log: ErrorLog = {
    timestamp: new Date(),
    level: "error",
    message,
    error,
    context,
  };

  addLog(log);

  if (isDebugMode()) {
    console.error(`[ERROR] ${message}`, error, context);
  }

  // In production, could send to error reporting service
  if (import.meta.env.PROD) {
    // TODO: Send to error reporting service (e.g., Sentry)
  }
}

/**
 * Log a warning
 */
export function logWarn(
  message: string,
  context?: Record<string, any>
) {
  const log: ErrorLog = {
    timestamp: new Date(),
    level: "warn",
    message,
    context,
  };

  addLog(log);

  if (isDebugMode()) {
    console.warn(`[WARN] ${message}`, context);
  }
}

/**
 * Log info
 */
export function logInfo(
  message: string,
  context?: Record<string, any>
) {
  const log: ErrorLog = {
    timestamp: new Date(),
    level: "info",
    message,
    context,
  };

  addLog(log);

  if (isDebugMode()) {
    console.log(`[INFO] ${message}`, context);
  }
}

/**
 * Get all logged errors
 */
export function getErrorLogs(): ErrorLog[] {
  return [...errorLogs];
}

/**
 * Clear all logs
 */
export function clearErrorLogs() {
  errorLogs.length = 0;
}

/**
 * Export logs for debugging/reporting
 */
export function exportLogs(): string {
  return JSON.stringify(errorLogs, null, 2);
}
