import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { LogBox, Platform, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import Purchases from "react-native-purchases";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { registerForPush } from "@/src/lib/push";
import { initializeRevenueCat, SubscriptionProvider, rcEnabled } from "@/src/lib/revenuecat";
import { colors } from "@/src/lib/theme";

const queryClient = new QueryClient();

try {
  initializeRevenueCat();
} catch (err) {
  console.warn("RevenueCat unavailable:", err);
}

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Push notifications — foreground display behavior (module scope, native only)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android channel must exist before any push arrives (module scope)
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

function AuthGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const rcIdentityRef = useRef<string | null>(null);

  // Bind RevenueCat identity to our backend user id on every auth path
  useEffect(() => {
    if (!rcEnabled) return;
    (async () => {
      try {
        if (user?.user_id && rcIdentityRef.current !== user.user_id) {
          const { customerInfo } = await Purchases.logIn(user.user_id);
          rcIdentityRef.current = user.user_id;
          queryClient.setQueryData(["revenuecat", "customer-info"], customerInfo);
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
          console.log("[RevenueCat] identity bound:", customerInfo.originalAppUserId);
        } else if (!user?.user_id && rcIdentityRef.current) {
          await Purchases.logOut();
          rcIdentityRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["revenuecat"] });
        }
      } catch (e) {
        console.warn("[RevenueCat] identity error:", e);
      }
    })();
  }, [user?.user_id, queryClient]);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "login";
    if (!user && !inAuth) router.replace("/login");
    else if (user && inAuth) router.replace("/(tabs)/garden");
  }, [user, loading, segments, router]);

  // Register device push token on login / every app open
  useEffect(() => {
    if (user) registerForPush(user.user_id);
  }, [user]);

  // Push tap handlers + denied-permission nudge
  useEffect(() => {
    if (Platform.OS === "web") return;

    const openTarget = (data: Record<string, any>) => {
      const url = data?.deeplink || data?.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) Linking.openURL(url);
      else router.push(url);
    };

    // Warm tap — notification tapped while app is open/backgrounded
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      openTarget(response.notification.request.content.data || {});
    });

    // Cold-start tap — app was killed when the notification was tapped
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openTarget(response.notification.request.content.data || {});
    });

    // Weekly nudge if permission is permanently denied
    (async () => {
      try {
        const { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== "denied" || canAskAgain) return;
        const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (lastNudge && Date.now() - Number(lastNudge) <= oneWeek) return;
        Alert.alert(
          "Stay on your streak 🔥",
          "Turn on notifications so we can warn you before your streak breaks and your tree dies.",
          [
            {
              text: "Later",
              style: "cancel",
              onPress: () => AsyncStorage.setItem("pushNudgeAt", String(Date.now())),
            },
            {
              text: "Open Settings",
              onPress: async () => {
                await AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
                Linking.openSettings();
              },
            },
          ],
        );
      } catch {}
    })();

    return () => {
      tapSub.remove();
    };
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SubscriptionProvider>
              <AuthGate />
            </SubscriptionProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
