import { View } from "react-native";
import Svg, { Rect, Circle, Line, Ellipse, G } from "react-native-svg";
import { Stage } from "@/src/lib/plant";

export type Season = "spring" | "summer" | "autumn" | "winter";

export function seasonNow(month?: number): Season {
  const m = month ?? new Date().getMonth();
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter";
}

export const SEASON_LABELS: Record<Season, { label: string; emoji: string; chipBg: string; chipFg: string }> = {
  spring: { label: "Spring", emoji: "🌸", chipBg: "#FBCFE8", chipFg: "#9D174D" },
  summer: { label: "Summer", emoji: "☀️", chipBg: "#FEF3C7", chipFg: "#B45309" },
  autumn: { label: "Autumn", emoji: "🍂", chipBg: "#FED7AA", chipFg: "#9A3412" },
  winter: { label: "Winter", emoji: "❄️", chipBg: "#E0F2FE", chipFg: "#075985" },
};

type Palette = {
  trunk: string; trunkShadow: string;
  leafMain: string; leafDark: string; leafLight: string;
  fruit: string;
  ground: string; ground2: string;
  canopyScale: number; // how full the canopy renders
  showSnow?: boolean;
};

const PALETTES: Record<Season, Palette> = {
  spring: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#86EFAC", leafDark: "#22C55E", leafLight: "#DCFCE7",
    fruit: "#F472B6",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    canopyScale: 1.0,
  },
  summer: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#059669", leafDark: "#047857", leafLight: "#34D399",
    fruit: "#F59E0B",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    canopyScale: 1.0,
  },
  autumn: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#EA580C", leafDark: "#9A3412", leafLight: "#FB923C",
    fruit: "#DC2626",
    ground: "#FEF3C7", ground2: "#FDE68A",
    canopyScale: 0.92,
  },
  winter: {
    trunk: "#57534E", trunkShadow: "#44403C",
    leafMain: "#94A3B8", leafDark: "#64748B", leafLight: "#E2E8F0",
    fruit: "#F8FAFC",
    ground: "#F1F5F9", ground2: "#E2E8F0",
    canopyScale: 0.55,
    showSnow: true,
  },
};

type Props = {
  stage: Stage;
  xp: number;
  goals: { goal_id: string; title: string }[];
  size?: number;
  season?: Season;
};

const CANVAS_W = 260;
const CANVAS_H = 260;
const GROUND_Y = 240;

const TRUNK_BY_STAGE: Record<Stage, { h: number; w: number }> = {
  seed: { h: 4, w: 5 },
  sprout: { h: 26, w: 8 },
  sapling: { h: 60, w: 14 },
  bloom: { h: 100, w: 20 },
};

const CANOPY_BY_STAGE: Record<Stage, number> = {
  seed: 0,
  sprout: 16,
  sapling: 42,
  bloom: 70,
};

