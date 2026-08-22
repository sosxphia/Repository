import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
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
};

export default function Profile() {
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await apiFetch("/stats");
      setStats(s);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={styles.badgeGrid}>
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
});
