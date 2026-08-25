import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";
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
  trunk: string; trunkDark: string; trunkLight: string;
  leafBase: string; leafMain: string; leafLight: string;
  fruit: string;
  ground: string; ground2: string;
  sky: string;
  canopyScale: number;
};

const PALETTES: Record<Season, Palette> = {
  spring: {
    trunk: "#8B4513", trunkDark: "#5C2E0A", trunkLight: "#B87333",
    leafBase: "#16A34A", leafMain: "#22C55E", leafLight: "#86EFAC",
    fruit: "#F472B6",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    sky: "#FEF7DA", canopyScale: 1.0,
  },
  summer: {
    trunk: "#8B4513", trunkDark: "#5C2E0A", trunkLight: "#B87333",
    leafBase: "#166534", leafMain: "#22C55E", leafLight: "#4ADE80",
    fruit: "#F59E0B",
    ground: "#DCFCE7", ground2: "#BBF7D0",
    sky: "#FEF7DA", canopyScale: 1.0,
  },
  autumn: {
    trunk: "#8B4513", trunkDark: "#5C2E0A", trunkLight: "#B87333",
    leafBase: "#B45309", leafMain: "#EA580C", leafLight: "#FB923C",
    fruit: "#DC2626",
    ground: "#FEF3C7", ground2: "#FDE68A",
    sky: "#FED7AA", canopyScale: 0.95,
  },
  winter: {
    trunk: "#57534E", trunkDark: "#44403C", trunkLight: "#78716C",
    leafBase: "#64748B", leafMain: "#94A3B8", leafLight: "#E2E8F0",
    fruit: "#F8FAFC",
    ground: "#F1F5F9", ground2: "#E2E8F0",
    sky: "#E0F2FE", canopyScale: 0.5,
  },
};

type Props = {
  stage: Stage;
  xp: number;
  branches: number;
  /** Days since the tree was planted — trunk thickens every 10 days, capped at day 100 */
  ageDays?: number;
  /** Streak was lost — render a wilted grey dead tree */
  isDead?: boolean;
  width?: number;
  season?: Season;
};

const CANVAS_W = 360;
// Fixed regions
const CANOPY_ZONE = 320;     // top canopy area
const GROUND_MARGIN = 60;    // ground padding at the bottom
const BRANCH_ROW_SPACING = 320; // one branch every ~320 viewBox units = 2 per screen at scale ~0.94
const FIRST_BRANCH_OFFSET = 260; // from canopy_zone
const BASE_TRUNK_H = 900;    // baseline trunk height (no branches)

// Base trunk width by stage
const TRUNK_BASE_W: Record<Stage, number> = {
  seed: 12, sprout: 34, sapling: 70, bloom: 100,
};

const CANOPY_R_BY_STAGE: Record<Stage, number> = {
  seed: 0, sprout: 55, sapling: 130, bloom: 200,
};

const MAX_BRANCHES_BY_STAGE: Record<Stage, number> = {
  seed: 0, sprout: 3, sapling: 12, bloom: 30,
};

