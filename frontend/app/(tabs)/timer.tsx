import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as KeepAwake from "expo-keep-awake";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/src/lib/api";
import { FocusLockOverlay } from "@/src/components/FocusLockOverlay";
import { GuidedAccessSheet } from "@/src/components/GuidedAccessSheet";
import { colors, spacing, radius } from "@/src/lib/theme";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  AppState,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";

const GRACE_SECONDS = 60;
const GUIDE_HIDDEN_KEY = "sprout_hide_guided_access";

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
  const [today, setToday] = useState<{
    sessions: { session_id: string; duration_minutes: number; xp_earned: number; created_at: string | null }[];
    total_minutes: number;
    total_xp: number;
    focus_lock_streak: number;
    focus_lock_best: number;
  } | null>(null);
  const intervalRef = useRef<any>(null);
  const runningRef = useRef(false);
  const awayAtRef = useRef<number | null>(null);
  const [lockEnabled, setLockEnabled] = useState(true);
  const lockEnabledRef = useRef(true);
  const [strictLock, setStrictLock] = useState(true);
  const [lockedOpen, setLockedOpen] = useState(false);
  const [guideMinutes, setGuideMinutes] = useState<number | null>(null);
  const [guideHidden, setGuideHidden] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(GUIDE_HIDDEN_KEY).then((v) => setGuideHidden(v === "1")).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      KeepAwake.deactivateKeepAwake().catch(() => {});
    };
  }, []);

  const loadToday = () => {
    apiFetch("/focus-sessions/today").then(setToday).catch(() => {});
  };

  useEffect(() => { loadToday(); }, []);

  useFocusEffect(
    useCallback(() => {
      apiFetch("/settings")
        .then((s) => {
          setLockEnabled(s.focus_lock_enabled);
          lockEnabledRef.current = s.focus_lock_enabled;
          setStrictLock(s.strict_lock_enabled ?? true);
        })
        .catch(() => {});
    }, []),
  );

  const clearTimer = () => {
    runningRef.current = false;
    setRunning(false);
    setLockedOpen(false);
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
    loadToday();
  };

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (!runningRef.current || !lockEnabledRef.current) return;
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
      loadToday();
    } catch (e) {
      console.log("focus save err", e);
    }
    setRemaining(minutes * 60);
  };

  const beginSession = (minutes: number) => {
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
    if (lockEnabledRef.current && strictLock) setLockedOpen(true);
  };

  // Strict mode on iOS: offer the Guided Access guide before locking in
  const start = (minutes: number) => {
    if (Platform.OS === "ios" && lockEnabled && strictLock && !guideHidden) {
      Haptics.selectionAsync();
      setCustomOpen(false);
      setGuideMinutes(minutes);
      return;
    }
    beginSession(minutes);
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
      }).then((r) => { setLastXp(r.xp_earned); loadToday(); }).catch(() => {});
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
        >
      <View style={styles.circleWrap}>
        <LinearGradient
          colors={running ? ["#DCFCE7", "#A7F3D0"] : ["#FEF3C7", "#FDE68A"]}
          style={styles.circle}
        >
          <Text style={styles.plantEmoji}>{running ? "🌿" : customOpen ? "✏️" : "💤"}</Text>
          {customOpen && !running ? (
            <TextInput
              value={customMin}
              onChangeText={setCustomMin}
              keyboardType="number-pad"
              placeholder="25"
              placeholderTextColor="rgba(0,0,0,0.25)"
              style={styles.clockInput}
              maxLength={3}
              autoFocus
              onSubmitEditing={startCustom}
              testID="custom-minutes-input"
            />
          ) : (
            <Text style={styles.timeText} testID="timer-display">{mins}:{secs}</Text>
          )}
          <View style={styles.circleProgressBg}>
            <View style={[styles.circleProgressFill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>
          <Text style={styles.status}>
            {running ? "Focusing…" : customOpen ? "Type minutes (1–480)" : "Pick a time to start"}
          </Text>
        </LinearGradient>
      </View>

      {/* Focus Lock warning */}
      <View style={[styles.lockCard, running && lockEnabled && styles.lockCardActive, !lockEnabled && styles.lockCardOff]} testID="focus-lock-banner">
        <Text style={[styles.lockTitle, !lockEnabled && styles.lockTitleOff]}>
          {!lockEnabled ? "🔓 Focus Lock is off" : running ? "🔒 Focus Lock is ON" : "🔒 Focus Lock is on"}
        </Text>
        <Text style={[styles.lockText, !lockEnabled && styles.lockTextOff]}>
          {!lockEnabled
            ? "You can leave the app during a session. Turn Focus Lock back on in Profile → Settings."
            : "Leave the app for more than 60 seconds during a session and your tree will die. Quick interruptions under a minute are forgiven."}
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
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  startCustom();
                }}
                style={styles.customGo}
                testID="custom-start-button"
              >
                <Ionicons name="play" size={16} color="#FFF" />
                <Text style={styles.customGoText}>Start {customMin ? `${customMin} min` : "custom"}</Text>
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

      {/* Focus Lock streak */}
      <View style={styles.streakCard} testID="focus-streak-card">
        <Text style={styles.streakBig}>🔥 {today?.focus_lock_streak ?? 0}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.streakTitle}>
            {(today?.focus_lock_streak ?? 0) === 1 ? "1 session in a row" : `${today?.focus_lock_streak ?? 0} sessions in a row`}
          </Text>
          <Text style={styles.streakSub}>
            Finished without breaking Focus Lock · best {today?.focus_lock_best ?? 0}
          </Text>
        </View>
      </View>

      {/* Today's sessions */}
      <View style={styles.historyCard} testID="focus-history-card">
        <View style={styles.historyHeader}>
          <Text style={styles.historyTitle}>Today&apos;s sessions 🕥</Text>
          {!!today && today.sessions.length > 0 && (
            <Text style={styles.historyTotal}>{today.total_minutes}m · +{today.total_xp} XP</Text>
          )}
        </View>
        {!today || today.sessions.length === 0 ? (
          <Text style={styles.historyEmpty}>No focus sessions yet today — start one above 🌱</Text>
        ) : (
          today.sessions.map((s) => (
            <View key={s.session_id} style={styles.historyRow} testID="focus-history-row">
              <Text style={styles.historyTime}>
                {s.created_at
                  ? new Date(s.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : "—"}
              </Text>
              <Text style={styles.historyDur}>{s.duration_minutes} min</Text>
              <Text style={styles.historyXp}>+{s.xp_earned} XP</Text>
            </View>
          ))
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>

      {/* Locked full-screen focus mode */}
      <FocusLockOverlay
        visible={lockedOpen && running}
        mins={mins}
        secs={secs}
        pct={pct}
        minutes={duration}
        onGiveUp={killTree}
      />

      {/* iOS Guided Access helper before locking in */}
      <GuidedAccessSheet
        visible={guideMinutes !== null}
        minutes={guideMinutes ?? 0}
        onStart={() => {
          const m = guideMinutes ?? 25;
          setGuideMinutes(null);
          beginSession(m);
        }}
        onCancel={() => setGuideMinutes(null)}
        onNeverShow={() => {
          const m = guideMinutes ?? 25;
          setGuideHidden(true);
          AsyncStorage.setItem(GUIDE_HIDDEN_KEY, "1").catch(() => {});
          setGuideMinutes(null);
          beginSession(m);
        }}
      />

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
  body: { paddingBottom: spacing.xxl },
  streakCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: "#FFF7ED", borderRadius: radius.lg, borderWidth: 2, borderColor: "#FED7AA",
    padding: spacing.md, marginTop: spacing.md,
  },
  streakBig: { fontSize: 26, fontWeight: "800", color: "#C2410C" },
  streakTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  streakSub: { fontSize: 12, color: colors.onSurfaceMuted, marginTop: 2 },
  historyCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.md,
  },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  historyTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  historyTotal: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary },
  historyEmpty: { fontSize: 13, color: colors.onSurfaceMuted },
  historyRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border,
  },
  historyTime: { fontSize: 13, color: colors.onSurfaceMuted, fontWeight: "700", width: 80 },
  historyDur: { fontSize: 14, color: colors.onSurface, fontWeight: "700", flex: 1, textAlign: "center" },
  historyXp: { fontSize: 13, color: colors.brandPrimary, fontWeight: "800" },
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
  clockInput: {
    fontSize: 46, fontWeight: "800", color: colors.onSurface, letterSpacing: -1,
    textAlign: "center", minWidth: 130, paddingVertical: 0,
    borderBottomWidth: 3, borderBottomColor: colors.brandSecondary,
  },
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
    paddingVertical: 18, borderRadius: radius.pill, marginTop: spacing.md, marginBottom: spacing.md,
    shadowColor: colors.brandSecondary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  startText: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  lockCard: {
    backgroundColor: "#FEF2F2", borderRadius: radius.lg, borderWidth: 2, borderColor: "#FECACA",
    padding: spacing.md, marginBottom: spacing.sm,
  },
  lockCardActive: { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" },
  lockCardOff: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  lockTitleOff: { color: colors.onSurface },
  lockTextOff: { color: colors.onSurfaceMuted },
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
