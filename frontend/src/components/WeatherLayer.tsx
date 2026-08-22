import { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";

export type Weather = "leaves" | "snow" | "blossoms" | "none";

type Particle = {
  startX: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
  drift: number;   // horizontal wobble amplitude
  rotate: boolean;
};

const AUTUMN_COLORS = ["#EA580C", "#FB923C", "#DC2626", "#F59E0B", "#9A3412"];
const BLOSSOM_COLORS = ["#F9A8D4", "#FBCFE8", "#FDA4AF", "#FCA5A5"];

function seedParticles(kind: Weather, w: number, count: number): Particle[] {
  return Array.from({ length: count }).map((_, i) => {
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    if (kind === "snow") {
      return {
        startX: rand(0, w),
        size: rand(3, 6),
        color: "#FFF",
        duration: rand(5000, 9000),
        delay: rand(0, 6000),
        drift: rand(10, 30),
        rotate: false,
      };
    }
    if (kind === "leaves") {
      return {
        startX: rand(0, w),
        size: rand(7, 12),
        color: AUTUMN_COLORS[i % AUTUMN_COLORS.length],
        duration: rand(6000, 10000),
        delay: rand(0, 7000),
        drift: rand(25, 55),
        rotate: true,
      };
    }
    if (kind === "blossoms") {
      return {
        startX: rand(0, w),
        size: rand(6, 10),
        color: BLOSSOM_COLORS[i % BLOSSOM_COLORS.length],
        duration: rand(7000, 11000),
        delay: rand(0, 8000),
        drift: rand(20, 45),
        rotate: true,
      };
    }
    return {
      startX: 0, size: 0, color: "", duration: 0, delay: 0, drift: 0, rotate: false,
    };
  });
}

function ParticleView({ p, height, kind }: { p: Particle; height: number; kind: Weather }) {
  const y = useRef(new Animated.Value(0)).current;
  const x = useRef(new Animated.Value(0)).current;
  const r = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = () => {
      y.setValue(0);
      x.setValue(0);
      r.setValue(0);
      Animated.parallel([
        Animated.timing(y, {
          toValue: 1,
          duration: p.duration,
          delay: p.delay,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(x, { toValue: 1, duration: p.duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(x, { toValue: -1, duration: p.duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        ),
        p.rotate
          ? Animated.loop(
              Animated.timing(r, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
            )
          : Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) loop();
      });
    };
    loop();
    return () => { y.stopAnimation(); x.stopAnimation(); r.stopAnimation(); };
  }, []);

  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 20] });
  const translateX = x.interpolate({ inputRange: [-1, 1], outputRange: [-p.drift, p.drift] });
  const rotate = r.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const isLeaf = kind === "leaves";
  const isBlossom = kind === "blossoms";
  const isSnow = kind === "snow";

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: p.startX,
          width: p.size * (isLeaf ? 2.2 : isBlossom ? 1.6 : 1),
          height: p.size * (isLeaf ? 1 : isBlossom ? 1.6 : 1),
          borderRadius: p.size,
          backgroundColor: p.color,
          opacity: isSnow ? 0.9 : 0.85,
          transform: [{ translateY }, { translateX }, { rotate }],
        },
      ]}
    />
  );
}

type Props = {
  kind: Weather;
  width: number;
  height: number;
  count?: number;
};

export function WeatherLayer({ kind, width, height, count }: Props) {
  if (kind === "none") return null;
  const n = count ?? (kind === "snow" ? 18 : kind === "leaves" ? 12 : 10);
  const particles = useRef(seedParticles(kind, width, n)).current;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
      {particles.map((p, i) => (
        <ParticleView key={`${kind}-${i}`} p={p} height={height} kind={kind} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: { position: "absolute", top: 0 },
});
