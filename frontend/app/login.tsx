import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/lib/theme";

export default function Login() {
  const { signInWithGoogle, signInWithApple, appleAvailable } = useAuth();
  const [busy, setBusy] = useState<null | "google" | "apple">(null);

  const handleGoogle = async () => {
    setBusy("google");
    try { await signInWithGoogle(); } finally { setBusy(null); }
  };

  const handleApple = async () => {
    setBusy("apple");
    try { await signInWithApple(); }
    catch (e: any) {
      // Apple SDK throws with .code === 'ERR_REQUEST_CANCELED' when user backs out
      if (e?.code !== "ERR_REQUEST_CANCELED") console.log("apple err", e);
    } finally { setBusy(null); }
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
            <Text style={styles.featureEmoji}>🕥</Text>
            <Text style={styles.featureText}>Focus timer feeds your plant</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>✅</Text>
            <Text style={styles.featureText}>Check off goals to grow XP</Text>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>🌸</Text>
            <Text style={styles.featureText}>Grow a tree and improve the way you concentrate</Text>
          </View>
        </View>

        <Pressable
          onPress={handleGoogle}
          disabled={busy !== null}
          style={({ pressed }) => [styles.googleBtn, pressed && { transform: [{ scale: 0.97 }] }]}
          testID="login-google-button"
        >
          {busy === "google" ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <Ionicons name="logo-google" size={22} color={colors.onBrandPrimary} />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {Platform.OS === "ios" && appleAvailable && (
          <View style={styles.appleWrap} testID="login-apple-wrap">
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={999}
              style={styles.appleBtn}
              onPress={handleApple}
            />
            {busy === "apple" && (
              <View style={styles.appleBusy}><ActivityIndicator color="#FFF" /></View>
            )}
          </View>
        )}

        <Text style={styles.hint}>Sign in to sync your plant across devices 🌿</Text>
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
  appleWrap: { marginTop: spacing.md, position: "relative" },
  appleBtn: { width: "100%", height: 56 },
  appleBusy: {
    ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center",
  },
  hint: { textAlign: "center", fontSize: 13, color: colors.onSurfaceMuted, marginTop: spacing.md },
});
