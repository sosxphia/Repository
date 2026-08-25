import { Platform } from "react-native";

let detector: { isScreenLocked: () => Promise<boolean> } | null = null;
try {
  // Native module — unavailable on web and in Expo Go
  detector = require("expo-screen-detector").default ?? require("expo-screen-detector");
} catch {
  detector = null;
}

/**
 * True when the device is locked / screen off (iOS: protected data unavailable,
 * Android: keyguard locked). Returns null when we genuinely can't tell.
 */
export async function isScreenLocked(): Promise<boolean | null> {
  if (Platform.OS === "web" || !detector?.isScreenLocked) return null;
  try {
    return await detector.isScreenLocked();
  } catch {
    return null;
  }
}