function LeafyCloud({
  cx, cy, r, base, main, light, fruit, withFruit,
}: {
  cx: number; cy: number; r: number;
  base: string; main: string; light: string; fruit: string; withFruit: boolean;
}) {
  const bumps: [number, number, number][] = [
    [0, 0, r],
    [-r * 0.7, -r * 0.25, r * 0.75],
    [r * 0.7, -r * 0.2, r * 0.72],
    [-r * 0.5, -r * 0.75, r * 0.6],
    [r * 0.5, -r * 0.8, r * 0.6],
    [0, -r * 1.05, r * 0.55],
    [-r * 0.9, -r * 0.55, r * 0.5],
    [r * 0.9, -r * 0.5, r * 0.5],
    [-r * 0.2, r * 0.35, r * 0.55],
    [r * 0.25, r * 0.4, r * 0.5],
  ];
  return (
    <G>
      {bumps.map(([dx, dy, br], i) => (
        <Circle key={`b1-${i}`} cx={cx + dx} cy={cy + dy + 4} r={br} fill={base} />
      ))}
      {bumps.map(([dx, dy, br], i) => (
        <Circle key={`b2-${i}`} cx={cx + dx} cy={cy + dy} r={br * 0.9} fill={main} />
      ))}
      {bumps.slice(0, 6).map(([dx, dy, br], i) => (
        <Circle key={`b3-${i}`} cx={cx + dx + br * 0.15} cy={cy + dy - br * 0.3} r={br * 0.42} fill={light} />
      ))}
      {withFruit && (
        <G>
          <Circle cx={cx - r * 0.35} cy={cy - r * 0.3} r={6} fill={fruit} />
          <Circle cx={cx + r * 0.5} cy={cy - r * 0.5} r={6} fill={fruit} />
          <Circle cx={cx + r * 0.1} cy={cy - r * 0.85} r={6} fill={fruit} />
          <Circle cx={cx - r * 0.55} cy={cy + r * 0.2} r={5} fill={fruit} />
          <Circle cx={cx + r * 0.4} cy={cy + r * 0.25} r={5} fill={fruit} />
        </G>
      )}
    </G>
  );
}

// Horizontal tapered branch — thick at trunk, thin at tip. Small leaf clusters along it, NO terminal ball.
function HorizontalBranch({
  startX, y, length, side, palette,
}: {
  startX: number; y: number; length: number; side: 1 | -1; palette: Palette;
}) {
  const baseT = 22; // base thickness
  const tipT = 4;   // tip thickness
  const endX = startX + side * length;
  // Trapezoid path — organic branch shape
  const path = `
    M ${startX} ${y - baseT / 2}
    L ${endX} ${y - tipT / 2}
    L ${endX} ${y + tipT / 2}
    L ${startX} ${y + baseT / 2}
    Z
  `;
  return (
    <G>
      {/* Branch shadow */}
      <Path d={`M ${startX} ${y - baseT / 2 - 2} L ${endX} ${y - tipT / 2 - 1} L ${endX} ${y + tipT / 2 + 1} L ${startX} ${y + baseT / 2 + 2} Z`} fill={palette.trunkDark} />
      {/* Main branch */}
      <Path d={path} fill={palette.trunk} />
      {/* Highlight along top */}
      <Path
        d={`M ${startX + side * baseT * 0.3} ${y - baseT / 2 + 3} L ${endX - side * 4} ${y - tipT / 2 + 1} L ${endX - side * 4} ${y - tipT / 2 + 3} L ${startX + side * baseT * 0.3} ${y - baseT / 2 + 5} Z`}
        fill={palette.trunkLight}
        opacity={0.6}
      />
      {/* Individual leaves along the branch (proper leaf shapes, no balls) */}
      <Ellipse
        cx={startX + side * length * 0.4} cy={y - 10} rx={9} ry={4.5} fill={palette.leafMain}
        transform={`rotate(${side * -35} ${startX + side * length * 0.4} ${y - 10})`}
      />
      <Ellipse
        cx={startX + side * length * 0.55} cy={y + 7} rx={8} ry={4} fill={palette.leafBase}
        transform={`rotate(${side * 28} ${startX + side * length * 0.55} ${y + 7})`}
      />
      <Ellipse
        cx={startX + side * length * 0.72} cy={y - 9} rx={8.5} ry={4.2} fill={palette.leafLight}
        transform={`rotate(${side * -25} ${startX + side * length * 0.72} ${y - 9})`}
      />
      {/* Individual leaves near the tip */}
      <Ellipse
        cx={endX - side * 10} cy={y - 8} rx={9} ry={4.5} fill={palette.leafMain}
        transform={`rotate(${side * -28} ${endX - side * 10} ${y - 8})`}
      />
      <Ellipse
        cx={endX - side * 2} cy={y + 5} rx={8} ry={4} fill={palette.leafLight}
        transform={`rotate(${side * 30} ${endX - side * 2} ${y + 5})`}
      />
      <Ellipse
        cx={endX - side * 22} cy={y + 8} rx={7} ry={3.5} fill={palette.leafBase}
        transform={`rotate(${side * 18} ${endX - side * 22} ${y + 8})`}
      />
    </G>
  );
}

