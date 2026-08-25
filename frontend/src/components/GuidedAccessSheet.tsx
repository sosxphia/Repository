import { View, Text, StyleSheet, Modal, Pressable, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "@/src/lib/theme";

type Props = {
  visible: boolean;
  minutes: number;
  onStart: () => void;
  onCancel: () => void;
  onNeverShow: () => void;
};

const STEPS = [
  "Open Settings → Accessibility → Guided Access and turn it on (one time only)",
  "Come back here and triple-click the side button",
  "Tap Start — your phone stays locked in Sproutly",
  "Calls still ring, and triple-click again to end it",
];

/** iOS-only helper: Guided Access is the only real way to stop app switching. */
export function GuidedAccessSheet({ visible, minutes, onStart, onCancel, onNeverShow }: Props) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.sheet} testID="guided-access-sheet">
          <View style={styles.grabber} />
          <Text style={styles.emoji}>🔒</Text>
          <Text style={styles.title}>Lock your phone into Sproutly</Text>
          <Text style={styles.sub}>
            {minutes} min of focus. Guided Access lets iOS block app switching for real —
            emergency calls still come through.
          </Text>

          {STEPS.map((s, i) => (
            <View key={s} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{s}</Text>
            </View>
          ))}

          {Platform.OS === "ios" && (
            <Pressable onPress={() => Linking.openSettings()} style={styles.linkBtn} testID="guided-access-settings">
              <Ionicons name="settings-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.linkText}>Open Settings</Text>
            </Pressable>
          )}

          <Pressable onPress={onStart} style={styles.startBtn} testID="guided-access-start">
            <Text style={styles.startText}>Start focusing</Text>
          </Pressable>
          <Pressable onPress={onNeverShow} style={styles.ghost} testID="guided-access-never">
            <Text style={styles.ghostText}>Don&apos;t show this again</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: spacing.xl, paddingBottom: spacing.xxl, alignItems: "center",
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  emoji: { fontSize: 40 },
  title: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, textAlign: "center" },
  sub: { fontSize: 13, color: colors.onSurfaceMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 19 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md, alignSelf: "stretch" },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  stepNumText: { fontSize: 13, fontWeight: "800", color: colors.onBrandTertiary },
  stepText: { flex: 1, fontSize: 13, color: colors.onSurface, lineHeight: 18 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.lg, minHeight: 44, justifyContent: "center" },
  linkText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 14 },
  startBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 16,
    alignSelf: "stretch", alignItems: "center", marginTop: spacing.md, minHeight: 52, justifyContent: "center",
  },
  startText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 17 },
  ghost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  ghostText: { color: colors.onSurfaceMuted, fontWeight: "700", fontSize: 13 },
});
