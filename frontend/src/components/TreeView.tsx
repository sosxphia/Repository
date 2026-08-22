import { View, Text } from "react-native";
import Svg, { Rect, Circle, Line, Ellipse, G } from "react-native-svg";
import { Stage } from "@/src/lib/plant";

type Props = {
  stage: Stage;
  xp: number;
  goals: { goal_id: string; title: string }[];
  size?: number;
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

// Palette that fits the cutesy warm theme
const TRUNK = "#78350F";
const TRUNK_SHADOW = "#5C2A08";
const LEAF_MAIN = "#059669";
const LEAF_DARK = "#047857";
const LEAF_LIGHT = "#34D399";
const FRUIT = "#F59E0B";

export function TreeView({ stage, xp, goals, size = CANVAS_W }: Props) {
  const trunk = TRUNK_BY_STAGE[stage];
  const canopyR = CANOPY_BY_STAGE[stage];
  const trunkTopY = GROUND_Y - trunk.h;
  const cx = CANVAS_W / 2;

  // How many branches to draw: min(goals.length, capacity by stage)
  const maxBranches = stage === "seed" ? 0 : stage === "sprout" ? 3 : stage === "sapling" ? 8 : 14;
  const visibleGoals = goals.slice(0, maxBranches);

  // Branches climb up the visible trunk (below canopy), alternating sides
  const branches = visibleGoals.map((g, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    // Spread branches along 20%–80% up from the ground on the trunk (avoids canopy overlap)
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
      title: g.title,
    };
  });

  // Seed stage: just show a tiny sprout with a leaf shoot
  if (stage === "seed") {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }} testID="tree-svg">
        <Svg width={size} height={size} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          {/* Ground */}
          <Ellipse cx={cx} cy={GROUND_Y + 6} rx={70} ry={10} fill="#DCFCE7" />
          {/* Seed / mound */}
          <Ellipse cx={cx} cy={GROUND_Y + 2} rx={22} ry={8} fill="#A16207" />
          <Ellipse cx={cx} cy={GROUND_Y - 1} rx={16} ry={5} fill="#78350F" />
          {/* Tiny sprout */}
          <Rect x={cx - 1.5} y={GROUND_Y - 10} width={3} height={10} rx={1.5} fill={LEAF_DARK} />
          <Ellipse cx={cx - 5} cy={GROUND_Y - 11} rx={5} ry={3} fill={LEAF_MAIN} transform={`rotate(-25 ${cx - 5} ${GROUND_Y - 11})`} />
          <Ellipse cx={cx + 5} cy={GROUND_Y - 12} rx={5} ry={3} fill={LEAF_LIGHT} transform={`rotate(25 ${cx + 5} ${GROUND_Y - 12})`} />
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }} testID="tree-svg">
      <Svg width={size} height={size} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
        {/* Ground shadow */}
        <Ellipse cx={cx} cy={GROUND_Y + 8} rx={90} ry={12} fill="#DCFCE7" />
        <Ellipse cx={cx} cy={GROUND_Y + 6} rx={70} ry={8} fill="#BBF7D0" />

        {/* Trunk (with subtle shadow) */}
        <Rect
          x={cx - trunk.w / 2 - 1}
          y={trunkTopY}
          width={trunk.w + 2}
          height={trunk.h + 2}
          rx={trunk.w / 2}
          fill={TRUNK_SHADOW}
        />
        <Rect
          x={cx - trunk.w / 2}
          y={trunkTopY}
          width={trunk.w}
          height={trunk.h}
          rx={trunk.w / 2}
          fill={TRUNK}
        />

        {/* Canopy (only if beyond sprout) — drawn BEFORE branches so branches can peek out */}
        {canopyR > 0 && (
          <G>
            <Circle cx={cx - canopyR * 0.55} cy={trunkTopY - canopyR * 0.25} r={canopyR * 0.75} fill={LEAF_DARK} />
            <Circle cx={cx + canopyR * 0.55} cy={trunkTopY - canopyR * 0.25} r={canopyR * 0.72} fill={LEAF_DARK} />
            <Circle cx={cx} cy={trunkTopY - canopyR * 0.55} r={canopyR * 0.85} fill={LEAF_MAIN} />
            <Circle cx={cx - canopyR * 0.35} cy={trunkTopY - canopyR * 0.6} r={canopyR * 0.55} fill={LEAF_LIGHT} />
            <Circle cx={cx + canopyR * 0.3} cy={trunkTopY - canopyR * 0.7} r={canopyR * 0.45} fill={LEAF_LIGHT} />
            {stage === "bloom" && (
              <G>
                <Circle cx={cx - canopyR * 0.35} cy={trunkTopY - canopyR * 0.4} r={4} fill={FRUIT} />
                <Circle cx={cx + canopyR * 0.4} cy={trunkTopY - canopyR * 0.5} r={4} fill={FRUIT} />
                <Circle cx={cx} cy={trunkTopY - canopyR * 0.9} r={4} fill={FRUIT} />
                <Circle cx={cx + canopyR * 0.1} cy={trunkTopY - canopyR * 0.2} r={4} fill={FRUIT} />
              </G>
            )}
          </G>
        )}

        {/* Branches per completed goal */}
        {branches.map((b) => (
          <G key={b.key}>
            <Line
              x1={b.startX} y1={b.startY}
              x2={b.endX} y2={b.endY}
              stroke={TRUNK} strokeWidth={2.5} strokeLinecap="round"
            />
            <Circle cx={b.endX} cy={b.endY} r={5.5} fill={LEAF_DARK} />
            <Circle cx={b.endX - 1} cy={b.endY - 1.5} r={2.5} fill={LEAF_LIGHT} />
          </G>
        ))}
      </Svg>
    </View>
  );
}