// Cozy bird hole in the trunk — dark oval hollow with a bark rim; optionally a little bird peeking out
function BirdHole({
  cx, cy, r, palette, withBird,
}: {
  cx: number; cy: number; r: number; palette: Palette; withBird?: boolean;
}) {
  return (
    <G>
      {/* Bark rim */}
      <Ellipse cx={cx} cy={cy} rx={r * 1.35} ry={r * 1.6} fill={palette.trunkDark} />
      {/* Hollow */}
      <Ellipse cx={cx} cy={cy} rx={r} ry={r * 1.25} fill="#2D1606" />
      <Ellipse cx={cx} cy={cy + r * 0.5} rx={r * 0.68} ry={r * 0.55} fill="#160A02" />
      {/* Rim highlight arc */}
      <Path
        d={`M ${cx - r * 1.15} ${cy - r * 0.55} Q ${cx} ${cy - r * 1.85}, ${cx + r * 1.15} ${cy - r * 0.55}`}
        stroke={palette.trunkLight} strokeWidth={3.5} fill="none" opacity={0.7} strokeLinecap="round"
      />
      {withBird && (
        <G>
          {/* Little bluebird peeking out */}
          <Circle cx={cx} cy={cy + r * 0.2} r={r * 0.58} fill="#60A5FA" />
          <Ellipse cx={cx - r * 0.12} cy={cy + r * 0.42} rx={r * 0.34} ry={r * 0.3} fill="#BFDBFE" />
          <Circle cx={cx + r * 0.22} cy={cy} r={r * 0.09} fill="#1F2937" />
          {/* Beak */}
          <Path
            d={`M ${cx + r * 0.52} ${cy + r * 0.12} l ${r * 0.38} ${r * 0.1} l ${-r * 0.34} ${r * 0.2} Z`}
            fill="#F59E0B"
          />
          {/* Wing */}
          <Ellipse
            cx={cx - r * 0.28} cy={cy + r * 0.18} rx={r * 0.26} ry={r * 0.16} fill="#3B82F6"
            transform={`rotate(-25 ${cx - r * 0.28} ${cy + r * 0.18})`}
          />
        </G>
      )}
    </G>
  );
}

