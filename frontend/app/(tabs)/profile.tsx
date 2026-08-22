import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, Share, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";

type Stats = {
  streak_days: number;
  total_focus_minutes: number;
  total_tasks_completed: number;
  total_plants: number;
  bloomed_plants: number;
  total_focus_sessions: number;
  streak_freezes: number;
};

type Recap = {
  week_start: string;
  week_end: string;
  goals_completed: number;
  daily_quests_completed: number;
  plants_bloomed: number;
  plants_grown: number;
  focus_minutes: number;
  focus_sessions: number;
  current_streak: number;
};

export default function Profile() {
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [buying, setBuying] = useState(false);
  const pollingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        apiFetch("/stats"),
        apiFetch("/weekly-recap").catch(() => null),
      ]);
      setStats(s);
      setRecap(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const buyFreeze = async () => {
    if (buying) {
      // Tap again to stop waiting
      pollingRef.current = false;
      setBuying(false);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuying(true);
    try {
      const order = await apiFetch("/paypal/orders", { method: "POST" });
      if (!order?.approve_url) throw new Error("no approval url");
      if (Platform.OS === "web") {
        window.open(order.approve_url, "_blank");
      } else {
        WebBrowser.openBrowserAsync(order.approve_url);
      }
      // Poll for completion (up to 3 minutes)
      pollingRef.current = true;
      const started = Date.now();
      const poll = async () => {
        if (!pollingRef.current) return;
        if (Date.now() - started > 180000) {
          pollingRef.current = false;
          setBuying(false);
          return;
        }
        try {
          const s = await apiFetch(`/paypal/orders/${order.order_id}/status`);
          if (s.status === "completed") {
            pollingRef.current = false;
            setBuying(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            if (Platform.OS !== "web") {
              try { WebBrowser.dismissBrowser(); } catch {}
              Alert.alert("❄️ Streak Freeze added!", "Your tree is protected for one missed day.");
            }
            load();
            return;
          }
          if (s.status === "cancelled") {
            pollingRef.current = false;
            setBuying(false);
            return;
          }
        } catch {}
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 4000);
    } catch (e) {
      console.log("paypal order", e);
      setBuying(false);
      if (Platform.OS !== "web") Alert.alert("Oops", "Could not start PayPal checkout. Please try again.");
    }
  };

  const badges = [
    { key: "streak", label: "3-day Streak", emoji: "🔥", unlocked: (stats?.streak_days ?? 0) >= 3 },
    { key: "focus60", label: "60 Min Focus", emoji: "⏱️", unlocked: (stats?.total_focus_minutes ?? 0) >= 60 },
    { key: "tasks10", label: "10 Goals Done", emoji: "✅", unlocked: (stats?.total_tasks_completed ?? 0) >= 10 },
    { key: "bloom", label: "First Bloom", emoji: "🌸", unlocked: (stats?.bloomed_plants ?? 0) >= 1 },
    { key: "garden5", label: "Garden of 5", emoji: "🌷", unlocked: (stats?.total_plants ?? 0) >= 5 },
    { key: "focus300", label: "5 Hours Focus", emoji: "🧘", unlocked: (stats?.total_focus_minutes ?? 0) >= 300 },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.headerCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }]}>
              <Text style={{ fontSize: 30 }}>🌱</Text>
            </View>
          )}
          <Text style={styles.name}>{user?.name ?? "Gardener"}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} size="large" style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            {recap && (
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setRecapOpen(true); }}
                style={({ pressed }) => [pressed && { transform: [{ scale: 0.98 }] }]}
                testID="weekly-recap-card"
              >
                <LinearGradient
                  colors={["#F59E0B", "#FB923C"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.recapCard}
                >
                  <View style={styles.recapHeader}>
                    <View>
                      <Text style={styles.recapKicker}>THIS WEEK</Text>
                      <Text style={styles.recapTitle}>Weekly Recap 🗓️</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color="#FFF" />
                  </View>
                  <View style={styles.recapMini}>
                    <View style={styles.recapMiniStat}>
                      <Text style={styles.recapMiniValue}>{recap.goals_completed}</Text>
                      <Text style={styles.recapMiniLabel}>goals</Text>
                    </View>
                    <View style={styles.recapMiniStat}>
                      <Text style={styles.recapMiniValue}>{recap.focus_minutes}</Text>
                      <Text style={styles.recapMiniLabel}>focus min</Text>
                    </View>
                    <View style={styles.recapMiniStat}>
                      <Text style={styles.recapMiniValue}>{recap.plants_bloomed}</Text>
                      <Text style={styles.recapMiniLabel}>bloomed</Text>
                    </View>
                  </View>
                </LinearGradient>
              </Pressable>
            )}

            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { backgroundColor: "#FEE2E2" }]}>
                <Text style={styles.statEmoji}>🔥</Text>
                <Text style={styles.statValue}>{stats?.streak_days ?? 0}</Text>
                <Text style={styles.statLabel}>day streak</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#DBEAFE" }]}>
                <Text style={styles.statEmoji}>⏱️</Text>
                <Text style={styles.statValue}>{stats?.total_focus_minutes ?? 0}</Text>
                <Text style={styles.statLabel}>focus min</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#DCFCE7" }]}>
                <Text style={styles.statEmoji}>✅</Text>
                <Text style={styles.statValue}>{stats?.total_tasks_completed ?? 0}</Text>
                <Text style={styles.statLabel}>goals done</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: "#FEF3C7" }]}>
                <Text style={styles.statEmoji}>🌸</Text>
                <Text style={styles.statValue}>{stats?.bloomed_plants ?? 0}</Text>
                <Text style={styles.statLabel}>bloomed</Text>
              </View>
            </View>

            {/* Streak Freeze shop */}
            <LinearGradient
              colors={["#E0F2FE", "#DBEAFE"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.freezeCard}
            >
              <View style={styles.freezeHeader}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={styles.freezeTitle}>❄️ Streak Freeze</Text>
                  <Text style={styles.freezeSub}>Miss a day and your tree dies — a freeze covers one missed day automatically.</Text>
                </View>
                <View style={styles.freezeCount}>
                  <Text style={styles.freezeCountVal} testID="freeze-count">{stats?.streak_freezes ?? 0}</Text>
                  <Text style={styles.freezeCountLabel}>owned</Text>
                </View>
              </View>
              <Pressable
                onPress={buyFreeze}
                style={({ pressed }) => [styles.freezeBtn, pressed && { transform: [{ scale: 0.97 }] }, buying && { backgroundColor: "#64748B" }]}
                testID="buy-freeze-button"
              >
                {buying ? (
                  <>
                    <ActivityIndicator color="#FFF" size="small" />
                    <Text style={styles.freezeBtnText}>Waiting for PayPal… tap to cancel</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="logo-paypal" size={18} color="#FFF" />
                    <Text style={styles.freezeBtnText}>Get one · $1.99 with PayPal</Text>
                  </>
                )}
              </Pressable>
            </LinearGradient>

            <Text style={styles.sectionTitle}>Badges</Text>            <View style={styles.badgeGrid}>
              {badges.map((b) => (
                <View key={b.key} style={[styles.badge, !b.unlocked && styles.badgeLocked]}>
                  <Text style={[styles.badgeEmoji, !b.unlocked && { opacity: 0.3 }]}>{b.emoji}</Text>
                  <Text style={[styles.badgeLabel, !b.unlocked && { color: colors.onSurfaceMuted }]} numberOfLines={2}>
                    {b.label}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); signOut(); }}
          style={({ pressed }) => [styles.logoutBtn, pressed && { transform: [{ scale: 0.97 }] }]}
          testID="logout-button"
        >
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent visible={recapOpen} animationType="slide" onRequestClose={() => setRecapOpen(false)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.backdrop} onPress={() => setRecapOpen(false)} />
          <View style={styles.recapSheet}>
            <View style={styles.grabber} />
            <Text style={styles.recapSheetTitle}>Your week in the garden 🌷</Text>
            <Text style={styles.recapSheetDates}>
              {recap ? `${recap.week_start} → ${recap.week_end}` : ""}
            </Text>

            <View style={styles.recapGrid}>
              <View style={[styles.recapCell, { backgroundColor: "#DCFCE7" }]}>
                <Text style={styles.recapCellEmoji}>✅</Text>
                <Text style={styles.recapCellVal}>{recap?.goals_completed ?? 0}</Text>
                <Text style={styles.recapCellLabel}>goals crushed</Text>
              </View>
              <View style={[styles.recapCell, { backgroundColor: "#FEF3C7" }]}>
                <Text style={styles.recapCellEmoji}>⭐</Text>
                <Text style={styles.recapCellVal}>{recap?.daily_quests_completed ?? 0}</Text>
                <Text style={styles.recapCellLabel}>daily quests</Text>
              </View>
              <View style={[styles.recapCell, { backgroundColor: "#DBEAFE" }]}>
                <Text style={styles.recapCellEmoji}>⏱️</Text>
                <Text style={styles.recapCellVal}>{recap?.focus_minutes ?? 0}</Text>
                <Text style={styles.recapCellLabel}>focus minutes</Text>
              </View>
              <View style={[styles.recapCell, { backgroundColor: "#FCE7F3" }]}>
                <Text style={styles.recapCellEmoji}>🌸</Text>
                <Text style={styles.recapCellVal}>{recap?.plants_bloomed ?? 0}</Text>
                <Text style={styles.recapCellLabel}>plants bloomed</Text>
              </View>
              <View style={[styles.recapCell, { backgroundColor: "#FEE2E2" }]}>
                <Text style={styles.recapCellEmoji}>🔥</Text>
                <Text style={styles.recapCellVal}>{recap?.current_streak ?? 0}</Text>
                <Text style={styles.recapCellLabel}>day streak</Text>
              </View>
              <View style={[styles.recapCell, { backgroundColor: "#E0F2FE" }]}>
                <Text style={styles.recapCellEmoji}>🌱</Text>
                <Text style={styles.recapCellVal}>{recap?.plants_grown ?? 0}</Text>
                <Text style={styles.recapCellLabel}>new sprouts</Text>
              </View>
            </View>

            <Pressable
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                try {
                  await Share.share({
                    message: `This week on SproutGoals 🌷\n✅ ${recap?.goals_completed ?? 0} goals crushed\n⏱️ ${recap?.focus_minutes ?? 0} focus minutes\n🌸 ${recap?.plants_bloomed ?? 0} plants bloomed\n🔥 ${recap?.current_streak ?? 0}-day streak!`,
                  });
                } catch {}
              }}
              style={({ pressed }) => [styles.recapShareBtn, pressed && { transform: [{ scale: 0.96 }] }]}
              testID="recap-share-button"
            >
              <Ionicons name="share-social" size={18} color="#FFF" />
              <Text style={styles.recapShareText}>Share my week</Text>
            </Pressable>
            <Pressable
              onPress={() => setRecapOpen(false)}
              style={styles.recapClose}
              testID="recap-close-button"
            >
              <Text style={styles.recapCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerCard: { alignItems: "center", marginBottom: spacing.xl },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 4, borderColor: colors.brandTertiary },
  name: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md },
  email: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statCard: {
    width: "47.5%", padding: spacing.lg, borderRadius: radius.lg,
    alignItems: "flex-start",
  },
  statEmoji: { fontSize: 28 },
  statValue: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: 4 },
  statLabel: { fontSize: 12, color: colors.onSurfaceMuted, fontWeight: "600" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  freezeCard: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 2, borderColor: "#BFDBFE",
  },
  freezeHeader: { flexDirection: "row", alignItems: "center" },
  freezeTitle: { fontSize: 17, fontWeight: "800", color: "#0C4A6E" },
  freezeSub: { fontSize: 12, color: "#075985", marginTop: 4, lineHeight: 17 },
  freezeCount: {
    backgroundColor: "#FFF", borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    alignItems: "center", borderWidth: 2, borderColor: "#BFDBFE",
  },
  freezeCountVal: { fontSize: 24, fontWeight: "800", color: "#0369A1" },
  freezeCountLabel: { fontSize: 10, fontWeight: "700", color: "#075985" },
  freezeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#0070BA", paddingVertical: 14, borderRadius: radius.pill,
    marginTop: spacing.md, minHeight: 48,
  },
  freezeBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  badge: {
    width: "30.5%", aspectRatio: 1,
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg,
    alignItems: "center", justifyContent: "center", padding: spacing.sm,
    borderWidth: 2, borderColor: colors.brandPrimary,
  },
  badgeLocked: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  badgeEmoji: { fontSize: 36, marginBottom: 4 },
  badgeLabel: { fontSize: 11, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: spacing.xl, paddingVertical: 14,
    borderRadius: radius.pill, borderWidth: 2, borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: 15 },
  recapCard: {
    borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: "#F59E0B", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 6,
  },
  recapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recapKicker: { color: "#FEF3C7", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  recapTitle: { color: "#FFF", fontSize: 20, fontWeight: "800", marginTop: 2 },
  recapMini: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  recapMiniStat: { alignItems: "flex-start" },
  recapMiniValue: { color: "#FFF", fontSize: 22, fontWeight: "800" },
  recapMiniLabel: { color: "#FEF3C7", fontSize: 12, fontWeight: "600" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  recapSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  recapSheetTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  recapSheetDates: { fontSize: 12, color: colors.onSurfaceMuted, textAlign: "center", marginTop: 4, marginBottom: spacing.lg, fontWeight: "600" },
  recapGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  recapCell: {
    width: "47.5%", padding: spacing.lg, borderRadius: radius.lg,
    alignItems: "flex-start",
  },
  recapCellEmoji: { fontSize: 24 },
  recapCellVal: { fontSize: 26, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  recapCellLabel: { fontSize: 12, color: colors.onSurface, fontWeight: "600" },
  recapShareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandSecondary, paddingVertical: 14, borderRadius: radius.pill,
    marginTop: spacing.lg,
  },
  recapShareText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  recapClose: { alignItems: "center", padding: spacing.md, marginTop: 4 },
  recapCloseText: { color: colors.onSurfaceMuted, fontWeight: "700" },
});
