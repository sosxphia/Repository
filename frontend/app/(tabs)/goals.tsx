import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, Modal, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";

type Goal = {
  goal_id: string;
  title: string;
  completed: boolean;
  xp_reward: number;
};

type DailyQuest = {
  quest_id: string;
  title: string;
  xp_reward: number;
  completed: boolean;
  date: string;
};

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [quest, setQuest] = useState<DailyQuest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, q] = await Promise.all([
        apiFetch("/goals"),
        apiFetch("/daily-quest").catch(() => null),
      ]);
      setGoals(g);
      setQuest(q);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (goal: Goal) => {
    const next = !goal.completed;
    Haptics.notificationAsync(next ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    setGoals((prev) => prev.map((g) => g.goal_id === goal.goal_id ? { ...g, completed: next } : g));
    try {
      await apiFetch(`/goals/${goal.goal_id}`, { method: "PATCH", body: JSON.stringify({ completed: next }) });
    } catch {
      setGoals((prev) => prev.map((g) => g.goal_id === goal.goal_id ? { ...g, completed: !next } : g));
    }
  };

  const remove = async (goal: Goal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGoals((prev) => prev.filter((g) => g.goal_id !== goal.goal_id));
    try { await apiFetch(`/goals/${goal.goal_id}`, { method: "DELETE" }); } catch {}
  };

  const submitNew = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setSaving(true);
    try {
      const g = await apiFetch("/goals", { method: "POST", body: JSON.stringify({ title: t }) });
      setGoals((prev) => [g, ...prev]);
      setNewTitle("");
      setModalOpen(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } finally { setSaving(false); }
  };

  const doneCount = goals.filter((g) => g.completed).length;

  const toggleQuest = async () => {
    if (!quest) return;
    const next = !quest.completed;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setQuest({ ...quest, completed: next });
    try {
      await apiFetch(`/daily-quest/${quest.quest_id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: next }),
      });
    } catch {
      setQuest({ ...quest, completed: !next });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.h1}>Today's Goals ✨</Text>
        <Text style={styles.subtitle}>{doneCount} of {goals.length} done — each grows your plant</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {quest && (
            <LinearGradient
              colors={quest.completed ? ["#DCFCE7", "#A7F3D0"] : ["#FEF3C7", "#FDE047"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.questCard}
            >
              <View style={styles.questHeader}>
                <View style={styles.questBadge}>
                  <Ionicons name="star" size={14} color={colors.onBrandPrimary} />
                  <Text style={styles.questBadgeText}>DAILY QUEST</Text>
                </View>
                <View style={styles.questXp}>
                  <Text style={styles.questXpText}>+{quest.xp_reward} XP</Text>
                </View>
              </View>
              <View style={styles.questBody}>
                <Pressable
                  onPress={toggleQuest}
                  style={[styles.checkbox, quest.completed && styles.checkboxDone]}
                  testID="daily-quest-toggle"
                >
                  {quest.completed && <Ionicons name="checkmark" size={22} color="#FFF" />}
                </Pressable>
                <Text style={[styles.questTitle, quest.completed && styles.rowTextDone]} numberOfLines={3}>
                  {quest.title}
                </Text>
              </View>
              <Text style={styles.questHint}>
                {quest.completed ? "Nice! Streak fed 🔥" : "Complete for bonus XP & keep your streak alive"}
              </Text>
            </LinearGradient>
          )}

          {goals.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🌵</Text>
              <Text style={styles.emptyTitle}>No goals yet!</Text>
              <Text style={styles.emptySub}>Add your first goal — every checkmark waters your plant 🌱</Text>
            </View>
          ) : (
            goals.map((g) => (
            <View key={g.goal_id} style={[styles.row, g.completed && styles.rowDone]} testID={`goal-row-${g.goal_id}`}>
              <Pressable
                onPress={() => toggle(g)}
                style={[styles.checkbox, g.completed && styles.checkboxDone]}
                testID={`goal-toggle-${g.goal_id}`}
              >
                {g.completed && <Ionicons name="checkmark" size={22} color="#FFF" />}
              </Pressable>
              <Text style={[styles.rowText, g.completed && styles.rowTextDone]} numberOfLines={2}>{g.title}</Text>
              <View style={styles.xpPill}>
                <Text style={styles.xpPillText}>+{g.xp_reward}</Text>
              </View>
              <Pressable onPress={() => remove(g)} hitSlop={10} style={{ marginLeft: 6 }} testID={`goal-delete-${g.goal_id}`}>
                <Ionicons name="trash-outline" size={18} color={colors.onSurfaceMuted} />
              </Pressable>
            </View>
            ))
          )}
        </ScrollView>
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setModalOpen(true); }}
        testID="add-goal-fab"
      >
        <Ionicons name="add" size={30} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal transparent visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalWrap}
        >
          <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>New Goal 🌟</Text>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="e.g. Study biology for 30 min"
              placeholderTextColor={colors.onSurfaceMuted}
              style={styles.input}
              autoFocus
              onSubmitEditing={submitNew}
              returnKeyType="done"
              testID="goal-title-input"
            />
            <Pressable
              onPress={submitNew}
              style={({ pressed }) => [styles.saveBtn, pressed && { transform: [{ scale: 0.96 }] }]}
              disabled={saving || !newTitle.trim()}
              testID="goal-save-button"
            >
              <Text style={styles.saveText}>{saving ? "Saving..." : "Plant this goal 🌱"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md },
  h1: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  emptyEmoji: { fontSize: 72, marginBottom: spacing.md },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  emptySub: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: 8, lineHeight: 20 },
  list: { padding: spacing.lg, paddingBottom: 100, gap: spacing.md },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64,
  },
  rowDone: { opacity: 0.6, backgroundColor: colors.surfaceTertiary },
  checkbox: {
    width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2,
    borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxDone: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  rowText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.onSurface },
  rowTextDone: { textDecorationLine: "line-through", color: colors.onSurfaceMuted },
  xpPill: {
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  xpPillText: { color: colors.onBrandTertiary, fontWeight: "800", fontSize: 12 },
  fab: {
    position: "absolute", right: spacing.lg, bottom: spacing.lg,
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.brandPrimary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg,
    borderRadius: radius.lg, fontSize: 16, color: colors.onSurface,
    borderWidth: 2, borderColor: colors.border,
  },
  saveBtn: {
    marginTop: spacing.lg, backgroundColor: colors.brandSecondary,
    paddingVertical: 16, borderRadius: radius.pill, alignItems: "center",
  },
  saveText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  questCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: "#FDE047",
    marginBottom: spacing.sm,
    shadowColor: "rgba(245,158,11,0.4)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 4,
  },
  questHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  questBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  questBadgeText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  questXp: {
    backgroundColor: "#FFF",
    paddingHorizontal: spacing.md, paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: colors.brandPrimary,
  },
  questXpText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 12 },
  questBody: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    marginTop: spacing.md,
  },
  questTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onSurface, lineHeight: 22 },
  questHint: { fontSize: 12, color: "#78350F", fontWeight: "600", marginTop: spacing.sm, textAlign: "center" },
});
