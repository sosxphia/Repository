import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/lib/theme";

type Props = {
  visible: boolean;
  mins: string;
  secs: string;
  pct: number;
  minutes: number;
  onGiveUp: () => void;
};

/** Full-screen locked focus mode — covers the tab bar, no back, exit kills the tree. */
export function FocusLockOverlay({ visible, mins, secs, pct, minutes, onGiveUp }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!visible) setConfirmOpen(false);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}} testID="focus-locked-screen">
      <LinearGradient colors={["#064E3B", "#065F46", "#047857"]} style={styles.fill}>
        <View style={styles.center}>
          <Text style={styles.badge}>🔒 LOCKED IN</Text>
          <Text style={styles.tree}>🌳</Text>
          <Text style={styles.time} testID="locked-timer-display">{mins}:{secs}</Text>
          <Text style={styles.sub}>{minutes} min focus session</Text>

          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
          </View>

          <Text style={styles.hint}>
            Stay in the app. Leaving for more than 60 seconds kills your tree — quick calls are
            forgiven.
          </Text>
          {Platform.OS === "ios" && (
            <Text style={styles.hintSmall}>
              Tip: triple-click the side button to lock iOS into this app with Guided Access.
            </Text>
          )}
        </View>

        <Pressable
          onPress={() => { Haptics.selectionAsync(); setConfirmOpen(true); }}
          style={styles.giveUpBtn}
          testID="give-up-button"
        >
          <Text style={styles.giveUpText}>Give up</Text>
        </Pressable>

      {confirmOpen && (
        <View style={styles.confirmWrap}>
          <View style={styles.confirmCard} testID="give-up-confirm-modal">
            <Text style={styles.confirmEmoji}>💔</Text>
            <Text style={styles.confirmTitle}>Quit and kill your tree?</Text>
            <Text style={styles.confirmText}>
              Ending the session early breaks Focus Lock. Your tree dies and your streak resets.
            </Text>
            <Pressable
              onPress={() => { setConfirmOpen(false); onGiveUp(); }}
              style={styles.confirmBtn}
              testID="give-up-confirm-button"
            >
              <Text style={styles.confirmBtnText}>Yes, quit</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmOpen(false)} style={styles.confirmGhost} testID="give-up-cancel-button">
              <Text style={styles.confirmGhostText}>Keep focusing</Text>
            </Pressable>
          </View>
        </View>
      )}
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  badge: {
    color: "#FFF", fontSize: 12, fontWeight: "800", letterSpacing: 2,
    backgroundColor: "rgba(255,255,255,0.18)", paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, overflow: "hidden",
  },
  tree: { fontSize: 64, marginTop: spacing.lg },
  time: { color: "#FFF", fontSize: 72, fontWeight: "800", letterSpacing: -2, marginTop: spacing.sm },
  sub: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "700" },
  barBg: {
    height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)",
    alignSelf: "stretch", marginTop: spacing.xl, overflow: "hidden",
  },
  barFill: { height: 8, borderRadius: 4, backgroundColor: "#FDE68A" },
  hint: { color: "rgba(255,255,255,0.9)", fontSize: 13, textAlign: "center", marginTop: spacing.xl, lineHeight: 19 },
  hintSmall: { color: "rgba(255,255,255,0.65)", fontSize: 12, textAlign: "center", marginTop: spacing.sm, lineHeight: 17 },
  giveUpBtn: {
    borderWidth: 2, borderColor: "rgba(255,255,255,0.4)", borderRadius: radius.pill,
    paddingVertical: 14, alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  giveUpText: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  confirmWrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  confirmCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", alignItems: "center" },
  confirmEmoji: { fontSize: 44 },
  confirmTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, textAlign: "center" },
  confirmText: { fontSize: 14, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  confirmBtn: {
    backgroundColor: colors.error, borderRadius: radius.pill, paddingVertical: 14,
    paddingHorizontal: spacing.xl, marginTop: spacing.lg, minHeight: 48, justifyContent: "center",
  },
  confirmBtnText: { color: "#FFF", fontWeight: "800", fontSize: 16 },
  confirmGhost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  confirmGhostText: { color: colors.onSurfaceMuted, fontWeight: "700" },
});
