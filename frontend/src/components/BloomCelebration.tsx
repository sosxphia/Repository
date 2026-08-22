import { useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Share, Dimensions, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import ConfettiCannon from "react-native-confetti-cannon";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius } from "@/src/lib/theme";
import { emojiFor } from "@/src/lib/plant";
import { apiFetch } from "@/src/lib/api";

const { width } = Dimensions.get("window");

type Props = {
  visible: boolean;
  plantId?: string;
  plantName: string;
  species?: string;
  xp: number;
  onClose: () => void;
};

export function BloomCelebration({ visible, plantId, plantName, species, xp, onClose }: Props) {
  const cannon = useRef<any>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible) {
      setNote("");
      setSaved(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => cannon.current?.start(), 300);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 400);
    }
  }, [visible]);

  const saveNote = async () => {
    if (!plantId || !note.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/plants/${plantId}`, { method: "PATCH", body: JSON.stringify({ note: note.trim() }) });
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {} finally { setSaving(false); }
  };

  const onShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `🌸 My plant "${plantName}" just fully bloomed on SproutGoals! ${xp} XP watered by focus sessions & goals crushed 🌱✨${note.trim() ? `\n\n"${note.trim()}"` : ""}`,
      });
    } catch {}
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View testID="bloom-celebration" style={{ width: "100%", alignItems: "center" }}>
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

          <View style={styles.noteWrap}>
            <Text style={styles.noteLabel}>📝 A memory to remember this bloom</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. finals week, learned to code, first marathon…"
              placeholderTextColor="#A16207"
              style={styles.noteInput}
              maxLength={200}
              multiline
              testID="bloom-note-input"
            />
            <Pressable
              onPress={saveNote}
              disabled={saving || !note.trim() || saved}
              style={({ pressed }) => [
                styles.saveNoteBtn,
                (saved || !note.trim()) && { opacity: 0.5 },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
              testID="bloom-save-note-button"
            >
              <Ionicons name={saved ? "checkmark-circle" : "bookmark"} size={16} color={colors.onBrandPrimary} />
              <Text style={styles.saveNoteText}>{saved ? "Saved to journal" : saving ? "Saving..." : "Save memory"}</Text>
            </Pressable>
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
        </View>

        <ConfettiCannon
          ref={cannon}
          count={140}
          origin={{ x: width / 2, y: 0 }}
          autoStart={false}
          fadeOut
          fallSpeed={3200}
          colors={["#F59E0B", "#10B981", "#F472B6", "#FDE047", "#FB923C"]}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%", maxWidth: 380, borderRadius: 28, padding: spacing.lg,
    alignItems: "center", borderWidth: 3, borderColor: "#FFF",
    shadowColor: "#F472B6", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  ribbon: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  ribbonText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  emoji: { fontSize: 80, marginTop: 6 },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.5 },
  plantName: { fontSize: 20, fontWeight: "700", color: "#7C2D12", marginTop: 2 },
  subtitle: { fontSize: 13, color: "#7C2D12", marginTop: 4, textAlign: "center", fontWeight: "600" },
  noteWrap: { alignSelf: "stretch", marginTop: spacing.md },
  noteLabel: { fontSize: 12, fontWeight: "700", color: "#7C2D12", marginBottom: 6 },
  noteInput: {
    backgroundColor: "rgba(255,255,255,0.85)", padding: spacing.md,
    borderRadius: radius.md, fontSize: 14, color: colors.onSurface,
    minHeight: 56, borderWidth: 1.5, borderColor: "#FDE68A",
  },
  saveNoteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.brand, paddingVertical: 10,
    borderRadius: radius.pill, marginTop: 8,
  },
  saveNoteText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandSecondary, paddingVertical: 14, paddingHorizontal: spacing.xl,
    borderRadius: radius.pill, alignSelf: "stretch", marginTop: spacing.md,
    shadowColor: colors.brandSecondary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  shareText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  doneBtn: { marginTop: 6, paddingVertical: 10, paddingHorizontal: spacing.lg },
  doneText: { color: "#7C2D12", fontSize: 13, fontWeight: "700" },
});
