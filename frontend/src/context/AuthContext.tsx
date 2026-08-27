import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { apiFetch, clearToken, saveToken } from "@/src/lib/api";

WebBrowser.maybeCompleteAuthSession();

type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  streak_days?: number;
  total_focus_minutes?: number;
  total_tasks_completed?: number;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  appleAvailable: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({} as AuthState);

export const useAuth = () => useContext(AuthContext);

function extractSessionId(url: string): string | null {
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const processed = useRef<Set<string>>(new Set());
  const capturedUrlRef = useRef<string | null>(null);

  const exchangeSessionId = useCallback(async (sid: string) => {
    if (processed.current.has(sid)) return;
    processed.current.add(sid);
    try {
      const data = await apiFetch("/auth/session", {
        method: "POST",
        body: JSON.stringify({ session_id: sid }),
      });
      await saveToken(data.session_token);
      setUser(data.user);
    } catch (e) {
      console.log("session exchange failed", e);
    }
  }, []);

  const checkExisting = useCallback(async () => {
    try {
      const u = await apiFetch("/auth/me");
      setUser(u);
    } catch {
      setUser(null);
      await clearToken();
    }
  }, []);

  useEffect(() => {
    let sub: any;
    (async () => {
      // Detect Apple Sign-In availability (iOS native only)
      try {
        if (Platform.OS === "ios") {
          const ok = await AppleAuthentication.isAvailableAsync();
          setAppleAvailable(ok);
        }
      } catch {}

      // Web: parse URL for session_id first
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const full = window.location.href;
        const sid = extractSessionId(full);
        if (sid) {
          await exchangeSessionId(sid);
          try {
            const url = new URL(window.location.href);
            url.hash = "";
            url.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", url.toString());
          } catch {}
        }
      } else {
        // Mobile: cold start
        const initial = await Linking.getInitialURL();
        if (initial) {
          const sid = extractSessionId(initial);
          if (sid) await exchangeSessionId(sid);
        }
        // Hot links
        sub = Linking.addEventListener("url", (evt) => {
          capturedUrlRef.current = evt.url;
          const sid = extractSessionId(evt.url);
          if (sid) exchangeSessionId(sid);
        });
      }
      await checkExisting();
      setLoading(false);
    })();
    return () => { if (sub?.remove) sub.remove(); };
  }, [checkExisting, exchangeSessionId]);

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirectUrl = Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    capturedUrlRef.current = null;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && (result as any).url) url = (result as any).url;
    if (!url) url = capturedUrlRef.current;
    if (!url) url = await Linking.getInitialURL();
    if (url) {
      const sid = extractSessionId(url);
      if (sid) await exchangeSessionId(sid);
    }
  }, [exchangeSessionId]);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== "ios") throw new Error("Apple Sign-In is iOS only");
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error("No identity token from Apple");
    const composedName = credential.fullName
      ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(" ").trim() || undefined
      : undefined;
    const data = await apiFetch("/auth/apple", {
      method: "POST",
      body: JSON.stringify({
        identity_token: credential.identityToken,
        name: composedName || null,
        email: credential.email || null,
      }),
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const data = await apiFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await apiFetch("/auth/logout", { method: "POST" }); } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    await checkExisting();
  }, [checkExisting]);

  return (
    <AuthContext.Provider value={{ user, loading, appleAvailable, signInWithGoogle, signInWithApple, signUpWithEmail, signInWithEmail, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
