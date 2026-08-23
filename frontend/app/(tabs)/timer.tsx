import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, AppState, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";

const GRACE_SECONDS = 60;

const PRESETS = [
  { label: "Pomodoro 🍅: 25 mins", minutes: 25 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hr", minutes: 120 },
];

export default function Timer() {
  const router = useRouter();
  const [duration, setDuration] = useState(25); // minutes
  const [remaining, setRemaining] = useState(25 * 60); // seconds
  const [running, setRunning] = useState(false);
  const [lastXp, setLastXp] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const [deathOpen, setDeathOpen] = useState(false);
  const [deadName, setDeadName] = useState("Your tree");
  const [forgiven, setForgiven] = useState(false);
  const intervalRef = useRef<any>(null);
  const runningRef = useRef(false);
  const awayAtRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      KeepAwake.deactivateKeepAwake().catch(() => {});
    };
  }, []);

  const clearTimer = () => {
    runningRef.current = false;
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    KeepAwake.deactivateKeepAwake().catch(() => {});
  };

  // Focus Lock: leaving the app for longer than the grace period kills the tree
  const killTree = async () => {
    clearTimer();
    setRemaining(duration * 60);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    try {
      const res = await apiFetch("/plants/focus-break", { method: "POST" });
      if (res?.name) setDeadName(res.name);
    } catch (e) {
      console.log("focus-break err", e);
    }
    setDeathOpen(true);
  };

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!runningRef.current) return;
      if (state === "background" || state === "inactive") {
        if (awayAtRef.current === null) awayAtRef.current = Date.now();
        return;
      }
      if (state === "active" && awayAtRef.current !== null) {
        const awaySec = (Date.now() - awayAtRef.current) / 1000;
        awayAtRef.current = null;
        if (awaySec > GRACE_SECONDS) {
          killTree();
        } else {
          setForgiven(true);
          setTimeout(() => setForgiven(false), 6000);
        }
      }
    });
    return () => sub.remove();
  }, [duration]);

  const handleComplete = async (minutes: number) => {
    clearTimer();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const res = await apiFetch("/focus-sessions", {
        method: "POST",
        body: JSON.stringify({ duration_minutes: minutes }),
      });
      setLastXp(res.xp_earned);
    } catch (e) {
      console.log("focus save err", e);
    }
    setRemaining(minutes * 60);
  };

  // Timer starts the moment a time is chosen
  const start = (minutes: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLastXp(null);
    setForgiven(false);
    setCustomOpen(false);
    setDuration(minutes);
    setRemaining(minutes * 60);
    setRunning(true);
    runningRef.current = true;
    awayAtRef.current = null;
    KeepAwake.activateKeepAwakeAsync().catch(() => {});
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          handleComplete(minutes);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  const startCustom = () => {
    const m = parseInt(customMin, 10);
    if (!m || m < 1 || m > 480) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setCustomMin("");
    start(m);
  };

  const stop = () => {
    // Stop & save partial (only if >= 1 minute elapsed)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const elapsedSec = duration * 60 - remaining;
    const elapsedMin = Math.floor(elapsedSec / 60);
    clearTimer();
    if (elapsedMin >= 1) {
      apiFetch("/focus-sessions", {
        method: "POST",
        body: JSON.stringify({ duration_minutes: elapsedMin }),
      }).then((r) => setLastXp(r.xp_earned)).catch(() => {});
    }
    setRemaining(duration * 60);
  };

  const mins = Math.floor(remaining / 60).toString().padStart(2, "0");
  const secs = (remaining % 60).toString().padStart(2, "0");
  const pct = 1 - remaining / (duration * 60);

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="timer-screen">
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Focus Time 🧘</Text>
        <Text style={styles.subtitle}>Every minute waters your plant</Text>
      </View>

      {/* Circle timer */}
      <View style={styles.circleWrap}>
        <LinearGradient
          colors={running ? ["#DCFCE7", "#A7F3D0"] : ["#FEF3C7", "#FDE68A"]}
          style={styles.circle}
        >
          <Text style={styles.plantEmoji}>{running ? "🌿" : "💤"}</Text>
          <Text style={styles.timeText} testID="timer-display">{mins}:{secs}</Text>
          <View style={styles.circleProgressBg}>
            <View style={[styles.circleProgressFill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>
          <Text style={styles.status}>{running ? "Focusing…" : "Pick a time to start"}</Text>
        </LinearGradient>
      </View>

      {/* Focus Lock warning */}
      <View style={[styles.lockCard, running && styles.lockCardActive]} testID="focus-lock-banner">
        <Text style={styles.lockTitle}>
          {running ? "🔒 Focus Lock is ON" : "🔒 Focus Lock is always on"}
        </Text>
        <Text style={styles.lockText}>
          Leave the app for more than 60 seconds during a session and your tree dies 💀. Quick
          interruptions like a phone call under a minute are forgiven.
        </Text>
      </View>

      {forgiven && (
        <View style={styles.forgivenBanner} testID="focus-forgiven-banner">
          <Text style={styles.forgivenText}>Phew! Back within 60s — your tree survived 🌿</Text>
        </View>
      )}

      {/* Custom first, then presets — tapping a preset starts the timer immediately */}
      {!running && (
        <View style={styles.presetsRow}>
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setCustomOpen((v) => !v); }}
            style={[styles.presetPill, customOpen && styles.presetPillActive]}
            testID="preset-custom"
          >
            <Text style={[styles.presetText, customOpen && styles.presetTextActive]}>Custom</Text>
          </Pressable>

          {customOpen && (
            <View style={styles.customRow}>
              <TextInput
                value={customMin}
                onChangeText={setCustomMin}
                keyboardType="number-pad"
                placeholder="minutes (1–480)"
                placeholderTextColor={colors.onSurfaceMuted}
                style={styles.customInput}
                maxLength={3}
                autoFocus
                onSubmitEditing={startCustom}
                testID="custom-minutes-input"
              />
              <Pressable onPress={startCustom} style={styles.customGo} testID="custom-start-button">
                <Ionicons name="play" size={16} color="#FFF" />
                <Text style={styles.customGoText}>Go</Text>
              </Pressable>
            </View>
          )}

          {PRESETS.map((p) => (
            <Pressable
              key={p.minutes}
              onPress={() => start(p.minutes)}
              style={styles.presetPill}
              testID={`preset-${p.minutes}`}
            >
              <Text style={styles.presetText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {lastXp !== null && !running && (
        <View style={styles.xpBanner} testID="xp-banner">
          <Ionicons name="sparkles" size={18} color={colors.brandPrimary} />
          <Text style={styles.xpBannerText}>+{lastXp} XP watered your plant 🌱</Text>
        </View>
      )}

      {running && (
        <Pressable
          onPress={stop}
          style={({ pressed }) => [
            styles.startBtn,
            { backgroundColor: colors.error },
            pressed && { transform: [{ scale: 0.96 }] },
          ]}
          testID="timer-toggle-button"
        >
          <Ionicons name="stop" size={22} color="#FFF" />
          <Text style={styles.startText}>Stop</Text>
        </Pressable>
      )}

      {/* Tree died — Focus Lock broken */}
      <Modal transparent visible={deathOpen} animationType="fade" onRequestClose={() => setDeathOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.deathCard} testID="focus-lock-death-modal">
            <Text style={styles.deathEmoji}>💔</Text>
            <Text style={styles.deathTitle}>{deadName} died</Text>
            <Text style={styles.deathText}>
              You left the app for more than 60 seconds while focusing, so Focus Lock was broken.
              You can revive your tree or replant a fresh seed.
            </Text>
            <Pressable
              onPress={() => { setDeathOpen(false); router.push("/(tabs)/garden"); }}
              style={styles.deathBtn}
              testID="focus-lock-death-garden"
            >
              <Text style={styles.deathBtnText}>Go to my tree 🌳</Text>
            </Pressable>
            <Pressable onPress={() => setDeathOpen(false)} style={styles.deathGhost}>
              <Text style={styles.deathGhostText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  headerRow: { marginTop: spacing.md, marginBottom: spacing.lg },
  h1: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2 },
  circleWrap: { alignItems: "center", justifyContent: "center", marginVertical: spacing.sm },
  circle: {
    width: 230, height: 230, borderRadius: 115, alignItems: "center", justifyContent: "center",
    borderWidth: 6, borderColor: "#FFF", padding: spacing.md,
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 1, shadowRadius: 20, elevation: 6,
  },
  plantEmoji: { fontSize: 40, marginBottom: 2 },
  timeText: { fontSize: 46, fontWeight: "800", color: colors.onSurface, letterSpacing: -1 },
  circleProgressBg: { width: "80%", height: 8, backgroundColor: "rgba(255,255,255,0.7)", borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  circleProgressFill: { height: "100%", backgroundColor: colors.brandSecondary, borderRadius: radius.pill },
  status: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: spacing.sm, fontWeight: "600" },
  presetsRow: { flexDirection: "column", gap: spacing.sm, marginVertical: spacing.lg },
  presetPill: {
    paddingHorizontal: spacing.lg, paddingVertical: 16,
    borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: "transparent", width: "100%", alignItems: "center",
    justifyContent: "center", minHeight: 52,
  },
  presetPillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  presetText: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  presetTextActive: { color: colors.onBrandPrimary },
  customRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", alignItems: "center" },
  customInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, fontWeight: "700",
    color: colors.onSurface, flex: 1, textAlign: "center",
    borderWidth: 2, borderColor: colors.border,
  },
  customGo: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandSecondary, paddingHorizontal: spacing.lg, paddingVertical: 12,
    borderRadius: radius.pill, minHeight: 44, justifyContent: "center",
  },
  customGoText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  xpBanner: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.pill, marginBottom: spacing.md,
  },
  xpBannerText: { color: colors.onBrandTertiary, fontWeight: "700" },
  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 18, borderRadius: radius.pill, marginTop: "auto", marginBottom: spacing.md,
    shadowColor: colors.brandSecondary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  startText: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  lockCard: {
    backgroundColor: "#FEF2F2", borderRadius: radius.lg, borderWidth: 2, borderColor: "#FECACA",
    padding: spacing.md, marginBottom: spacing.sm,
  },
  lockCardActive: { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" },
  lockTitle: { fontSize: 14, fontWeight: "800", color: "#B91C1C" },
  lockText: { fontSize: 12, color: "#7F1D1D", marginTop: 4, lineHeight: 17 },
  forgivenBanner: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.pill,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  forgivenText: { color: colors.onBrandTertiary, fontWeight: "700", textAlign: "center", fontSize: 13 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  deathCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    width: "100%", alignItems: "center",
  },
  deathEmoji: { fontSize: 52 },
  deathTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  deathText: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  deathBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingVertical: 14, paddingHorizontal: spacing.lg, marginTop: spacing.lg, minHeight: 48, justifyContent: "center",
  },
  deathBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
  deathGhost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  deathGhostText: { color: colors.onSurfaceMuted, fontWeight: "700" },
});
