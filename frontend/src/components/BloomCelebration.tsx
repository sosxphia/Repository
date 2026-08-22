import { useRef, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Share, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import ConfettiCannon from "react-native-confetti-cannon";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/lib/theme";
import { emojiFor } from "@/src/lib/plant";

const { width } = Dimensions.get("window");

type Props = {
  visible: boolean;
  plantName: string;
  species?: string;
  xp: number;
  onClose: () => void;
};

export function BloomCelebration({ visible, plantName, species, xp, onClose }: Props) {
  const cannon = useRef<any>(null);

  useEffect(() => {
    if (visible) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => cannon.current?.start(), 300);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 400);
    }
  }, [visible]);

  const onShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `🌸 My plant "${plantName}" just fully bloomed on SproutGoals! ${xp} XP watered by focus sessions & goals crushed 🌱✨`,
      });
    } catch {}
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="bloom-celebration">
        <LinearGradient
          colors={["#FEF3C7", "#FBBF24", "#F472B6"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.ribbon}>
            <Ionicons name="star" size={14} color={colors.onBrandPrimary} />
            <Text style={styles.ribbonText}>FULL BLOOM</Text>
            <Ionicons name="star" size={14} color={colors.onBrandPrimary} />
          </View>

          <Text style={styles.emoji}>{emojiFor("bloom", species)}</Text>
          <Text style={styles.title}>Congratulations! 🎉</Text>
          <Text style={styles.plantName}>{plantName}</Text>
          <Text style={styles.subtitle}>bloomed after {xp} XP of focus and grit</Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}><Text style={styles.statEmoji}>🌱</Text><Text style={styles.statLabel}>Seed</Text></View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.stat}><Text style={styles.statEmoji}>🌿</Text><Text style={styles.statLabel}>Sprout</Text></View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.stat}><Text style={styles.statEmoji}>{emojiFor("bloom", species)}</Text><Text style={styles.statLabel}>Bloom</Text></View>
          </View>

          <Pressable
            onPress={onShare}
            style={({ pressed }) => [styles.shareBtn, pressed && { transform: [{ scale: 0.96 }] }]}
            testID="bloom-share-button"
          >
            <Ionicons name="share-social" size={18} color="#FFF" />
            <Text style={styles.shareText}>Share my bloom</Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.doneBtn, pressed && { transform: [{ scale: 0.96 }] }]}
            testID="bloom-close-button"
          >
            <Text style={styles.doneText}>Sweet, keep growing 🌱</Text>
          </Pressable>
        </LinearGradient>

        <ConfettiCannon
          ref={cannon}
          count={140}
          origin={{ x: width / 2, y: 0 }}
          autoStart={false}
          fadeOut
          fallSpeed={3200}
          colors={["#F59E0B", "#10B981", "#F472B6", "#FDE047", "#FB923C"]}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%", maxWidth: 380, borderRadius: 28, padding: spacing.xl,
    alignItems: "center", borderWidth: 3, borderColor: "#FFF",
    shadowColor: "#F472B6", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  ribbon: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    marginBottom: spacing.md,
  },
  ribbonText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  emoji: { fontSize: 100, marginVertical: spacing.sm },
  title: { fontSize: 26, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  plantName: { fontSize: 22, fontWeight: "700", color: "#7C2D12", marginTop: 4 },
  subtitle: { fontSize: 14, color: "#7C2D12", marginTop: 6, textAlign: "center", fontWeight: "600" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.lg, marginBottom: spacing.lg },
  stat: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.6)", padding: 8, borderRadius: radius.lg, minWidth: 62 },
  statEmoji: { fontSize: 24 },
  statLabel: { fontSize: 10, fontWeight: "700", color: "#7C2D12", marginTop: 2 },
  arrow: { fontSize: 18, color: "#7C2D12", fontWeight: "800" },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandSecondary, paddingVertical: 14, paddingHorizontal: spacing.xl,
    borderRadius: radius.pill, alignSelf: "stretch",
    shadowColor: colors.brandSecondary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  shareText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  doneBtn: { marginTop: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.lg },
  doneText: { color: "#7C2D12", fontSize: 14, fontWeight: "700" },
});
