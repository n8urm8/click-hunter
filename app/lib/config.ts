/**
 * Application-wide runtime configuration
 * Manages feature flags, settings, and environment-specific behavior
 */

export interface AppConfig {
  app: {
    title: string;
    version: string;
    environment: "development" | "production" | "test";
  };
  debug: {
    enabled: boolean;
    logNetwork: boolean;
    logState: boolean;
  };
  features: {
    autoSave: boolean;
    analytics: boolean;
    errorReporting: boolean;
  };
  performance: {
    cacheEnabled: boolean;
    compressionEnabled: boolean;
  };
}

const isDev = import.meta.env.DEV;
const isProd = import.meta.env.PROD;

export const config: AppConfig = {
  app: {
    title: import.meta.env.VITE_APP_TITLE || "Click Hunter",
    version: "0.1.0",
    environment: isProd ? "production" : isDev ? "development" : "test",
  },
  debug: {
    enabled: import.meta.env.VITE_DEBUG_MODE === "true" || isDev,
    logNetwork: isDev,
    logState: isDev,
  },
  features: {
    autoSave: true,
    analytics: isProd,
    errorReporting: isProd,
  },
  performance: {
    cacheEnabled: true,
    compressionEnabled: isProd,
  },
};

/**
 * Feature flag check
 */
export function isFeatureEnabled(feature: keyof AppConfig["features"]): boolean {
  return config.features[feature];
}

/**
 * Debug mode check
 */
export function isDebugMode(): boolean {
  return config.debug.enabled;
}
