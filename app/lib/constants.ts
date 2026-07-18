/**
 * Application constants
 * Centralized values used throughout the app
 */

// Animation & Timing
export const ANIMATION = {
  FADE_IN: 200,
  FADE_OUT: 150,
  SLIDE_IN: 300,
  COMBO_WINDOW: 500,
  FLOATER_DURATION: 2000,
  ATTACK_COOLDOWN: 100,
} as const;

// UI Breakpoints
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  XXL: 1536,
} as const;

// Z-Index layers
export const Z_INDEX = {
  FLOATER: 10,
  MODAL: 50,
  DROPDOWN: 20,
  NOTIFICATION: 40,
  TOOLTIP: 30,
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  ANONYMOUS_ID: "clickHunter_anonymousId",
  PLAYER_NAME: "clickHunter_playerName",
  DISCOVERED_SPOTS: "clickHunter_discoveredSpots",
  SETTINGS: "clickHunter_settings",
  THEME: "clickHunter_theme",
} as const;

// Game Balance
export const GAME_BALANCE = {
  MIN_HP: 1,
  MAX_HP: 999999,
  MIN_DAMAGE: 1,
  BASE_ATTACK_SPEED: 1,
  MAX_ATTACK_SPEED: 10,
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  PLAYERS: "/api/players",
  UPGRADES: "/api/upgrades",
  FIGHTS: "/api/fights",
  LEADERBOARD: "/api/leaderboard",
} as const;

// Feature Flags (can be overridden by config)
export const FEATURES = {
  HIDDEN_SPOTS_ENABLED: true,
  AUTO_ATTACK_ENABLED: true,
  AUTO_START_FIGHT_ENABLED: true,
  REBIRTH_ENABLED: true,
  LEADERBOARD_ENABLED: true,
} as const;

// Color Palette (for consistent styling)
export const COLORS = {
  PRIMARY: "#3b82f6",
  SECONDARY: "#8b5cf6",
  SUCCESS: "#10b981",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  INFO: "#06b6d4",
  DARK_BG: "#1e293b",
  DARK_SURFACE: "#334155",
  DARK_BORDER: "#475569",
} as const;

// Validation Rules
export const VALIDATION = {
  MIN_NAME_LENGTH: 1,
  MAX_NAME_LENGTH: 32,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: "Failed to connect. Please check your connection.",
  UNKNOWN_ERROR: "An unknown error occurred. Please try again.",
  INVALID_INPUT: "Invalid input. Please check your data.",
  UNAUTHORIZED: "You are not authorized to perform this action.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  ITEM_PURCHASED: "Item purchased successfully!",
  UPGRADE_APPLIED: "Upgrade applied!",
  REBIRTH_SUCCESSFUL: "Rebirth successful! You've been reborn.",
  SETTINGS_SAVED: "Settings saved successfully.",
} as const;
