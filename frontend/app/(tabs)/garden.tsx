import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";
import { STAGE_EMOJI, STAGE_LABEL, Stage } from "@/src/lib/plant";

type Plant = {
  plant_id: string;
  name: string;
  xp: number;
  is_current: boolean;
  stage: Stage;
  progress: { stage: Stage; stage_min: number; stage_max: number; in_stage: number; stage_span: number };
  bloomed_at: string | null;
};

export default function Garden() {
  const router = useRouter();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [current, setCurrent] = useState<Plant | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cur, all] = await Promise.all([
        apiFetch("/plants/current"),
        apiFetch("/plants"),
      ]);
      setCurrent(cur);
      setPlants(all);
    } catch (e) {
      console.log("garden load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const openReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setResetName("");
    setResetOpen(true);
  };

  const confirmReset = async () => {
    if (!current) return;
    setResetting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await apiFetch(`/plants/${current.plant_id}/reset`, {
        method: "POST",
        body: JSON.stringify({ name: resetName.trim() || "New Plant" }),
      });
      setResetOpen(false);
      load();
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </SafeAreaView>
    );
  }

  const progress = current ? current.progress.in_stage / current.progress.stage_span : 0;
  const percentage = Math.round(progress * 100);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hi}>My Garden 🌷</Text>
            <Text style={styles.subhi}>Keep watering with focus & goals</Text>
          </View>
          <Pressable onPress={openReset} style={styles.resetBtn} testID="reset-plant-button">
            <Ionicons name="refresh" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        {/* Hero plant card */}
        <LinearGradient
          colors={["#FEF3C7", "#DCFCE7"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.stageBadge}>
            <Text style={styles.stageBadgeText}>{STAGE_LABEL[current?.stage || "seed"]}</Text>
          </View>
          <Text style={styles.heroEmoji} testID="current-plant-emoji">{STAGE_EMOJI[current?.stage || "seed"]}</Text>
          <Text style={styles.heroName}>{current?.name}</Text>
          <Text style={styles.xpText}>{current?.xp} XP</Text>

          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${Math.min(100, percentage)}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {current?.progress.in_stage} / {current?.progress.stage_span} to next stage · {percentage}%
            </Text>
          </View>
        </LinearGradient>

        {/* Action tiles */}
        <View style={styles.actionRow}>
          <Pressable style={[styles.actionTile, { backgroundColor: colors.brandPrimary }]} onPress={() => router.push("/(tabs)/timer")} testID="action-focus">
            <Text style={styles.actionEmoji}>⏱️</Text>
            <Text style={styles.actionText}>Focus</Text>
            <Text style={styles.actionSub}>+2 XP / min</Text>
          </Pressable>
          <Pressable style={[styles.actionTile, { backgroundColor: colors.brandSecondary }]} onPress={() => router.push("/(tabs)/goals")} testID="action-goals">
            <Text style={styles.actionEmoji}>✅</Text>
            <Text style={[styles.actionText, { color: "#FFF" }]}>Goals</Text>
            <Text style={[styles.actionSub, { color: "#DCFCE7" }]}>+10 XP each</Text>
          </Pressable>
        </View>

        {/* Garden collection */}
        <Text style={styles.sectionTitle}>My Plants ({plants.length})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.lg }}>
          {plants.map((p) => (
            <View key={p.plant_id} style={[styles.plantChip, p.is_current && styles.plantChipActive]}>
              <Text style={styles.chipEmoji}>{STAGE_EMOJI[p.stage]}</Text>
              <Text style={styles.chipName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.chipStage}>{STAGE_LABEL[p.stage]}</Text>
              <Text style={styles.chipXp}>{p.xp} XP</Text>
              {p.bloomed_at && <Ionicons name="star" size={14} color={colors.brandPrimary} style={{ marginTop: 4 }} />}
            </View>
          ))}
        </ScrollView>
      </ScrollView>

      <Modal transparent visible={resetOpen} animationType="slide" onRequestClose={() => setResetOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalWrap}
        >
          <Pressable style={styles.backdrop} onPress={() => setResetOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Plant a new sprout 🌱</Text>
            <Text style={styles.sheetSub}>Your current plant will move to your garden. Give the new one a cute name!</Text>
            <TextInput
              value={resetName}
              onChangeText={setResetName}
              placeholder="e.g. Basil, Sunny, Little Leaf..."
              placeholderTextColor={colors.onSurfaceMuted}
              style={styles.input}
              autoFocus
              onSubmitEditing={confirmReset}
              returnKeyType="done"
              maxLength={30}
              testID="new-plant-name-input"
            />
            <View style={styles.sheetRow}>
              <Pressable
                onPress={() => setResetOpen(false)}
                style={[styles.sheetBtn, { backgroundColor: colors.surfaceSecondary }]}
                testID="reset-cancel-button"
              >
                <Text style={[styles.sheetBtnText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmReset}
                disabled={resetting}
                style={({ pressed }) => [
                  styles.sheetBtn,
                  { backgroundColor: colors.brandSecondary, flex: 1.4 },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
                testID="reset-confirm-button"
              >
                <Text style={[styles.sheetBtnText, { color: "#FFF" }]}>
                  {resetting ? "Planting..." : "Plant 🌱"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md, marginBottom: spacing.lg },
  hi: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subhi: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2 },
  resetBtn: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  heroCard: {
    borderRadius: radius.lg, padding: spacing.xl,
    alignItems: "center", borderWidth: 2, borderColor: "#FDE68A",
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
  },
  stageBadge: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, marginBottom: spacing.md,
  },
  stageBadgeText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
  heroEmoji: { fontSize: 120, marginVertical: spacing.sm },
  heroName: { fontSize: 22, fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm },
  xpText: { fontSize: 14, color: colors.onSurfaceMuted, marginTop: 4, fontWeight: "600" },
  progressWrap: { width: "100%", marginTop: spacing.lg },
  progressBg: { height: 14, backgroundColor: "rgba(255,255,255,0.7)", borderRadius: radius.pill, overflow: "hidden", borderWidth: 1, borderColor: "#FDE68A" },
  progressFill: { height: "100%", backgroundColor: colors.brandSecondary, borderRadius: radius.pill },
  progressText: { fontSize: 11, color: colors.onSurfaceMuted, marginTop: 6, textAlign: "center", fontWeight: "600" },
  actionRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  actionTile: {
    flex: 1, paddingVertical: spacing.lg, paddingHorizontal: spacing.md,
    borderRadius: radius.lg, alignItems: "center",
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3,
  },
  actionEmoji: { fontSize: 32 },
  actionText: { fontSize: 16, fontWeight: "800", color: colors.onBrandPrimary, marginTop: 4 },
  actionSub: { fontSize: 11, color: "#78350F", fontWeight: "600", marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  plantChip: {
    width: 120, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, alignItems: "center", borderWidth: 2, borderColor: "transparent",
  },
  plantChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  chipEmoji: { fontSize: 40 },
  chipName: { fontSize: 13, fontWeight: "700", color: colors.onSurface, marginTop: 4 },
  chipStage: { fontSize: 11, color: colors.onSurfaceMuted, marginTop: 2 },
  chipXp: { fontSize: 12, fontWeight: "700", color: colors.brandSecondary, marginTop: 4 },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  sheetSub: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 6, marginBottom: spacing.md, lineHeight: 18 },
  input: {
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg,
    borderRadius: radius.lg, fontSize: 16, color: colors.onSurface,
    borderWidth: 2, borderColor: colors.border,
  },
  sheetRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  sheetBtn: {
    flex: 1, paddingVertical: 16, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
  },
  sheetBtnText: { fontSize: 15, fontWeight: "700" },
});
