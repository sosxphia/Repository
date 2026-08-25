import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { apiFetch } from "./api";

/**
 * Ask permission and register this device's native push token with the backend.
 * Safe to call on every app open — tokens rotate and the backend upserts.
 * No-ops on web and inside Expo Go (push requires a real build).
 */
export async function registerForPush() {
  if (Platform.OS === "web") return;
  if (Constants.appOwnership === "expo") return; // Expo Go doesn't support push
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    await apiFetch("/register-push", {
      method: "POST",
      body: JSON.stringify({
        platform: Platform.OS,
        device_token: String(tokenResp.data),
      }),
    });
  } catch (e) {
    console.log("push register (non-blocking)", e);
  }
}
