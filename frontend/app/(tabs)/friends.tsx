import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, Alert,
  RefreshControl, ActivityIndicator, Linking, Platform, KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { CameraView, useCameraPermissions } from "expo-camera";
import { apiFetch } from "@/src/lib/api";
import { useSubscription } from "@/src/lib/revenuecat";
import { colors, spacing, radius } from "@/src/lib/theme";

type Me = { user_id: string; name: string; friend_code: string; qr_payload: string };
type Row = {
  user_id: string; name: string; real_name?: string; nickname?: string | null;
  xp: number; streak_days: number;
  focus_minutes_week: number; is_dead: boolean; is_me: boolean; rank: number;
};
type Req = { request_id: string; user_id: string; name: string };

export default function Friends() {
  const { isSubscribed } = useSubscription();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [incoming, setIncoming] = useState<Req[]>([]);
  const [outgoing, setOutgoing] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  // Nickname prompt: shown right after adding, and reusable from the leaderboard
  const [nickTarget, setNickTarget] = useState<
    { friendId: string | null; realName: string; requestId?: string; mode: "add" | "accept" | "edit" } | null
  >(null);
  const [nickInput, setNickInput] = useState("");
  const [savingNick, setSavingNick] = useState(false);
  const [actionRow, setActionRow] = useState<Row | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, lb, reqs] = await Promise.all([
        apiFetch("/friends/me"),
        apiFetch("/friends/leaderboard"),
        apiFetch("/friends/requests"),
      ]);
      setMe(m);
      setRows(lb.leaderboard || []);
      setIncoming(reqs.incoming || []);
      setOutgoing(reqs.outgoing || []);
    } catch (e) {
      console.log("friends load err", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sendRequest = async (raw: string, nickname?: string) => {
    const code = raw.trim();
    if (code.length < 6) {
      Alert.alert("Enter a code", "Friend codes are 6 characters long.");
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch("/friends/requests", {
        method: "POST",
        body: JSON.stringify({ code, nickname: nickname?.trim() || undefined }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCodeInput("");
      if (res.status === "accepted") {
        Alert.alert("You're friends! 🌱", `${res.friend_name} accepted your invite automatically.`);
      } else {
        Alert.alert("Request sent ✅", `${res.friend_name} needs to accept before you appear on each other's leaderboard.`);
      }
      load();
      return res;
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Couldn't send request", e?.message || "Please check the code and try again.");
    } finally {
      setSending(false);
    }
  };

  // Step 1 of adding: ask what to call them, then send the request
  const promptNicknameForCode = (code: string) => {
    const clean = code.trim();
    if (clean.length < 6) {
      Alert.alert("Enter a code", "Friend codes are 6 characters long.");
      return;
    }
    Haptics.selectionAsync();
    setNickInput("");
    setNickTarget({ friendId: null, realName: clean.toUpperCase(), mode: "add" });
    setPendingCode(clean);
  };

  const saveNickname = async (override?: string) => {
    if (!nickTarget) return;
    const nickname = (override ?? nickInput).trim();
    setSavingNick(true);
    try {
      if (nickTarget.mode === "add" && pendingCode) {
        await sendRequest(pendingCode, nickname);
      } else if (nickTarget.mode === "accept" && nickTarget.requestId) {
        await apiFetch(`/friends/requests/${nickTarget.requestId}/accept`, {
          method: "POST",
          body: JSON.stringify({ nickname: nickname || null }),
        });
        load();
      } else if (nickTarget.friendId) {
        await apiFetch(`/friends/${nickTarget.friendId}/nickname`, {
          method: "PATCH",
          body: JSON.stringify({ nickname: nickname || null }),
        });
        load();
      }
      setNickTarget(null);
      setPendingCode(null);
      setNickInput("");
    } catch (e: any) {
      Alert.alert("Couldn't save nickname", e?.message || "Please try again.");
    } finally {
      setSavingNick(false);
    }
  };

  const respond = async (req: Req, action: "accept" | "decline") => {
    Haptics.selectionAsync();
    if (action === "accept") {
      setNickInput("");
      setNickTarget({ friendId: req.user_id, realName: req.name, requestId: req.request_id, mode: "accept" });
      return;
    }
    setIncoming((prev) => prev.filter((r) => r.request_id !== req.request_id));
    try {
      await apiFetch(`/friends/requests/${req.request_id}/decline`, { method: "POST" });
    } catch (e) {
      console.log("respond err", e);
    }
    load();
  };

  const removeFriend = (row: Row) => {
    setActionRow(null);
    Alert.alert("Remove friend?", `${row.name} will no longer see your progress.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await apiFetch(`/friends/${row.user_id}`, { method: "DELETE" });
          } catch (e) {
            console.log("remove err", e);
          }
          load();
        },
      },
    ]);
  };

  const openScanner = async () => {
    Haptics.selectionAsync();
    if (permission?.granted) {
      setScanOpen(true);
      return;
    }
    if (permission && !permission.canAskAgain) {
      Alert.alert(
        "Camera access needed",
        "Enable camera access in Settings to scan a friend's QR code, or type their 6-character code instead.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    const res = await requestPermission();
    if (res.granted) setScanOpen(true);
    else if (!res.canAskAgain) {
      Alert.alert(
        "Camera access needed",
        "Enable camera access in Settings to scan QR codes, or use a friend code instead.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
    }
  };

  const onScanned = ({ data }: { data: string }) => {
    if (!scanOpen) return;
    setScanOpen(false);
    const code = data.includes(":") ? data.split(":").pop() || data : data;
    promptNicknameForCode(code);
  };

  const copyCode = async () => {
    if (!me) return;
    await Clipboard.setStringAsync(me.friend_code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copied!", `Share your code ${me.friend_code} with a friend.`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="friends-screen">
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        <Text style={styles.h1}>Friends</Text>
        <Text style={styles.subtitle}>Grow together and compare progress</Text>

        {/* My QR code */}
        <View style={styles.qrCard} testID="my-qr-card">
          <Text style={styles.cardTitle}>My code</Text>
          {!!me && (
            <View style={styles.qrBox}>
              <QRCode value={me.qr_payload} size={168} backgroundColor="#FFFFFF" color="#1F2937" />
            </View>
          )}
          <Pressable onPress={copyCode} style={styles.codePill} testID="friend-code-pill">
            <Text style={styles.codeText}>{me?.friend_code}</Text>
            <Ionicons name="copy-outline" size={16} color={colors.onBrandPrimary} />
          </Pressable>
          <Text style={styles.qrHint}>Let a friend scan this, or share the code</Text>
        </View>

        {/* Add a friend */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add a friend</Text>
          <Pressable onPress={openScanner} style={styles.scanBtn} testID="scan-qr-button">
            <Ionicons name="qr-code-outline" size={20} color="#FFF" />
            <Text style={styles.scanBtnText}>Scan their QR code</Text>
          </Pressable>
          <View style={styles.codeRow}>
            <TextInput
              value={codeInput}
              onChangeText={(t) => setCodeInput(t.toUpperCase())}
              placeholder="Enter code (e.g. 7KP2QX)"
              placeholderTextColor={colors.onSurfaceMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              style={styles.codeInput}
              onSubmitEditing={() => promptNicknameForCode(codeInput)}
              testID="friend-code-input"
            />
            <Pressable
              onPress={() => promptNicknameForCode(codeInput)}
              style={styles.codeGo}
              disabled={sending}
              testID="send-request-button"
            >
              {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.codeGoText}>Send</Text>}
            </Pressable>
          </View>
        </View>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <View style={styles.card} testID="incoming-requests">
            <Text style={styles.cardTitle}>Friend requests ({incoming.length})</Text>
            {incoming.map((r) => (
              <View key={r.request_id} style={styles.reqRow}>
                <Text style={styles.reqName}>{r.name}</Text>
                <View style={styles.reqBtns}>
                  <Pressable
                    onPress={() => respond(r, "accept")}
                    style={[styles.reqBtn, { backgroundColor: colors.brandSecondary }]}
                    testID={`accept-${r.request_id}`}
                  >
                    <Text style={styles.reqBtnText}>Accept</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond(r, "decline")}
                    style={[styles.reqBtn, { backgroundColor: colors.surfaceTertiary }]}
                    testID={`decline-${r.request_id}`}
                  >
                    <Text style={[styles.reqBtnText, { color: colors.onSurface }]}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {outgoing.length > 0 && (
          <View style={styles.card} testID="outgoing-requests">
            <Text style={styles.cardTitle}>Waiting on them</Text>
            {outgoing.map((r) => (
              <View key={r.request_id} style={styles.reqRow}>
                <Text style={styles.reqName}>{r.name}</Text>
                <Text style={styles.pendingText}>Pending…</Text>
              </View>
            ))}
          </View>
        )}

        {/* Leaderboard */}
        <View style={styles.card} testID="leaderboard-card">
          <Text style={styles.cardTitle}>Leaderboard</Text>
          <View style={styles.lbHead}>
            <Text style={[styles.lbHeadText, { width: 28 }]}>#</Text>
            <Text style={[styles.lbHeadText, { flex: 1 }]}>Name</Text>
            <Text style={[styles.lbHeadText, styles.lbNum]}>XP</Text>
            <Text style={[styles.lbHeadText, styles.lbNum]}>🔥</Text>
            <Text style={[styles.lbHeadText, styles.lbNum]}>Min</Text>
          </View>
          {rows.map((r) => (
            <Pressable
              key={r.user_id}
              onLongPress={() => { if (!r.is_me) { Haptics.selectionAsync(); setActionRow(r); } }}
              style={[styles.lbRow, r.is_me && styles.lbRowMe]}
              testID={`leaderboard-row-${r.rank}`}
            >
              <Text style={[styles.lbRank, { width: 28 }]}>{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbName} numberOfLines={1}>
                  {r.name}{r.is_me ? " (you)" : ""}{r.is_dead ? " 💔" : ""}
                </Text>
                {!!r.nickname && r.real_name && r.real_name !== r.nickname && (
                  <Text style={styles.lbRealName} numberOfLines={1}>{r.real_name}</Text>
                )}
              </View>
              {r.is_me && isSubscribed && (
                <View style={styles.proTag} testID="leaderboard-pro-badge">
                  <Text style={styles.proTagText}>PRO</Text>
                </View>
              )}
              <Text style={[styles.lbValue, styles.lbNum]}>{r.xp}</Text>
              <Text style={[styles.lbValue, styles.lbNum]}>{r.streak_days}</Text>
              <Text style={[styles.lbValue, styles.lbNum]}>{r.focus_minutes_week}</Text>
            </Pressable>
          ))}
          {rows.length <= 1 && (
            <Text style={styles.lbEmpty}>Add a friend to see how your trees stack up 🌱</Text>
          )}
          {rows.length > 1 && <Text style={styles.lbHint}>Hold down on a friend to remove them</Text>}
        </View>
      </ScrollView>

      {/* Nickname prompt (on add, on accept, or when renaming) */}
      <Modal transparent visible={nickTarget !== null} animationType="fade" onRequestClose={() => setNickTarget(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.nickWrap}
        >
          <View style={styles.nickCard} testID="nickname-modal">
            <Text style={styles.nickEmoji}>🏷️</Text>
            <Text style={styles.nickTitle}>
              {nickTarget?.mode === "edit" ? "Rename this friend" : "Give them a nickname"}
            </Text>
            <Text style={styles.nickSub}>
              {nickTarget?.mode === "add"
                ? `Only you will see it. Code ${nickTarget?.realName}`
                : `Only you will see it instead of ${nickTarget?.realName}`}
            </Text>
            <TextInput
              value={nickInput}
              onChangeText={setNickInput}
              placeholder="e.g. Study buddy"
              placeholderTextColor={colors.onSurfaceMuted}
              maxLength={24}
              autoFocus
              style={styles.nickInput}
              onSubmitEditing={() => saveNickname()}
              testID="nickname-input"
            />
            <Pressable onPress={() => saveNickname()} style={styles.nickSave} disabled={savingNick} testID="nickname-save">
              {savingNick ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.nickSaveText}>
                  {nickTarget?.mode === "add" ? "Send request" : "Save nickname"}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => saveNickname("")}
              style={styles.nickGhost}
              disabled={savingNick}
              testID="nickname-skip"
            >
              <Text style={styles.nickGhostText}>
                {nickTarget?.mode === "edit" ? "Clear nickname" : "Skip — use their real name"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Friend actions (long-press) */}
      <Modal transparent visible={actionRow !== null} animationType="fade" onRequestClose={() => setActionRow(null)}>
        <View style={styles.nickWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setActionRow(null)} />
          <View style={styles.nickCard} testID="friend-actions-modal">
            <Text style={styles.nickTitle}>{actionRow?.name}</Text>
            <Pressable
              onPress={() => {
                const row = actionRow;
                setActionRow(null);
                if (row) {
                  setNickInput(row.nickname || "");
                  setNickTarget({ friendId: row.user_id, realName: row.real_name || row.name, mode: "edit" });
                }
              }}
              style={styles.nickSave}
              testID="friend-action-rename"
            >
              <Text style={styles.nickSaveText}>Set nickname</Text>
            </Pressable>
            <Pressable
              onPress={() => actionRow && removeFriend(actionRow)}
              style={styles.removeBtn}
              testID="friend-action-remove"
            >
              <Text style={styles.removeBtnText}>Remove friend</Text>
            </Pressable>
            <Pressable onPress={() => setActionRow(null)} style={styles.nickGhost}>
              <Text style={styles.nickGhostText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* QR scanner */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.scanWrap}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.scanOverlay} pointerEvents="none">
            <View style={styles.scanFrame} />
          </View>
          <View style={styles.scanFooter}>
            <Text style={styles.scanTitle}>Point at your friend&apos;s QR code</Text>
            <Pressable onPress={() => setScanOpen(false)} style={styles.scanClose} testID="close-scanner-button">
              <Text style={styles.scanCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  body: { paddingBottom: spacing.xxl },
  h1: { fontSize: 28, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: 2, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md,
  },
  qrCard: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderWidth: 2, borderColor: "#FDE68A",
    padding: spacing.md, marginBottom: spacing.md, alignItems: "center",
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.sm, alignSelf: "flex-start" },
  qrBox: { backgroundColor: "#FFFFFF", padding: spacing.md, borderRadius: radius.md },
  codePill: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md,
    backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.pill, minHeight: 44,
  },
  codeText: { fontSize: 20, fontWeight: "800", letterSpacing: 3, color: colors.onBrandPrimary },
  qrHint: { fontSize: 12, color: colors.onBrandTertiary, marginTop: spacing.sm, fontWeight: "600" },
  scanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brandSecondary, borderRadius: radius.pill, paddingVertical: 14, minHeight: 48,
  },
  scanBtnText: { color: "#FFF", fontWeight: "800", fontSize: 16 },
  codeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  codeInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 16, fontWeight: "700",
    color: colors.onSurface, borderWidth: 2, borderColor: colors.border, letterSpacing: 2,
  },
  codeGo: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, justifyContent: "center", minHeight: 48, minWidth: 76, alignItems: "center",
  },
  codeGoText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
  reqRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border,
  },
  reqName: { fontSize: 15, fontWeight: "700", color: colors.onSurface, flex: 1 },
  reqBtns: { flexDirection: "row", gap: spacing.sm },
  reqBtn: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, minHeight: 40, justifyContent: "center" },
  reqBtnText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  pendingText: { fontSize: 13, color: colors.onSurfaceMuted, fontWeight: "700" },
  lbHead: { flexDirection: "row", alignItems: "center", paddingBottom: 6 },
  lbHeadText: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceMuted, textTransform: "uppercase" },
  lbNum: { width: 52, textAlign: "right" },
  lbRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  lbRowMe: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, paddingHorizontal: 6 },
  lbRank: { fontSize: 14, fontWeight: "800", color: colors.onSurface },
  lbName: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  lbRealName: { fontSize: 11, color: colors.onSurfaceMuted, fontWeight: "600", marginTop: 1 },
  nickWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  nickCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", alignItems: "center" },
  nickEmoji: { fontSize: 40 },
  nickTitle: { fontSize: 20, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm, textAlign: "center" },
  nickSub: { fontSize: 13, color: colors.onSurfaceMuted, textAlign: "center", marginTop: 6, lineHeight: 18 },
  nickInput: {
    alignSelf: "stretch", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    borderWidth: 2, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: 12,
    fontSize: 16, fontWeight: "700", color: colors.onSurface, marginTop: spacing.lg, textAlign: "center",
  },
  nickSave: {
    alignSelf: "stretch", backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    paddingVertical: 14, alignItems: "center", marginTop: spacing.md, minHeight: 48, justifyContent: "center",
  },
  nickSaveText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
  nickGhost: { paddingVertical: spacing.md, minHeight: 44, justifyContent: "center" },
  nickGhostText: { color: colors.onSurfaceMuted, fontWeight: "700", fontSize: 13 },
  removeBtn: {
    alignSelf: "stretch", borderRadius: radius.pill, borderWidth: 2, borderColor: colors.error,
    paddingVertical: 12, alignItems: "center", marginTop: spacing.sm, minHeight: 44, justifyContent: "center",
  },
  removeBtnText: { color: colors.error, fontWeight: "800", fontSize: 15 },
  lbValue: { fontSize: 14, fontWeight: "700", color: colors.onSurface },
  proTag: {
    backgroundColor: "#FBBF24", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2,
    marginRight: 6, borderWidth: 1, borderColor: "#D97706",
  },
  proTagText: { fontSize: 10, fontWeight: "800", color: "#7C2D12", letterSpacing: 0.5 },
  lbEmpty: { fontSize: 13, color: colors.onSurfaceMuted, marginTop: spacing.md },
  lbHint: { fontSize: 11, color: colors.onSurfaceMuted, marginTop: spacing.sm, fontWeight: "600" },
  scanWrap: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  scanFrame: { width: 240, height: 240, borderRadius: radius.lg, borderWidth: 3, borderColor: "#FFF" },
  scanFooter: { padding: spacing.lg, alignItems: "center", backgroundColor: "#000", gap: spacing.md },
  scanTitle: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  scanClose: {
    backgroundColor: "#FFF", borderRadius: radius.pill, paddingHorizontal: spacing.xl,
    paddingVertical: 12, minHeight: 44, justifyContent: "center",
  },
  scanCloseText: { color: "#111", fontWeight: "800", fontSize: 15 },
});