// Detailed stump — root flares, bark ridges, cracks, moss, grass tufts and a mushroom
function StumpDetail({
  cx, groundY, baseW, palette,
}: {
  cx: number; groundY: number; baseW: number; palette: Palette;
}) {
  const h = baseW / 2;
  return (
    <G>
      {/* Soft shadow under the flare */}
      <Ellipse cx={cx} cy={groundY + 10} rx={h + 58} ry={11} fill={palette.trunkDark} opacity={0.12} />
      {/* Big root flares */}
      <Path
        d={`M ${cx - h + 6} ${groundY - 62}
            Q ${cx - h - 6} ${groundY - 24}, ${cx - h - 44} ${groundY + 4}
            L ${cx - h + 12} ${groundY + 8} Z`}
        fill={palette.trunk}
      />
      <Path
        d={`M ${cx + h - 6} ${groundY - 62}
            Q ${cx + h + 6} ${groundY - 24}, ${cx + h + 44} ${groundY + 4}
            L ${cx + h - 12} ${groundY + 8} Z`}
        fill={palette.trunk}
      />
      {/* Secondary knuckle roots */}
      <Path
        d={`M ${cx - h - 14} ${groundY - 12}
            Q ${cx - h - 40} ${groundY - 4}, ${cx - h - 62} ${groundY + 8}
            L ${cx - h - 10} ${groundY + 9} Z`}
        fill={palette.trunkDark}
      />
      <Path
        d={`M ${cx + h + 14} ${groundY - 12}
            Q ${cx + h + 40} ${groundY - 4}, ${cx + h + 62} ${groundY + 8}
            L ${cx + h + 10} ${groundY + 9} Z`}
        fill={palette.trunkDark}
      />
      {/* Highlights on flares */}
      <Path
        d={`M ${cx + h - 2} ${groundY - 48} Q ${cx + h + 4} ${groundY - 20}, ${cx + h + 30} ${groundY - 2}`}
        stroke={palette.trunkLight} strokeWidth={4} fill="none" opacity={0.55} strokeLinecap="round"
      />
      {/* Bark ridges rising from the base */}
      {[-0.55, -0.2, 0.15, 0.5].map((f, i) => (
        <Path
          key={`ridge-${i}`}
          d={`M ${cx + f * baseW * 0.85} ${groundY - 4} q ${f * 10} -42, ${f * 5} -${78 + (i % 2) * 18}`}
          stroke={palette.trunkDark} strokeWidth={3.5} fill="none" opacity={0.35} strokeLinecap="round"
        />
      ))}
      {/* Bark crack */}
      <Path
        d={`M ${cx - baseW * 0.06} ${groundY - 16} l -5 -22 l 7 -16 M ${cx - baseW * 0.06 - 5} ${groundY - 38} l -8 -12`}
        stroke={palette.trunkDark} strokeWidth={2.5} fill="none" opacity={0.5} strokeLinecap="round"
      />
      {/* Moss hugging the left base */}
      <Ellipse cx={cx - h + 2} cy={groundY - 6} rx={17} ry={7} fill={palette.leafBase} opacity={0.85} />
      <Ellipse cx={cx - h + 15} cy={groundY - 2} rx={11} ry={5} fill={palette.leafMain} opacity={0.85} />
      <Ellipse cx={cx - h - 8} cy={groundY - 1} rx={8} ry={4} fill={palette.leafMain} opacity={0.7} />
      {/* Grass tufts */}
      <G stroke={palette.leafMain} strokeWidth={3} strokeLinecap="round" fill="none">
        <Path d={`M ${cx - h - 66} ${groundY + 8} q -3 -10, -8 -14`} />
        <Path d={`M ${cx - h - 61} ${groundY + 8} q 0 -12, 1 -17`} />
        <Path d={`M ${cx - h - 56} ${groundY + 8} q 3 -9, 8 -12`} />
        <Path d={`M ${cx + h + 68} ${groundY + 8} q -3 -10, -6 -13`} />
        <Path d={`M ${cx + h + 73} ${groundY + 8} q 1 -12, 2 -16`} />
        <Path d={`M ${cx + h + 78} ${groundY + 8} q 4 -8, 9 -11`} />
      </G>
      {/* Cute mushroom by the right root */}
      <G>
        <Path d={`M ${cx + h + 28} ${groundY + 4} l 0 -13 l 9 0 l 0 13 Z`} fill="#FDE68A" />
        <Path d={`M ${cx + h + 21} ${groundY - 9} Q ${cx + h + 32.5} ${groundY - 27}, ${cx + h + 44} ${groundY - 9} Z`} fill="#EF4444" />
        <Circle cx={cx + h + 29} cy={groundY - 14} r={1.9} fill="#FFF" />
        <Circle cx={cx + h + 38} cy={groundY - 13} r={1.5} fill="#FFF" />
        <Circle cx={cx + h + 33} cy={groundY - 19} r={1.4} fill="#FFF" />
      </G>
      {/* Tiny pebbles */}
      <Ellipse cx={cx - h - 34} cy={groundY + 6} rx={6} ry={3.5} fill="#D6D3D1" />
      <Ellipse cx={cx - h - 26} cy={groundY + 8} rx={4} ry={2.5} fill="#A8A29E" />
    </G>
  );
}

