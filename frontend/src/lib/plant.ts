export type Stage = "seed" | "sprout" | "sapling" | "bloom";

export const STAGE_EMOJI: Record<Stage, string> = {
  seed: "🌱",
  sprout: "🌿",
  sapling: "🪴",
  bloom: "🌸",
};

export const STAGE_LABEL: Record<Stage, string> = {
  seed: "Seed",
  sprout: "Sprout",
  sapling: "Sapling",
  bloom: "Bloom",
};

export function stageForXp(xp: number): Stage {
  if (xp < 50) return "seed";
  if (xp < 150) return "sprout";
  if (xp < 350) return "sapling";
  return "bloom";
}
