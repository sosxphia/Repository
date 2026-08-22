import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius } from "@/src/lib/theme";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function StreakCalendar() {
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 });
  const [activeDays, setActiveDays] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/activity-calendar?year=${y}&month=${m}`);
      setActiveDays(data.active_days || []);
    } catch {
      setActiveDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(ym.y, ym.m); }, [load, ym]));

  const isCurrentMonth = ym.y === today.getFullYear() && ym.m === today.getMonth() + 1;

  const shift = (delta: number) => {
    Haptics.selectionAsync();
    setYm((prev) => {
      let m = prev.m + delta;
      let y = prev.y;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { y, m };
    });
  };

  const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
  const firstWeekday = new Date(ym.y, ym.m - 1, 1).getDay(); // 0 = Sunday
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <View style={styles.card} testID="streak-calendar">
      <View style={styles.header}>
        <Pressable onPress={() => shift(-1)} style={styles.chev} testID="calendar-prev">
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.monthTitle}>{MONTHS[ym.m - 1]} {ym.y}</Text>
        <Pressable
          onPress={() => !isCurrentMonth && shift(1)}
          style={[styles.chev, isCurrentMonth && { opacity: 0.25 }]}
          disabled={isCurrentMonth}
          testID="calendar-next"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={`w-${i}`} style={styles.weekday}>{w}</Text>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />
      ) : (
        <View style={styles.grid}>
          {cells.map((d, i) => {
            if (d === null) return <View key={`e-${i}`} style={styles.cell} />;
            const isActive = activeDays.includes(d);
            const isToday = isCurrentMonth && d === today.getDate();
            const isFuture = isCurrentMonth && d > today.getDate();
            return (
              <View key={`d-${d}`} style={styles.cell}>
                <View style={[
                  styles.dayDot,
                  isActive && styles.dayActive,
                  isToday && styles.dayToday,
                ]}>
                  <Text style={[
                    styles.dayText,
                    isActive && styles.dayTextActive,
                    isFuture && { opacity: 0.3 },
                  ]}>
                    {d}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: colors.brandSecondary }]} />
        <Text style={styles.legendText}>active day</Text>
        <View style={[styles.legendDot, { backgroundColor: "transparent", borderWidth: 2, borderColor: colors.brandPrimary }]} />
        <Text style={styles.legendText}>today</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  monthTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface },
  chev: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },
  weekRow: { flexDirection: "row", marginBottom: 4 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "800", color: colors.onSurfaceMuted },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 3 },
  dayDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayActive: { backgroundColor: colors.brandSecondary },
  dayToday: { borderWidth: 2, borderColor: colors.brandPrimary },
  dayText: { fontSize: 13, fontWeight: "600", color: colors.onSurface },
  dayTextActive: { color: "#FFF", fontWeight: "800" },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, justifyContent: "center" },
  legendDot: { width: 12, height: 12, borderRadius: 6, marginLeft: spacing.sm },
  legendText: { fontSize: 11, color: colors.onSurfaceMuted, fontWeight: "600" },
});
