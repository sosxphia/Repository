import { Platform } from "react-native";

type Detector = { isScreenLocked: () => Promise<boolean> };

let cached: Detector | null | undefined;

function getDetector(): Detector | null {
  if (cached !== undefined) return cached;
  // Loaded lazily so the screen never fails to render when the native module
  // is missing (Expo Go, web preview).
  try {
    const mod = require("expo-screen-detector");
    cached = (mod?.default ?? mod) as Detector;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * True when the device is locked / screen off (iOS: protected data unavailable,
 * Android: keyguard locked). Returns null when we genuinely can't tell.
 */
export async function isScreenLocked(): Promise<boolean | null> {
  if (Platform.OS === "web") return null;
  const detector = getDetector();
  if (!detector?.isScreenLocked) return null;
  try {
    return await detector.isScreenLocked();
  } catch {
    return null;
  }
}
