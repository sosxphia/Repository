import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";

const PRESETS = [15, 25, 45, 60];

export default function Timer() {
  const [duration, setDuration] = useState(25); // minutes
  const [remaining, setRemaining] = useState(25 * 60); // seconds
  const [running, setRunning] = useState(false);
  const [lastXp, setLastXp] = useState<number | null>(null);
  const intervalRef = useRef<any>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!running) setRemaining(duration * 60);
  }, [duration, running]);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleComplete = async (minutes: number) => {
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
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
    setRemaining(duration * 60);
  };

  const toggle = () => {
    if (running) {
      // Pause & optionally save partial (only if >= 1 minute elapsed)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const elapsedSec = duration * 60 - remaining;
      const elapsedMin = Math.floor(elapsedSec / 60);
      setRunning(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (elapsedMin >= 1) {
        apiFetch("/focus-sessions", {
          method: "POST",
          body: JSON.stringify({ duration_minutes: elapsedMin }),
        }).then((r) => setLastXp(r.xp_earned)).catch(() => {});
      }
      setRemaining(duration * 60);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setLastXp(null);
      setRunning(true);
      startedAtRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            handleComplete(duration);
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    }
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
          <Text style={styles.status}>{running ? "Focusing…" : "Ready when you are"}</Text>
        </LinearGradient>
      </View>

      {/* Duration presets */}
      {!running && (
        <View style={styles.presetsRow}>
          {PRESETS.map((m) => (
            <Pressable
              key={m}
              onPress={() => { Haptics.selectionAsync(); setDuration(m); }}
              style={[styles.presetPill, duration === m && styles.presetPillActive]}
              testID={`preset-${m}`}
            >
              <Text style={[styles.presetText, duration === m && styles.presetTextActive]}>{m}m</Text>
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

      <Pressable
        onPress={toggle}
        style={({ pressed }) => [
          styles.startBtn,
          { backgroundColor: running ? colors.error : colors.brandSecondary },
          pressed && { transform: [{ scale: 0.96 }] },
        ]}
        testID="timer-toggle-button"
      >
        <Ionicons name={running ? "stop" : "play"} size={22} color="#FFF" />
        <Text style={styles.startText}>{running ? "Stop" : "Start Focusing"}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  headerRow: { marginTop: spacing.md, marginBottom: spacing.lg },
  h1: { fontSize: 28, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2 },
  circleWrap: { alignItems: "center", justifyContent: "center", marginVertical: spacing.lg },
  circle: {
    width: 300, height: 300, borderRadius: 150, alignItems: "center", justifyContent: "center",
    borderWidth: 6, borderColor: "#FFF", padding: spacing.lg,
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 1, shadowRadius: 20, elevation: 6,
  },
  plantEmoji: { fontSize: 60, marginBottom: 4 },
  timeText: { fontSize: 56, fontWeight: "800", color: colors.onSurface, letterSpacing: -1 },
  circleProgressBg: { width: "80%", height: 8, backgroundColor: "rgba(255,255,255,0.7)", borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  circleProgressFill: { height: "100%", backgroundColor: colors.brandSecondary, borderRadius: radius.pill },
  status: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: spacing.sm, fontWeight: "600" },
  presetsRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", marginVertical: spacing.lg },
  presetPill: {
    paddingHorizontal: spacing.lg, paddingVertical: 12,
    borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: "transparent", minWidth: 64, alignItems: "center",
  },
  presetPillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  presetText: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  presetTextActive: { color: colors.onBrandPrimary },
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
});