// Withered sapling — tiny, bare seedling left after the streak broke
function DeadTree({ width }: { width: number }) {
  const H = 260;
  const GY = 196;
  const cx = CANVAS_W / 2;
  const finalHeight = Math.round((H / CANVAS_W) * width);
  const stem = "#8C7A6B";
  const stemDark = "#5C5148";
  const leafDry = "#A8A29E";
  const leafBrown = "#A16207";
  // Little seedling: bent bare stem only ~110px tall
  const topY = GY - 110;
  return (
    <View style={{ width, height: finalHeight, alignSelf: "center" }} testID="dead-tree-svg">
      <Svg width={width} height={finalHeight} viewBox={`0 0 ${CANVAS_W} ${H}`}>
        {/* Overcast sky */}
        <Path d={`M0 0 H${CANVAS_W} V${H} H0 Z`} fill="#F5F1EA" />
        {/* Grey hills */}
        <Ellipse cx={64} cy={GY + 34} rx={120} ry={26} fill="#D6D3D1" opacity={0.5} />
        <Ellipse cx={CANVAS_W - 56} cy={GY + 28} rx={104} ry={22} fill="#D6D3D1" opacity={0.5} />
        {/* Dry ground */}
        <Ellipse cx={cx} cy={GY + 22} rx={168} ry={32} fill="#E7E5E4" />
        <Ellipse cx={cx} cy={GY + 14} rx={140} ry={22} fill="#D6D3D1" />
        {/* Cracked soil mound */}
        <Ellipse cx={cx} cy={GY + 4} rx={52} ry={14} fill="#C7C1B8" />
        <G stroke="#A8A29E" strokeWidth={1.8} fill="none" opacity={0.8} strokeLinecap="round">
          <Path d={`M ${cx - 30} ${GY + 6} l 11 -4 l 8 4`} />
          <Path d={`M ${cx + 14} ${GY + 8} l 10 -5 l 11 3`} />
        </G>

        {/* Thin bent stem */}
        <Path
          d={`M ${cx - 4.5} ${GY + 2}
              C ${cx - 6} ${GY - 44}, ${cx + 8} ${topY + 40}, ${cx + 16} ${topY}
              L ${cx + 9} ${topY - 1}
              C ${cx + 2} ${topY + 39}, ${cx} ${GY - 45}, ${cx + 4} ${GY + 2} Z`}
          fill={stem}
        />
        {/* Snapped tip */}
        <Path
          d={`M ${cx + 9} ${topY} L ${cx + 12} ${topY - 14} L ${cx + 15} ${topY - 3} L ${cx + 17} ${topY + 1} Z`}
          fill={stemDark}
        />
        {/* Two bare drooping shoots */}
        <G stroke={stem} fill="none" strokeLinecap="round">
          <Path d={`M ${cx - 2} ${GY - 74} Q ${cx - 26} ${GY - 76}, ${cx - 36} ${GY - 58}`} strokeWidth={4.5} />
          <Path d={`M ${cx + 6} ${GY - 46} Q ${cx + 28} ${GY - 46}, ${cx + 38} ${GY - 28}`} strokeWidth={4} />
        </G>
        {/* Wilted, drooping leaves */}
        <G opacity={0.9}>
          <Ellipse cx={cx - 37} cy={GY - 52} rx={10} ry={4.5} fill={leafDry} transform={`rotate(72 ${cx - 37} ${GY - 52})`} />
          <Ellipse cx={cx + 39} cy={GY - 22} rx={9.5} ry={4} fill={leafDry} transform={`rotate(74 ${cx + 39} ${GY - 22})`} />
          <Ellipse cx={cx + 15} cy={topY + 16} rx={8} ry={3.5} fill={leafBrown} opacity={0.75} transform={`rotate(68 ${cx + 15} ${topY + 16})`} />
        </G>
        {/* Fallen dead leaves */}
        <G opacity={0.7}>
          <Ellipse cx={cx - 42} cy={GY + 9} rx={6.5} ry={3} fill="#A16207" transform={`rotate(-15 ${cx - 42} ${GY + 9})`} />
          <Ellipse cx={cx + 36} cy={GY + 12} rx={6} ry={3} fill="#92400E" transform={`rotate(20 ${cx + 36} ${GY + 12})`} />
          <Ellipse cx={cx - 12} cy={GY + 14} rx={5.5} ry={2.5} fill="#A16207" transform={`rotate(40 ${cx - 12} ${GY + 14})`} />
          <Ellipse cx={cx + 66} cy={GY + 8} rx={6} ry={3} fill="#78350F" transform={`rotate(-30 ${cx + 66} ${GY + 8})`} />
        </G>
      </Svg>
    </View>
  );
}

