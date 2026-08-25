import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radius } from "@/src/lib/theme";

type Props = {
  visible: boolean;
  minutes: number;
  xp: number;
  streak: number;
  totalMinutesToday: number;
  stage?: string | null;
  onClose: () => void;
};

/** Celebration shown when a focus session finishes. */
export function SessionRecap({ visible, minutes, xp, streak, totalMinutesToday, stage, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <LinearGradient colors={["#ECFDF5", "#D1FAE5", "#FEF3C7"]} style={styles.fill}>
        <View style={styles.center} testID="session-recap-screen">
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>Session complete!</Text>
          <Text style={styles.sub}>Your tree drank it all up 🌳</Text>

          <View style={styles.grid}>
            <View style={styles.cell}>
              <Text style={styles.cellValue} testID="recap-xp">+{xp}</Text>
              <Text style={styles.cellLabel}>XP earned</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellValue} testID="recap-minutes">{minutes}</Text>
              <Text style={styles.cellLabel}>Minutes focused</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellValue} testID="recap-streak">🔥 {streak}</Text>
              <Text style={styles.cellLabel}>Sessions in a row</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellValue} testID="recap-today">{totalMinutesToday}</Text>
              <Text style={styles.cellLabel}>Minutes today</Text>
            </View>
          </View>

          {!!stage && (
            <View style={styles.growthCard} testID="recap-growth">
              <Text style={styles.growthText}>Your tree is now at the {stage} stage 🌿</Text>
            </View>
          )}
        </View>

        <Pressable onPress={onClose} style={styles.btn} testID="recap-close-button">
          <Text style={styles.btnText}>Nice! Back to my tree</Text>
        </Pressable>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 64 },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  sub: { fontSize: 14, color: colors.onSurfaceMuted, marginTop: 4, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xl, justifyContent: "center" },
  cell: {
    backgroundColor: "rgba(255,255,255,0.85)", borderRadius: radius.lg,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: "center", minWidth: 140,
  },
  cellValue: { fontSize: 26, fontWeight: "800", color: colors.brandPrimary },
  cellLabel: { fontSize: 12, color: colors.onSurfaceMuted, fontWeight: "700", marginTop: 4 },
  growthCard: {
    backgroundColor: "rgba(255,255,255,0.85)", borderRadius: radius.lg,
    padding: spacing.md, marginTop: spacing.lg,
  },
  growthText: { fontSize: 14, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  btn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 18,
    alignItems: "center", minHeight: 56, justifyContent: "center",
  },
  btnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 17 },
});
