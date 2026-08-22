import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/lib/theme";

export default function Login() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    try { await signInWithGoogle(); } finally { setBusy(false); }
  };

  return (
    <LinearGradient colors={["#FFF7DA", "#FFFCF6", "#DCFCE7"]} style={{ flex: 1 }} testID="login-screen">
      <SafeAreaView style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.emojiWrap}>
            <Text style={styles.bigEmoji}>🌱</Text>
          </View>
          <Text style={styles.title}>SproutGoals</Text>
          <Text style={styles.subtitle}>
            Grow a plant by crushing goals. Every task waters your sprout.
          </Text>
        </View>

        <View style={styles.featureCards}>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>⏱️</Text>
            <Text style={styles.featureText}>Focus timer feeds your plant</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>✅</Text>
            <Text style={styles.featureText}>Check off goals to grow XP</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>🌸</Text>
            <Text style={styles.featureText}>Grow a whole garden</Text>
          </View>
        </View>

        <Pressable
          onPress={handleGoogle}
          disabled={busy}
          style={({ pressed }) => [styles.googleBtn, pressed && { transform: [{ scale: 0.97 }] }]}
          testID="login-google-button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Ionicons name="logo-google" size={22} color={colors.onBrandPrimary} />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.hint}>Sign in to sync your garden across devices 🌿</Text>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xl, justifyContent: "space-between" },
  hero: { alignItems: "center", marginTop: spacing.xxl },
  emojiWrap: {
    width: 128, height: 128, borderRadius: radius.pill,
    backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "#FDE68A",
    marginBottom: spacing.lg,
  },
  bigEmoji: { fontSize: 72 },
  title: { fontSize: 36, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.5 },
  subtitle: {
    fontSize: 15, color: colors.onSurfaceMuted, textAlign: "center",
    marginTop: spacing.md, paddingHorizontal: spacing.md, lineHeight: 22,
  },
  featureCards: { gap: spacing.md, marginVertical: spacing.xl },
  featureRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  featureEmoji: { fontSize: 26, marginRight: spacing.md },
  featureText: { fontSize: 15, color: colors.onSurface, fontWeight: "600", flex: 1 },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: colors.brandPrimary, paddingVertical: 18,
    borderRadius: radius.pill, shadowColor: colors.brandPrimary,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  googleText: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "700" },
  hint: { textAlign: "center", fontSize: 13, color: colors.onSurfaceMuted, marginTop: spacing.md },
});
