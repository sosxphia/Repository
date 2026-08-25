import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Modal, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import type { PurchasesPackage } from "react-native-purchases";
import { useSubscription } from "@/src/lib/revenuecat";
import { colors, spacing, radius } from "@/src/lib/theme";

const PERKS = [
  { icon: "ribbon-outline", text: "Golden PRO badge on the leaderboard" },
  { icon: "sparkles-outline", text: "Early access to new features" },
  { icon: "heart-outline", text: "Support the app and keep it growing" },
];

export default function Paywall() {
  const router = useRouter();
  const { offerings, isSubscribed, isLoading, identityReady, purchase, restore, isPurchasing, isRestoring } =
    useSubscription();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthly: PurchasesPackage | undefined =
    offerings?.current?.availablePackages.find((p) => p.identifier === "$rc_monthly") ||
    offerings?.current?.availablePackages[0];
  const price = monthly?.product.priceString;

  const doPurchase = async () => {
    setConfirmOpen(false);
    setError(null);
    if (!monthly) return;
    try {
      await purchase(monthly);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.userCancelled) return;
      setError(e?.message === "identity_not_ready" ? "Sign-in is still syncing — try again in a moment." : String(e?.message || e));
    }
  };

  const doRestore = async () => {
    setError(null);
    try {
      await restore();
      Haptics.selectionAsync();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="paywall-screen">
      <Pressable onPress={() => router.back()} style={styles.close} hitSlop={10} testID="paywall-close">
        <Ionicons name="close" size={26} color={colors.onSurfaceMuted} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={["#FBBF24", "#F59E0B"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroEmoji}>🌟</Text>
          <Text style={styles.heroTitle}>SproutGoals PRO</Text>
          <Text style={styles.heroSub}>Focus without interruptions</Text>
        </LinearGradient>

        <View style={styles.perks}>
          {PERKS.map((p) => (
            <View key={p.text} style={styles.perkRow}>
              <Ionicons name={p.icon as any} size={20} color={colors.brandPrimary} />
              <Text style={styles.perkText}>{p.text}</Text>
            </View>
          ))}
        </View>

        {isSubscribed ? (
          <View style={styles.activeCard} testID="paywall-active">
            <Text style={styles.activeTitle}>You&apos;re PRO 🎉</Text>
            <Text style={styles.activeText}>Your golden badge is live on the leaderboard.</Text>
          </View>
        ) : isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} size="large" style={{ marginTop: spacing.xl }} />
        ) : !monthly ? (
          <Text style={styles.unavailable} testID="paywall-unavailable">
            Subscription options are unavailable right now. Please try again later.
          </Text>
        ) : (
          <>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setConfirmOpen(true); }}
              style={[styles.buyBtn, (!identityReady || isPurchasing) && { opacity: 0.6 }]}
              disabled={!identityReady || isPurchasing}
              testID="paywall-buy-button"
            >
              {isPurchasing ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buyText}>Go PRO — {price}/month</Text>
              )}
            </Pressable>
            {!identityReady && (
              <Text style={styles.warn}>Syncing your account… hold on a second.</Text>
            )}
            {__DEV__ && (
              <Text style={styles.simulated}>
                Preview mode: purchases here are simulated test-store purchases.
              </Text>
            )}
          </>
        )}

        <Pressable onPress={doRestore} style={styles.restoreBtn} disabled={isRestoring} testID="paywall-restore-button">
          <Text style={styles.restoreText}>{isRestoring ? "Restoring…" : "Restore purchases"}</Text>
        </Pressable>

        {!!error && <Text style={styles.error} testID="paywall-error">{error}</Text>}

        <Text style={styles.fine}>
          Monthly subscription, renews automatically until cancelled. Manage or cancel any time in your{" "}
          {Platform.OS === "ios" ? "App Store" : "Google Play"} account.
        </Text>
      </ScrollView>

      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmCard} testID="paywall-confirm-modal">
            <Text style={styles.confirmTitle}>Start PRO?</Text>
            <Text style={styles.confirmText}>
              {price}/month, cancel any time. Your golden PRO badge appears on the leaderboard right away.
            </Text>
            <Pressable onPress={doPurchase} style={styles.confirmBtn} testID="paywall-confirm-button">
              <Text style={styles.confirmBtnText}>Confirm</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmOpen(false)} style={styles.confirmGhost}>
              <Text style={styles.confirmGhostText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  close: { position: "absolute", top: 52, right: spacing.lg, zIndex: 10, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: { borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", marginTop: spacing.xl },
  heroEmoji: { fontSize: 52 },
  heroTitle: { fontSize: 26, fontWeight: "800", color: "#FFF", marginTop: spacing.sm },
  heroSub: { fontSize: 14, color: "#FFF", opacity: 0.9, marginTop: 4, fontWeight: "600" },
  perks: { marginTop: spacing.xl, gap: spacing.md },
  perkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  perkText: { fontSize: 15, color: colors.onSurface, fontWeight: "600", flex: 1 },
  buyBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 18,
    alignItems: "center", marginTop: spacing.xl, minHeight: 56, justifyContent: "center",
  },
  buyText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  warn: { fontSize: 12, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm },
  simulated: { fontSize: 11, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, fontStyle: "italic" },
  restoreBtn: { paddingVertical: spacing.md, alignItems: "center", minHeight: 44, justifyContent: "center", marginTop: spacing.sm },
  restoreText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  error: { color: colors.error, fontSize: 13, textAlign: "center", marginTop: spacing.sm },
  unavailable: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.xl, lineHeight: 20 },
  activeCard: { backgroundColor: colors.brandTertiary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xl, alignItems: "center" },
  activeTitle: { fontSize: 20, fontWeight: "800", color: colors.onBrandTertiary },
  activeText: { fontSize: 13, color: colors.onBrandTertiary, marginTop: 4, textAlign: "center" },
  fine: { fontSize: 11, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.lg, lineHeight: 16 },
  confirmWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", alignItems: "center" },
  confirmTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  confirmText: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  confirmBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 14,
    paddingHorizontal: spacing.xl, marginTop: spacing.lg, minHeight: 48, justifyContent: "center",
  },
  confirmBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
  confirmGhost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  confirmGhostText: { color: colors.onSurfaceMuted, fontWeight: "700" },
});
