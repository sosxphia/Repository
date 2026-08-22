export type Stage = "seed" | "sprout" | "sapling" | "bloom";

// Kept as "bloom" internally for backend compatibility, but shown as "Fully Grown"
export const STAGE_LABEL: Record<Stage, string> = {
  seed: "Seed",
  sprout: "Sprout",
  sapling: "Sapling",
  bloom: "Fully Grown",
};

// Single-tree model: emoji progresses through the tree life cycle.
export function emojiFor(stage: Stage, _species?: string): string {
  switch (stage) {
    case "seed": return "🌱";
    case "sprout": return "🌿";
    case "sapling": return "🎋";
    case "bloom":
    default: return "🌳";
  }
}

export function stageForXp(xp: number): Stage {
  if (xp < 50) return "seed";
  if (xp < 150) return "sprout";
  if (xp < 350) return "sapling";
  return "bloom";
}

// Kept for backward compatibility of any imports elsewhere
export const STAGE_EMOJI: Record<Stage, string> = {
  seed: "🌱",
  sprout: "🌿",
  sapling: "🎋",
  bloom: "🌳",
};