// Tiny leafy sprig growing from the side of the trunk
function TrunkSprig({
  x, y, side, palette,
}: {
  x: number; y: number; side: 1 | -1; palette: Palette;
}) {
  const tip = x + side * 28;
  return (
    <G>
      <Path
        d={`M ${x} ${y} Q ${x + side * 15} ${y - 6}, ${tip} ${y - 12}`}
        stroke={palette.trunkDark} strokeWidth={4} fill="none" strokeLinecap="round"
      />
      <Ellipse
        cx={tip - side * 6} cy={y - 18} rx={9} ry={5} fill={palette.leafMain}
        transform={`rotate(${side * -32} ${tip - side * 6} ${y - 18})`}
      />
      <Ellipse
        cx={tip + side * 2} cy={y - 8} rx={8} ry={4.5} fill={palette.leafLight}
        transform={`rotate(${side * 26} ${tip + side * 2} ${y - 8})`}
      />
      <Ellipse
        cx={tip - side * 14} cy={y - 5} rx={7} ry={4} fill={palette.leafBase}
        transform={`rotate(${side * 10} ${tip - side * 14} ${y - 5})`}
      />
    </G>
  );
}

export function TreeView({ stage, xp, branches: branchCount, ageDays = 0, isDead = false, width = CANVAS_W, season }: Props) {
  const activeSeason = season ?? seasonNow();
  const p = PALETTES[activeSeason];
  const cx = CANVAS_W / 2;

  if (isDead) {
    return <DeadTree width={width} />;
  }

  // Trunk thickens 8% every 10 days of the tree's life, capped at day 100 (up to 1.8x)
  const growthSteps = Math.floor(Math.min(Math.max(ageDays, 0), 100) / 10);
  const baseW = TRUNK_BASE_W[stage] * (1 + 0.08 * growthSteps);
  const canopyR = CANOPY_R_BY_STAGE[stage] * p.canopyScale;

  const maxBranches = MAX_BRANCHES_BY_STAGE[stage];
  const numBranches = Math.min(Math.max(0, branchCount), maxBranches);

  // Grow the canvas taller as branches are added
  const branchZoneStart = CANOPY_ZONE + FIRST_BRANCH_OFFSET; // where first branch lives
  const branchZoneEnd = branchZoneStart + Math.max(0, numBranches - 1) * BRANCH_ROW_SPACING;
  const trunkBottomY = Math.max(CANOPY_ZONE + BASE_TRUNK_H, branchZoneEnd + 240);
  const CANVAS_H = trunkBottomY + GROUND_MARGIN;
  const GROUND_Y = trunkBottomY;
  const trunkTopY = CANOPY_ZONE - 20;
  const trunkH = GROUND_Y - trunkTopY;

  const finalHeight = Math.round((CANVAS_H / CANVAS_W) * width);

  // SEED — small mound with sprout leaves
  if (stage === "seed") {
    return (
      <View style={{ width, height: finalHeight, alignSelf: "center" }} testID="tree-svg">
        <Svg width={width} height={finalHeight} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          <Path d={`M0 0 H${CANVAS_W} V${CANVAS_H} H0 Z`} fill={p.sky} />
          <Ellipse cx={cx} cy={GROUND_Y + 30} rx={210} ry={44} fill={p.ground} />
          <Ellipse cx={cx} cy={GROUND_Y + 18} rx={170} ry={28} fill={p.ground2} />
          <Ellipse cx={cx} cy={GROUND_Y + 6} rx={60} ry={16} fill="#A16207" />
          <Ellipse cx={cx} cy={GROUND_Y - 2} rx={44} ry={10} fill="#78350F" />
          <Path d={`M ${cx - 3} ${GROUND_Y - 3} L ${cx - 3} ${GROUND_Y - 30} L ${cx + 3} ${GROUND_Y - 30} L ${cx + 3} ${GROUND_Y - 3} Z`} fill={p.trunkDark} />
          <Ellipse cx={cx - 14} cy={GROUND_Y - 28} rx={14} ry={7} fill={p.leafMain} transform={`rotate(-25 ${cx - 14} ${GROUND_Y - 28})`} />
          <Ellipse cx={cx + 14} cy={GROUND_Y - 34} rx={14} ry={7} fill={p.leafLight} transform={`rotate(25 ${cx + 14} ${GROUND_Y - 34})`} />
        </Svg>
      </View>
    );
  }

  // Branch positions — alternating sides, thick horizontal, purely decorative
  const branches = Array.from({ length: numBranches }, (_, i) => {
    const side: 1 | -1 = i % 2 === 0 ? -1 : 1;
    const y = branchZoneStart + i * BRANCH_ROW_SPACING;
    const length = 130 + (i % 3) * 12; // slight length variation
    // Trunk gets wider as we go down (taper), so branch starts wider near ground
    const yFromGround = GROUND_Y - y;
    const trunkHalf = baseW / 2 * (0.65 + 0.35 * (yFromGround / trunkH));
    const startX = cx + side * (trunkHalf - 2);
    return { key: `br-${i}`, side, startX, y, length };
  });

  // Trunk half-width at a given y (linear taper from base to top)
  const topW = baseW * 0.55;
  const halfWAt = (y: number) => {
    const t = (GROUND_Y - y) / trunkH; // 0 at ground → 1 at top
    return (baseW / 2) * (1 - t) + (topW / 2) * t;
  };

  // Bird holes — spread along the trunk, first one has a little bird peeking
  const numHoles = Math.max(1, Math.min(5, Math.floor(trunkH / 800)));
  const holeR = Math.max(9, Math.min(16, baseW * 0.17));
  const birdHoles = Array.from({ length: numHoles }, (_, i) => {
    const y = trunkTopY + trunkH * ((i + 0.9) / (numHoles + 1.1));
    const dx = (i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0) * baseW * 0.1;
    return { key: `hole-${i}`, cx: cx + dx, cy: y, withBird: i === 0 };
  });

  // Leafy sprigs sprouting from the trunk sides, between branch rows
  const sprigs: { key: string; x: number; y: number; side: 1 | -1 }[] = [];
  for (let y = trunkTopY + 150, i = 0; y < GROUND_Y - 130; y += 190, i++) {
    // Skip if too close to a branch row (keep it uncluttered)
    const nearBranch = branches.some((b) => Math.abs(b.y - y) < 70);
    // Skip if too close to a bird hole
    const nearHole = birdHoles.some((h) => Math.abs(h.cy - y) < 60);
    if (nearBranch || nearHole) continue;
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    sprigs.push({ key: `sprig-${i}`, x: cx + side * (halfWAt(y) - 3), y, side });
  }

  return (
    <View style={{ width, height: finalHeight, alignSelf: "center", position: "relative" }} testID="tree-svg">
      <Svg width={width} height={finalHeight} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
        {/* Sky */}
        <Path d={`M0 0 H${CANVAS_W} V${CANVAS_H} H0 Z`} fill={p.sky} />

        {/* Distant hills */}
        <Ellipse cx={70} cy={GROUND_Y + 50} rx={160} ry={45} fill={p.ground2} opacity={0.55} />
        <Ellipse cx={CANVAS_W - 60} cy={GROUND_Y + 40} rx={140} ry={38} fill={p.ground2} opacity={0.55} />

        {/* Ground */}
        <Ellipse cx={cx} cy={GROUND_Y + 34} rx={220} ry={52} fill={p.ground} />
        <Ellipse cx={cx} cy={GROUND_Y + 22} rx={190} ry={36} fill={p.ground2} />

        {/* MAIN TRUNK — tapered from wide base to narrower top */}
        {(() => {
          const topW = baseW * 0.55;
          const midY = (trunkTopY + GROUND_Y) / 2;
          const midW = baseW * 0.75;
          const trunkPath = `
            M ${cx - baseW / 2} ${GROUND_Y}
            Q ${cx - midW / 2 - 4} ${midY + trunkH * 0.15}, ${cx - midW / 2} ${midY - trunkH * 0.05}
            Q ${cx - topW / 2 - 4} ${trunkTopY + trunkH * 0.2}, ${cx - topW / 2 + 2} ${trunkTopY + 4}
            L ${cx + topW / 2 - 2} ${trunkTopY + 4}
            Q ${cx + topW / 2 + 4} ${trunkTopY + trunkH * 0.2}, ${cx + midW / 2} ${midY - trunkH * 0.05}
            Q ${cx + midW / 2 + 4} ${midY + trunkH * 0.15}, ${cx + baseW / 2} ${GROUND_Y} Z
          `;
          return (
            <G>
              <Path d={trunkPath} fill={p.trunk} />
              {/* Dark side (left) */}
              <Path
                d={`M ${cx - baseW / 2} ${GROUND_Y}
                    Q ${cx - midW / 2 - 4} ${midY + trunkH * 0.15}, ${cx - midW / 2} ${midY - trunkH * 0.05}
                    Q ${cx - topW / 2 - 4} ${trunkTopY + trunkH * 0.2}, ${cx - topW / 2 + 2} ${trunkTopY + 4}
                    L ${cx - topW / 2 + 8} ${trunkTopY + 4}
                    Q ${cx - midW / 2 + 6} ${midY - trunkH * 0.05}, ${cx - midW / 2 + 4} ${midY + trunkH * 0.15}
                    Q ${cx - baseW / 2 + 8} ${GROUND_Y - 5}, ${cx - baseW / 2} ${GROUND_Y} Z`}
                fill={p.trunkDark}
                opacity={0.5}
              />
              {/* Light highlight (right) */}
              <Path
                d={`M ${cx + baseW * 0.1} ${GROUND_Y - 10}
                    Q ${cx + midW * 0.28} ${midY}, ${cx + topW * 0.2} ${trunkTopY + trunkH * 0.15}
                    L ${cx + topW * 0.05} ${trunkTopY + trunkH * 0.15}
                    Q ${cx + midW * 0.12} ${midY}, ${cx} ${GROUND_Y - 10} Z`}
                fill={p.trunkLight}
                opacity={0.5}
              />
              {/* Bark knots */}
              <G opacity={0.35}>
                <Ellipse cx={cx - baseW * 0.15} cy={midY - trunkH * 0.1} rx={5} ry={7} fill={p.trunkDark} />
                <Ellipse cx={cx + baseW * 0.2} cy={midY + trunkH * 0.15} rx={4} ry={6} fill={p.trunkDark} />
                <Ellipse cx={cx - baseW * 0.1} cy={midY + trunkH * 0.35} rx={4} ry={5} fill={p.trunkDark} />
              </G>
            </G>
          );
        })()}

        {/* Detailed stump — roots, ridges, moss, grass, mushroom (drawn over trunk base) */}
        {stage !== "sprout" && (
          <StumpDetail cx={cx} groundY={GROUND_Y} baseW={baseW} palette={p} />
        )}

        {/* CANOPY — bumpy cloud */}
        {canopyR > 0 && (
          <LeafyCloud
            cx={cx}
            cy={trunkTopY - canopyR * 0.35}
            r={canopyR}
            base={p.leafBase} main={p.leafMain} light={p.leafLight}
            fruit={p.fruit} withFruit={stage === "bloom"}
          />
        )}

        {/* Bird holes in the trunk */}
        {birdHoles.map((h) => (
          <BirdHole key={h.key} cx={h.cx} cy={h.cy} r={holeR} palette={p} withBird={h.withBird} />
        ))}

        {/* Leafy sprigs along the trunk */}
        {sprigs.map((s) => (
          <TrunkSprig key={s.key} x={s.x} y={s.y} side={s.side} palette={p} />
        ))}

        {/* HORIZONTAL BRANCHES — tapered, purely decorative */}
        {branches.map((b) => (
          <HorizontalBranch
            key={b.key}
            startX={b.startX}
            y={b.y}
            length={b.length}
            side={b.side}
            palette={p}
          />
        ))}
      </Svg>
    </View>
  );
}
