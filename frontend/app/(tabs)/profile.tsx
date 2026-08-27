import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Modal, Share, Platform, Alert, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { StreakCalendar } from "@/src/components/StreakCalendar";
import { useSubscription } from "@/src/lib/revenuecat";
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
  const router = useRouter();
  const { isSubscribed } = useSubscription();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [settings, setSettings] = useState({ notifications_enabled: true, focus_lock_enabled: true, strict_lock_enabled: true });
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [freezeClaimable, setFreezeClaimable] = useState(true);

  const saveSetting = async (patch: { notifications_enabled?: boolean; focus_lock_enabled?: boolean; strict_lock_enabled?: boolean }) => {
    Haptics.selectionAsync();
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const res = await apiFetch("/settings", { method: "PATCH", body: JSON.stringify(patch) });
      setSettings(res);
    } catch (e) {
      console.log("settings err", e);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await apiFetch("/account", { method: "DELETE" });
      setDeleteOpen(false);
      setSettingsOpen(false);
      signOut();
    } catch (e: any) {
      console.log("delete account err", e);
      Alert.alert("Couldn't delete account", e?.message || "Please try again in a moment.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleFocusLock = (v: boolean) => {
    if (!v) {
      saveSetting({ focus_lock_enabled: false });
      return;
    }
    Haptics.selectionAsync();
    setLockConfirmOpen(true);
  };

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        apiFetch("/stats"),
        apiFetch("/weekly-recap").catch(() => null),
      ]);
      setStats(s);
      setRecap(r);
      apiFetch("/settings").then(setSettings).catch(() => {});
      apiFetch("/streak-freezes/status").then((f) => setFreezeClaimable(!!f.claimable)).catch(() => {});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const claimFreeze = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!isSubscribed) {
      router.push("/paywall");
      return;
    }
    setBuying(true);
    try {
      const res = await apiFetch("/streak-freezes/claim", { method: "POST" });
      if (res.granted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (Platform.OS !== "web") Alert.alert("❄️ Streak Freeze added!", "Your tree is protected for one missed day.");
      } else if (Platform.OS !== "web") {
        Alert.alert("Already claimed", "You've claimed this month's freeze. The next one unlocks next month.");
      }
      setFreezeClaimable(false);
      await load();
    } catch (e: any) {
      console.log("claim freeze err", e);
      Alert.alert("Couldn't claim freeze", e?.message || "Please try again in a moment.");
    } finally {
      setBuying(false);
    }
  };

  const badges = [
    { key: "streak", label: "3-day Streak", emoji: "🔥", unlocked: (stats?.streak_days ?? 0) >= 3 },
    { key: "focus60", label: "60 Min Focus", emoji: "🕥", unlocked: (stats?.total_focus_minutes ?? 0) >= 60 },
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
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setSettingsOpen(true); }}
            style={styles.cogBtn}
            hitSlop={10}
            testID="settings-cog-button"
          >
            <Ionicons name="settings-outline" size={22} color={colors.onSurfaceMuted} />
          </Pressable>
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
                      <Text style={styles.recapTitle}>Weekly Recap</Text>
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
                <Text style={styles.statEmoji}>🕥</Text>
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

            <Text style={styles.sectionTitle}>Streak Calendar 🔥</Text>
            <StreakCalendar />

            {/* Sproutly PRO — everything the subscription includes */}
            <Text style={styles.sectionTitle}>Sproutly PRO ✨</Text>
            <LinearGradient
              colors={isSubscribed ? ["#FEF3C7", "#FDE68A"] : ["#E0F2FE", "#DBEAFE"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.proCard}
              testID="pro-features-card"
            >
              <View style={styles.proHeader}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={styles.proCardTitle}>
                    {isSubscribed ? "PRO is active 🌟" : "Everything PRO unlocks"}
                  </Text>
                  <Text style={styles.proCardSub}>
                    {isSubscribed
                      ? "Thanks for supporting Sproutly — here's what you get."
                      : "$2.99 / month, cancel any time."}
                  </Text>
                </View>
                {isSubscribed && (
                  <View style={styles.proChip}>
                    <Text style={styles.proChipText}>PRO</Text>
                  </View>
                )}
              </View>

              <View style={styles.proList}>
                <View style={styles.proItem}>
                  <Text style={styles.proItemIcon}>❄️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proItemTitle}>Monthly streak freeze</Text>
                    <Text style={styles.proItemSub}>
                      Covers one missed day automatically · you own{" "}
                      <Text style={styles.proItemStrong} testID="freeze-count">{stats?.streak_freezes ?? 0}</Text>
                    </Text>
                  </View>
                </View>
                <View style={styles.proItem}>
                  <Text style={styles.proItemIcon}>💚</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proItemTitle}>Free tree revives</Text>
                    <Text style={styles.proItemSub}>Bring a dead tree back with all its progress</Text>
                  </View>
                </View>
                <View style={styles.proItem}>
                  <Text style={styles.proItemIcon}>🏅</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proItemTitle}>Golden PRO badge</Text>
                    <Text style={styles.proItemSub}>Shows next to your name on the leaderboard</Text>
                  </View>
                </View>
                <View style={styles.proItem}>
                  <Text style={styles.proItemIcon}>✨</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proItemTitle}>Early access to new features</Text>
                    <Text style={styles.proItemSub}>Try new things before everyone else</Text>
                  </View>
                </View>
              </View>

              {isSubscribed ? (
                <Pressable
                  onPress={claimFreeze}
                  disabled={buying || !freezeClaimable}
                  style={({ pressed }) => [
                    styles.freezeBtn,
                    pressed && { transform: [{ scale: 0.97 }] },
                    (buying || !freezeClaimable) && { backgroundColor: "#64748B" },
                  ]}
                  testID="buy-freeze-button"
                >
                  {buying ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : freezeClaimable ? (
                    <>
                      <Ionicons name="snow" size={18} color="#FFF" />
                      <Text style={styles.freezeBtnText}>Claim this month&apos;s freeze</Text>
                    </>
                  ) : (
                    <Text style={styles.freezeBtnText}>Claimed — next one next month ❄️</Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/paywall"); }}
                  style={({ pressed }) => [styles.freezeBtn, pressed && { transform: [{ scale: 0.97 }] }]}
                  testID="buy-freeze-button"
                >
                  <Ionicons name="star" size={18} color="#FFF" />
                  <Text style={styles.freezeBtnText}>Go PRO — $2.99/month</Text>
                </Pressable>
              )}
            </LinearGradient>

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

      {/* Settings sheet */}
      <Modal transparent visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalWrap}>
          <Pressable style={styles.backdrop} onPress={() => setSettingsOpen(false)} />
          <View style={styles.settingsSheet} testID="settings-card">
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)} hitSlop={10} testID="settings-close-button">
                <Ionicons name="close" size={24} color={colors.onSurfaceMuted} />
              </Pressable>
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingLabelWrap}>
                <Text style={styles.settingLabel}>Notifications</Text>
                <Text style={styles.settingSub}>Streak reminders and friend requests</Text>
              </View>
              <Switch
                value={settings.notifications_enabled}
                onValueChange={(v) => saveSetting({ notifications_enabled: v })}
                trackColor={{ true: colors.brandSecondary, false: colors.borderStrong }}
                thumbColor="#FFFFFF"
                testID="notifications-switch"
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingLabelWrap}>
                <Text style={styles.settingLabel}>Focus Lock 🔒</Text>
                <Text style={styles.settingSub}>
                  {settings.focus_lock_enabled
                    ? "On — leaving the app during a focus session kills your tree"
                    : "Off — you can leave the app during a focus session"}
                </Text>
              </View>
              <Switch
                value={settings.focus_lock_enabled}
                onValueChange={toggleFocusLock}
                trackColor={{ true: colors.error, false: colors.borderStrong }}
                thumbColor="#FFFFFF"
                testID="focus-lock-switch"
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingLabelWrap}>
                <Text style={styles.settingLabel}>Locked-in mode 🚫</Text>
                <Text style={styles.settingSub}>
                  {settings.strict_lock_enabled
                    ? "Focus sessions take over the whole screen — quitting early kills your tree"
                    : "Off — sessions run in the normal timer screen"}
                </Text>
              </View>
              <Switch
                value={settings.strict_lock_enabled}
                onValueChange={(v) => saveSetting({ strict_lock_enabled: v })}
                disabled={!settings.focus_lock_enabled}
                trackColor={{ true: colors.brandSecondary, false: colors.borderStrong }}
                thumbColor="#FFFFFF"
                testID="strict-lock-switch"
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingLabelWrap}>
                <Text style={styles.settingLabel}>Sproutly PRO ✨</Text>
                <Text style={styles.settingSub}>
                  {isSubscribed
                    ? "PRO active — thanks for supporting the app"
                    : "Golden PRO badge on the leaderboard + early features"}
                </Text>
              </View>
              <Pressable
                onPress={() => { setSettingsOpen(false); router.push("/paywall"); }}
                style={[styles.proBtn, isSubscribed && { backgroundColor: colors.brandTertiary }]}
                testID="manage-pro-button"
              >
                <Text style={[styles.proBtnText, isSubscribed && { color: colors.onBrandTertiary }]}>
                  {isSubscribed ? "PRO" : "Upgrade"}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => { Haptics.selectionAsync(); setSettingsOpen(false); setDeleteOpen(true); }}
              style={[styles.settingRow, styles.settingRowBorder]}
              testID="delete-account-row"
            >
              <View style={styles.settingLabelWrap}>
                <Text style={[styles.settingLabel, { color: colors.error }]}>Delete my account</Text>
                <Text style={styles.settingSub}>Permanently erase your tree, goals and friends</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceMuted} />
            </Pressable>

            {settings.focus_lock_enabled && (
              <View style={styles.settingWarn} testID="focus-lock-warning">
                <Text style={styles.settingWarnText}>
                  ⚠️ While Focus Lock is on, leaving the app for more than 60 seconds during a focus
                  session will kill your tree. Interruptions under a minute are forgiven.
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete account confirmation */}
      <Modal transparent visible={deleteOpen} animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmCard} testID="delete-account-modal">
            <Text style={styles.confirmEmoji}>🗑️</Text>
            <Text style={styles.confirmTitle}>Delete your account?</Text>
            <Text style={styles.confirmText}>
              This permanently erases your tree, goals, focus history, streak and friends. It cannot
              be undone.
            </Text>
            <Pressable
              onPress={deleteAccount}
              style={styles.confirmBtn}
              disabled={deleting}
              testID="delete-account-confirm"
            >
              {deleting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.confirmBtnText}>Delete everything</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setDeleteOpen(false)} style={styles.confirmGhost} testID="delete-account-cancel">
              <Text style={styles.confirmGhostText}>Keep my account</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Focus Lock confirmation */}
      <Modal transparent visible={lockConfirmOpen} animationType="fade" onRequestClose={() => setLockConfirmOpen(false)}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmCard} testID="focus-lock-confirm-modal">
            <Text style={styles.confirmEmoji}>🔒</Text>
            <Text style={styles.confirmTitle}>Turn on Focus Lock?</Text>
            <Text style={styles.confirmText}>
              Your tree will die if you leave the app for more than 60 seconds during a focus
              session. Quick interruptions under a minute are forgiven.
            </Text>
            <Pressable
              onPress={() => { setLockConfirmOpen(false); saveSetting({ focus_lock_enabled: true }); }}
              style={styles.confirmBtn}
              testID="focus-lock-confirm-button"
            >
              <Text style={styles.confirmBtnText}>Turn on</Text>
            </Pressable>
            <Pressable onPress={() => setLockConfirmOpen(false)} style={styles.confirmGhost} testID="focus-lock-cancel-button">
              <Text style={styles.confirmGhostText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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
                <Text style={styles.recapCellEmoji}>🕥</Text>
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
                    message: `This week on Sproutly 🌷\n✅ ${recap?.goals_completed ?? 0} goals crushed\n🕥 ${recap?.focus_minutes ?? 0} focus minutes\n🌸 ${recap?.plants_bloomed ?? 0} plants bloomed\n🔥 ${recap?.current_streak ?? 0}-day streak!`,
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
  cogBtn: { position: "absolute", top: 0, right: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  settingsSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  proBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 40, justifyContent: "center",
  },
  proBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
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
  settingsCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, gap: spacing.md },
  settingRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  settingLabelWrap: { flex: 1 },
  settingLabel: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  settingSub: { fontSize: 12, color: colors.onSurfaceMuted, marginTop: 2, lineHeight: 17 },
  settingWarn: {
    backgroundColor: "#FEF2F2", borderRadius: radius.md, borderWidth: 1, borderColor: "#FECACA",
    padding: spacing.md, marginBottom: spacing.md,
  },
  settingWarnText: { fontSize: 12, color: "#7F1D1D", lineHeight: 17, fontWeight: "600" },
  confirmWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", alignItems: "center" },
  confirmEmoji: { fontSize: 44 },
  confirmTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  confirmText: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  confirmBtn: {
    backgroundColor: colors.error, borderRadius: radius.pill, paddingVertical: 14,
    paddingHorizontal: spacing.xl, marginTop: spacing.lg, minHeight: 48, justifyContent: "center",
  },
  confirmBtnText: { color: "#FFF", fontWeight: "800", fontSize: 16 },
  confirmGhost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  confirmGhostText: { color: colors.onSurfaceMuted, fontWeight: "700" },

  proCard: {
    borderRadius: radius.lg, padding: spacing.md, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)",
  },
  proHeader: { flexDirection: "row", alignItems: "center" },
  proCardTitle: { fontSize: 17, fontWeight: "800", color: "#0C4A6E" },
  proCardSub: { fontSize: 12, color: "#075985", marginTop: 4, lineHeight: 17 },
  proChip: {
    backgroundColor: "#FBBF24", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "#D97706",
  },
  proChipText: { fontSize: 11, fontWeight: "800", color: "#7C2D12", letterSpacing: 0.5 },
  proList: { marginTop: spacing.md, gap: spacing.sm },
  proItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  proItemIcon: { fontSize: 20, width: 26, textAlign: "center" },
  proItemTitle: { fontSize: 14, fontWeight: "800", color: "#0C4A6E" },
  proItemSub: { fontSize: 12, color: "#075985", marginTop: 1, lineHeight: 16 },
  proItemStrong: { fontWeight: "800", color: "#0C4A6E" },
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