export function TreeView({ stage, xp, goals, size = CANVAS_W, season }: Props) {
  const activeSeason = season ?? seasonNow();
  const p = PALETTES[activeSeason];
  const trunk = TRUNK_BY_STAGE[stage];
  const canopyR = CANOPY_BY_STAGE[stage] * p.canopyScale;
  const trunkTopY = GROUND_Y - trunk.h;
  const cx = CANVAS_W / 2;

  const maxBranches = stage === "seed" ? 0 : stage === "sprout" ? 3 : stage === "sapling" ? 8 : 14;
  const visibleGoals = goals.slice(0, maxBranches);

  const branches = visibleGoals.map((g, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = maxBranches > 1 ? i / (maxBranches - 1) : 0.5;
    const offset = 0.2 + spread * 0.6;
    const y = GROUND_Y - trunk.h * offset;
    const branchLen = 22 + Math.min(canopyR * 0.4, 18);
    const angleDeg = 30 + (i % 3) * 8;
    const rad = (angleDeg * Math.PI) / 180;
    const endX = cx + side * Math.cos(rad) * branchLen;
    const endY = y - Math.sin(rad) * branchLen;
    return {
      key: g.goal_id,
      startX: cx + side * (trunk.w / 2 - 1),
      startY: y,
      endX,
      endY,
    };
  });

  // Seed stage
  if (stage === "seed") {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }} testID="tree-svg">
        <Svg width={size} height={size} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          <Ellipse cx={cx} cy={GROUND_Y + 6} rx={70} ry={10} fill={p.ground} />
          <Ellipse cx={cx} cy={GROUND_Y + 2} rx={22} ry={8} fill="#A16207" />
          <Ellipse cx={cx} cy={GROUND_Y - 1} rx={16} ry={5} fill="#78350F" />
          <Rect x={cx - 1.5} y={GROUND_Y - 10} width={3} height={10} rx={1.5} fill={p.leafDark} />
          <Ellipse cx={cx - 5} cy={GROUND_Y - 11} rx={5} ry={3} fill={p.leafMain} transform={`rotate(-25 ${cx - 5} ${GROUND_Y - 11})`} />
          <Ellipse cx={cx + 5} cy={GROUND_Y - 12} rx={5} ry={3} fill={p.leafLight} transform={`rotate(25 ${cx + 5} ${GROUND_Y - 12})`} />
          {p.showSnow && <>
            <Circle cx={cx - 30} cy={GROUND_Y - 40} r={2} fill="#FFF" />
            <Circle cx={cx + 40} cy={GROUND_Y - 60} r={1.5} fill="#FFF" />
            <Circle cx={cx - 60} cy={GROUND_Y - 80} r={2} fill="#FFF" />
          </>}
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }} testID="tree-svg">
      <Svg width={size} height={size} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
        {/* Ground */}
        <Ellipse cx={cx} cy={GROUND_Y + 8} rx={90} ry={12} fill={p.ground} />
        <Ellipse cx={cx} cy={GROUND_Y + 6} rx={70} ry={8} fill={p.ground2} />

        {/* Trunk */}
        <Rect x={cx - trunk.w / 2 - 1} y={trunkTopY} width={trunk.w + 2} height={trunk.h + 2} rx={trunk.w / 2} fill={p.trunkShadow} />
        <Rect x={cx - trunk.w / 2} y={trunkTopY} width={trunk.w} height={trunk.h} rx={trunk.w / 2} fill={p.trunk} />

        {/* Canopy */}
        {canopyR > 0 && (
          <G>
            <Circle cx={cx - canopyR * 0.55} cy={trunkTopY - canopyR * 0.25} r={canopyR * 0.75} fill={p.leafDark} />
            <Circle cx={cx + canopyR * 0.55} cy={trunkTopY - canopyR * 0.25} r={canopyR * 0.72} fill={p.leafDark} />
            <Circle cx={cx} cy={trunkTopY - canopyR * 0.55} r={canopyR * 0.85} fill={p.leafMain} />
            <Circle cx={cx - canopyR * 0.35} cy={trunkTopY - canopyR * 0.6} r={canopyR * 0.55} fill={p.leafLight} />
            <Circle cx={cx + canopyR * 0.3} cy={trunkTopY - canopyR * 0.7} r={canopyR * 0.45} fill={p.leafLight} />
            {stage === "bloom" && (
              <G>
                <Circle cx={cx - canopyR * 0.35} cy={trunkTopY - canopyR * 0.4} r={4} fill={p.fruit} />
                <Circle cx={cx + canopyR * 0.4} cy={trunkTopY - canopyR * 0.5} r={4} fill={p.fruit} />
                <Circle cx={cx} cy={trunkTopY - canopyR * 0.9} r={4} fill={p.fruit} />
                <Circle cx={cx + canopyR * 0.1} cy={trunkTopY - canopyR * 0.2} r={4} fill={p.fruit} />
              </G>
            )}
          </G>
        )}

        {/* Branches per completed goal */}
        {branches.map((b) => (
          <G key={b.key}>
            <Line x1={b.startX} y1={b.startY} x2={b.endX} y2={b.endY} stroke={p.trunk} strokeWidth={2.5} strokeLinecap="round" />
            <Circle cx={b.endX} cy={b.endY} r={5.5} fill={p.leafDark} />
            <Circle cx={b.endX - 1} cy={b.endY - 1.5} r={2.5} fill={p.leafLight} />
          </G>
        ))}

        {/* Autumn falling leaves */}
        {activeSeason === "autumn" && stage !== "sprout" && (
          <G opacity={0.9}>
            <Ellipse cx={cx - 60} cy={GROUND_Y - 8} rx={5} ry={2} fill={p.leafMain} transform={`rotate(-20 ${cx - 60} ${GROUND_Y - 8})`} />
            <Ellipse cx={cx + 55} cy={GROUND_Y - 6} rx={5} ry={2} fill={p.leafLight} transform={`rotate(30 ${cx + 55} ${GROUND_Y - 6})`} />
            <Ellipse cx={cx - 40} cy={GROUND_Y + 2} rx={4} ry={2} fill={p.fruit} transform={`rotate(15 ${cx - 40} ${GROUND_Y + 2})`} />
            <Ellipse cx={cx + 35} cy={GROUND_Y + 3} rx={4} ry={2} fill={p.leafDark} transform={`rotate(-40 ${cx + 35} ${GROUND_Y + 3})`} />
          </G>
        )}

        {/* Winter snow specks + snow-capped ground */}
        {p.showSnow && (
          <G>
            <Ellipse cx={cx} cy={GROUND_Y + 4} rx={72} ry={6} fill="#FFF" opacity={0.85} />
            <Circle cx={cx - 60} cy={40} r={2} fill="#FFF" />
            <Circle cx={cx + 60} cy={70} r={1.5} fill="#FFF" />
            <Circle cx={cx - 20} cy={20} r={2} fill="#FFF" />
            <Circle cx={cx + 40} cy={30} r={1.5} fill="#FFF" />
            <Circle cx={cx - 80} cy={100} r={2} fill="#FFF" />
            <Circle cx={cx + 90} cy={130} r={1.5} fill="#FFF" />
          </G>
        )}
      </Svg>
    </View>
  );
}
