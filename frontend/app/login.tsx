import { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, TextInput,
  ScrollView, KeyboardAvoidingView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/lib/theme";

export default function Login() {
  const { signInWithGoogle, signInWithApple, appleAvailable, signUpWithEmail, signInWithEmail } = useAuth();
  const [busy, setBusy] = useState<null | "google" | "apple" | "email">(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitEmail = async () => {
    setError(null);
    if (mode === "signup" && !name.trim()) { setError("Please enter your name"); return; }
    if (!email.trim().includes("@")) { setError("Please enter a valid email"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy("email");
    try {
      if (mode === "signup") await signUpWithEmail(email, password, name);
      else await signInWithEmail(email, password);
    } catch (e: any) {
      const msg = e?.message || "Something went wrong. Please try again.";
      setError(msg);
      if (Platform.OS !== "web") Alert.alert(mode === "signup" ? "Sign-up failed" : "Sign-in failed", msg);
    } finally {
      setBusy(null);
    }
  };

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
      <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.emojiWrap}>
            <Text style={styles.bigEmoji}>🌱</Text>
          </View>
          <Text style={styles.title}>Sproutly</Text>
          <Text style={styles.subtitle}>
            Grow a plant by crushing goals. Every task waters your sprout.
          </Text>
        </View>

        {/* Email + password */}
        <View style={styles.formCard}>
          <View style={styles.tabRow}>
            <Pressable
              onPress={() => { setMode("signup"); setError(null); }}
              style={[styles.tabBtn, mode === "signup" && styles.tabBtnActive]}
              testID="tab-signup"
            >
              <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Create account</Text>
            </Pressable>
            <Pressable
              onPress={() => { setMode("login"); setError(null); }}
              style={[styles.tabBtn, mode === "login" && styles.tabBtnActive]}
              testID="tab-login"
            >
              <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Sign in</Text>
            </Pressable>
          </View>

          {mode === "signup" && (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.onSurfaceMuted}
              maxLength={40}
              style={styles.input}
              testID="name-input"
            />
          )}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.onSurfaceMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
            testID="email-input"
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password (8+ characters)"
            placeholderTextColor={colors.onSurfaceMuted}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
            onSubmitEditing={submitEmail}
            testID="password-input"
          />

          {!!error && <Text style={styles.errorText} testID="auth-error">{error}</Text>}

          <Pressable
            onPress={submitEmail}
            disabled={busy !== null}
            style={({ pressed }) => [styles.emailBtn, pressed && { transform: [{ scale: 0.98 }] }]}
            testID="email-submit-button"
          >
            {busy === "email" ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.emailBtnText}>
                {mode === "signup" ? "Create my account 🌱" : "Sign in"}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
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
      </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl, justifyContent: "center", gap: spacing.md },
  hero: { alignItems: "center", marginTop: spacing.lg },
  formCard: {
    backgroundColor: "rgba(255,255,255,0.9)", borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  tabRow: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: "center", minHeight: 40, justifyContent: "center" },
  tabBtnActive: { backgroundColor: colors.surface },
  tabText: { fontSize: 13, fontWeight: "700", color: colors.onSurfaceMuted },
  tabTextActive: { color: colors.onSurface },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 15, fontWeight: "600",
    color: colors.onSurface, minHeight: 48,
  },
  errorText: { color: colors.error, fontSize: 13, fontWeight: "700", textAlign: "center" },
  emailBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 15,
    alignItems: "center", minHeight: 50, justifyContent: "center",
  },
  emailBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceMuted },
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
