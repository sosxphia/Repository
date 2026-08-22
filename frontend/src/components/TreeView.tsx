import { View, Text } from "react-native";
import Svg, { Rect, Circle, Line, Ellipse, G, Path } from "react-native-svg";
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
  sky: string;
  canopyScale: number;
  showSnow?: boolean;
};

const PALETTES: Record<Season, Palette> = {
  spring: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#86EFAC", leafDark: "#22C55E", leafLight: "#DCFCE7",
    fruit: "#F472B6",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    sky: "#FEF3C7",
    canopyScale: 1.0,
  },
  summer: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#059669", leafDark: "#047857", leafLight: "#34D399",
    fruit: "#F59E0B",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    sky: "#FEF3C7",
    canopyScale: 1.0,
  },
  autumn: {
    trunk: "#78350F", trunkShadow: "#5C2A08",
    leafMain: "#EA580C", leafDark: "#9A3412", leafLight: "#FB923C",
    fruit: "#DC2626",
    ground: "#FEF3C7", ground2: "#FDE68A",
    sky: "#FED7AA",
    canopyScale: 0.95,
  },
  winter: {
    trunk: "#57534E", trunkShadow: "#44403C",
    leafMain: "#94A3B8", leafDark: "#64748B", leafLight: "#E2E8F0",
    fruit: "#F8FAFC",
    ground: "#F1F5F9", ground2: "#E2E8F0",
    sky: "#E0F2FE",
    canopyScale: 0.6,
    showSnow: true,
  },
};

type Props = {
  stage: Stage;
  xp: number;
  goals: { goal_id: string; title: string }[];
  width?: number;
  height?: number;
  season?: Season;
  labelsOnBranches?: boolean;
};

// Giant scrollable canvas
const CANVAS_W = 360;
const CANVAS_H = 1200;      // tall canvas for scrolling journey
const GROUND_Y = 1160;
const TRUNK_W_BASE = 44;    // fat trunk

// Trunk top Y by stage — how tall the tree currently is
const TRUNK_TOP_BY_STAGE: Record<Stage, number> = {
  seed: GROUND_Y - 20,
  sprout: GROUND_Y - 150,
  sapling: GROUND_Y - 500,
  bloom: GROUND_Y - 900,
};

// Canopy radius by stage
const CANOPY_R_BY_STAGE: Record<Stage, number> = {
  seed: 0,
  sprout: 40,
  sapling: 90,
  bloom: 160,
};

