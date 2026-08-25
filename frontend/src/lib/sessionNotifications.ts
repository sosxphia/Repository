import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

const ONGOING_ID = "focus-session-ongoing";
const CHANNEL_ID = "focus-session";

const unsupported = () => Platform.OS === "web" || Constants.appOwnership === "expo";

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Focus sessions",
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: [0],
    enableVibrate: false,
  });
}

function endTimeLabel(endAt: number) {
  return new Date(endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Ongoing "Focusing — ends at 3:42 PM" notification plus a completion alert.
 * No-ops on web and in Expo Go (real notifications need a build).
 */
export async function startSessionNotifications(minutes: number, endAt: number) {
  if (unsupported()) return;
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted && perms.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return;
    } else if (!perms.granted) {
      return;
    }
    await ensureChannel();

    await Notifications.scheduleNotificationAsync({
      identifier: ONGOING_ID,
      content: {
        title: "Focusing 🌱",
        body: `${minutes} min session — ends at ${endTimeLabel(endAt)}`,
        sticky: true,
        autoDismiss: false,
        sound: null,
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null,
    });

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Focus session complete 🎉",
        body: `${minutes} minutes done — come see how much your tree grew.`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(endAt),
      },
    });
  } catch (e) {
    console.log("session notif start (non-blocking)", e);
  }
}

export async function stopSessionNotifications() {
  if (unsupported()) return;
  try {
    await Notifications.dismissNotificationAsync(ONGOING_ID).catch(() => {});
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.log("session notif stop (non-blocking)", e);
  }
}