export function TreeView({
  stage,
  xp,
  goals,
  width = CANVAS_W,
  height,
  season,
  labelsOnBranches = true,
}: Props) {
  const activeSeason = season ?? seasonNow();
  const p = PALETTES[activeSeason];

  const trunkTopY = TRUNK_TOP_BY_STAGE[stage];
  const canopyR = CANOPY_R_BY_STAGE[stage] * p.canopyScale;
  const cx = CANVAS_W / 2;

  const trunkH = GROUND_Y - trunkTopY;
  const trunkW = TRUNK_W_BASE * (stage === "seed" ? 0.3 : stage === "sprout" ? 0.5 : stage === "sapling" ? 0.75 : 1);

  // Determine how many branches to display — no artificial cap now, tree is giant
  const maxBranches = stage === "seed" ? 0 : stage === "sprout" ? 3 : stage === "sapling" ? 12 : 30;
  const visibleGoals = goals.slice(0, maxBranches);

  // Branches distributed along the visible trunk (bottom 90% so canopy doesn't hide them)
  const branchTopY = trunkTopY + trunkH * 0.05;
  const branchBotY = GROUND_Y - trunkH * 0.08;
  const branches = visibleGoals.map((g, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = maxBranches > 1 ? i / (maxBranches - 1) : 0.5;
    const y = branchBotY - spread * (branchBotY - branchTopY);
    const branchLen = 60 + Math.min(canopyR * 0.35, 40);
    // Alternate angle a bit so branches don't overlap perfectly
    const angleDeg = 25 + (i % 4) * 6;
    const rad = (angleDeg * Math.PI) / 180;
    const endX = cx + side * Math.cos(rad) * branchLen;
    const endY = y - Math.sin(rad) * branchLen;
    // Leaf cluster radius
    const leafR = 12 + (spread * 4);
    return {
      key: g.goal_id,
      title: g.title,
      side,
      startX: cx + side * (trunkW / 2 - 2),
      startY: y,
      endX,
      endY,
      leafR,
    };
  });

  const finalHeight = height ?? Math.round((CANVAS_H / CANVAS_W) * width);

  // Seed stage — small mound near the bottom, still on the giant canvas
  if (stage === "seed") {
    return (
      <View style={{ width, height: finalHeight, alignSelf: "center" }} testID="tree-svg">
        <Svg width={width} height={finalHeight} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={p.sky} />
          <Ellipse cx={cx} cy={GROUND_Y + 24} rx={180} ry={40} fill={p.ground} />
          <Ellipse cx={cx} cy={GROUND_Y + 14} rx={140} ry={26} fill={p.ground2} />
          <Ellipse cx={cx} cy={GROUND_Y + 4} rx={60} ry={16} fill="#A16207" />
          <Ellipse cx={cx} cy={GROUND_Y - 4} rx={44} ry={10} fill="#78350F" />
          <Rect x={cx - 3} y={GROUND_Y - 28} width={6} height={28} rx={3} fill={p.leafDark} />
          <Ellipse cx={cx - 14} cy={GROUND_Y - 26} rx={14} ry={7} fill={p.leafMain} transform={`rotate(-25 ${cx - 14} ${GROUND_Y - 26})`} />
          <Ellipse cx={cx + 14} cy={GROUND_Y - 32} rx={14} ry={7} fill={p.leafLight} transform={`rotate(25 ${cx + 14} ${GROUND_Y - 32})`} />
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width, height: finalHeight, alignSelf: "center" }} testID="tree-svg">
      <Svg width={width} height={finalHeight} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
        {/* Sky background */}
        <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={p.sky} />

        {/* Distant hills (parallax feel) */}
        <Ellipse cx={80} cy={GROUND_Y + 40} rx={150} ry={40} fill={p.ground2} opacity={0.5} />
        <Ellipse cx={CANVAS_W - 60} cy={GROUND_Y + 30} rx={130} ry={36} fill={p.ground2} opacity={0.5} />

        {/* Ground */}
        <Ellipse cx={cx} cy={GROUND_Y + 30} rx={210} ry={48} fill={p.ground} />
        <Ellipse cx={cx} cy={GROUND_Y + 20} rx={180} ry={32} fill={p.ground2} />

        {/* Fat organic trunk (curvy path so it doesn't look like a rectangle) */}
        <Path
          d={`
            M ${cx - trunkW / 2} ${GROUND_Y}
            Q ${cx - trunkW / 2 - 6} ${trunkTopY + trunkH * 0.5}, ${cx - trunkW / 2 + 2} ${trunkTopY + trunkH * 0.15}
            Q ${cx - trunkW / 2 + 6} ${trunkTopY}, ${cx} ${trunkTopY - 6}
            Q ${cx + trunkW / 2 - 6} ${trunkTopY}, ${cx + trunkW / 2 - 2} ${trunkTopY + trunkH * 0.15}
            Q ${cx + trunkW / 2 + 6} ${trunkTopY + trunkH * 0.5}, ${cx + trunkW / 2} ${GROUND_Y}
            Z
          `}
          fill={p.trunkShadow}
        />
        <Path
          d={`
            M ${cx - trunkW / 2 + 3} ${GROUND_Y}
            Q ${cx - trunkW / 2 - 2} ${trunkTopY + trunkH * 0.5}, ${cx - trunkW / 2 + 6} ${trunkTopY + trunkH * 0.15}
            Q ${cx - trunkW / 2 + 8} ${trunkTopY + 4}, ${cx} ${trunkTopY - 2}
            Q ${cx + trunkW / 2 - 8} ${trunkTopY + 4}, ${cx + trunkW / 2 - 6} ${trunkTopY + trunkH * 0.15}
            Q ${cx + trunkW / 2 + 2} ${trunkTopY + trunkH * 0.5}, ${cx + trunkW / 2 - 3} ${GROUND_Y}
            Z
          `}
          fill={p.trunk}
        />

        {/* Trunk texture: knots and grain lines */}
        {stage !== "sprout" && (
          <G opacity={0.35}>
            <Ellipse cx={cx - trunkW * 0.15} cy={GROUND_Y - trunkH * 0.35} rx={5} ry={7} fill={p.trunkShadow} />
            <Ellipse cx={cx + trunkW * 0.2} cy={GROUND_Y - trunkH * 0.6} rx={4} ry={6} fill={p.trunkShadow} />
            <Line x1={cx - trunkW * 0.3} y1={GROUND_Y - trunkH * 0.15} x2={cx - trunkW * 0.3} y2={GROUND_Y - trunkH * 0.55} stroke={p.trunkShadow} strokeWidth={1} />
            <Line x1={cx + trunkW * 0.25} y1={GROUND_Y - trunkH * 0.2} x2={cx + trunkW * 0.25} y2={GROUND_Y - trunkH * 0.7} stroke={p.trunkShadow} strokeWidth={1} />
          </G>
        )}

        {/* Canopy — big layered cloud of leaves */}
        {canopyR > 0 && (
          <G>
            {/* Base darker layer */}
            <Circle cx={cx - canopyR * 0.7} cy={trunkTopY - canopyR * 0.15} r={canopyR * 0.75} fill={p.leafDark} />
            <Circle cx={cx + canopyR * 0.7} cy={trunkTopY - canopyR * 0.15} r={canopyR * 0.72} fill={p.leafDark} />
            <Circle cx={cx - canopyR * 0.35} cy={trunkTopY - canopyR * 0.8} r={canopyR * 0.65} fill={p.leafDark} />
            <Circle cx={cx + canopyR * 0.35} cy={trunkTopY - canopyR * 0.85} r={canopyR * 0.6} fill={p.leafDark} />
            {/* Main layer */}
            <Circle cx={cx} cy={trunkTopY - canopyR * 0.55} r={canopyR * 0.95} fill={p.leafMain} />
            <Circle cx={cx - canopyR * 0.5} cy={trunkTopY - canopyR * 0.35} r={canopyR * 0.6} fill={p.leafMain} />
            <Circle cx={cx + canopyR * 0.5} cy={trunkTopY - canopyR * 0.35} r={canopyR * 0.6} fill={p.leafMain} />
            {/* Highlights */}
            <Circle cx={cx - canopyR * 0.3} cy={trunkTopY - canopyR * 0.75} r={canopyR * 0.4} fill={p.leafLight} />
            <Circle cx={cx + canopyR * 0.35} cy={trunkTopY - canopyR * 0.7} r={canopyR * 0.35} fill={p.leafLight} />
            <Circle cx={cx} cy={trunkTopY - canopyR * 1.05} r={canopyR * 0.35} fill={p.leafLight} />
            {stage === "bloom" && (
              <G>
                <Circle cx={cx - canopyR * 0.45} cy={trunkTopY - canopyR * 0.4} r={7} fill={p.fruit} />
                <Circle cx={cx + canopyR * 0.5} cy={trunkTopY - canopyR * 0.5} r={7} fill={p.fruit} />
                <Circle cx={cx} cy={trunkTopY - canopyR * 0.9} r={7} fill={p.fruit} />
                <Circle cx={cx + canopyR * 0.15} cy={trunkTopY - canopyR * 0.15} r={7} fill={p.fruit} />
                <Circle cx={cx - canopyR * 0.2} cy={trunkTopY - canopyR * 0.6} r={6} fill={p.fruit} />
                <Circle cx={cx + canopyR * 0.75} cy={trunkTopY - canopyR * 0.1} r={6} fill={p.fruit} />
              </G>
            )}
          </G>
        )}

        {/* Branches per completed goal */}
        {branches.map((b) => (
          <G key={b.key}>
            {/* Branch line — organic, slightly thicker near the trunk */}
            <Line
              x1={b.startX} y1={b.startY}
              x2={b.endX} y2={b.endY}
              stroke={p.trunk} strokeWidth={5} strokeLinecap="round"
            />
            <Line
              x1={b.startX} y1={b.startY}
              x2={b.endX} y2={b.endY}
              stroke={p.trunkShadow} strokeWidth={2} strokeLinecap="round" opacity={0.4}
            />
            {/* Leaf cluster on the branch tip */}
            <Circle cx={b.endX} cy={b.endY} r={b.leafR} fill={p.leafDark} />
            <Circle cx={b.endX + b.side * 4} cy={b.endY - 3} r={b.leafR * 0.75} fill={p.leafMain} />
            <Circle cx={b.endX - b.side * 3} cy={b.endY - 5} r={b.leafR * 0.55} fill={p.leafLight} />
          </G>
        ))}

        {/* Autumn fallen leaves scattered along the ground */}
        {activeSeason === "autumn" && (
          <G opacity={0.9}>
            {[0.15, 0.32, 0.5, 0.68, 0.82].map((t, idx) => {
              const x = 40 + t * (CANVAS_W - 80);
              const y = GROUND_Y + 8 + (idx % 2) * 6;
              const rot = -30 + idx * 20;
              const col = [p.leafMain, p.leafLight, p.fruit, p.leafDark][idx % 4];
              return (
                <Ellipse key={`leaf-${idx}`} cx={x} cy={y} rx={8} ry={3} fill={col} transform={`rotate(${rot} ${x} ${y})`} />
              );
            })}
          </G>
        )}

        {/* Winter snowflakes drifting in the sky */}
        {p.showSnow && (
          <G>
            <Ellipse cx={cx} cy={GROUND_Y + 10} rx={190} ry={12} fill="#FFF" opacity={0.85} />
            {[[60, 220], [140, 90], [220, 300], [300, 160], [60, 480], [280, 520], [180, 700]].map(([x, y], i) => (
              <Circle key={`snow-${i}`} cx={x} cy={y} r={3} fill="#FFF" />
            ))}
            {[[100, 380], [240, 240], [80, 620], [300, 780], [180, 900]].map(([x, y], i) => (
              <Circle key={`snow2-${i}`} cx={x} cy={y} r={2} fill="#FFF" />
            ))}
          </G>
        )}
      </Svg>
    </View>
  );
}
