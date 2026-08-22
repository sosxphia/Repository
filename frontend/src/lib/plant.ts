export type Stage = "seed" | "sprout" | "sapling" | "bloom";
export type Species = "succulent" | "flower" | "cactus" | "tree";

export const STAGE_LABEL: Record<Stage, string> = {
  seed: "Seed",
  sprout: "Sprout",
  sapling: "Sapling",
  bloom: "Bloom",
};

type SpeciesInfo = { key: Species; label: string; sapling: string; bloom: string };

export const SPECIES_LIST: SpeciesInfo[] = [
  { key: "succulent", label: "Succulent", sapling: "🪴", bloom: "🌺" },
  { key: "flower", label: "Flower", sapling: "🌷", bloom: "🌸" },
  { key: "cactus", label: "Cactus", sapling: "🌵", bloom: "🌵" },
  { key: "tree", label: "Tree", sapling: "🌿", bloom: "🌳" },
];

const SPECIES_MAP = Object.fromEntries(SPECIES_LIST.map((s) => [s.key, s])) as Record<Species, SpeciesInfo>;

export function emojiFor(stage: Stage, species?: string): string {
  if (stage === "seed") return "🌱";
  if (stage === "sprout") return "🌿";
  const info = SPECIES_MAP[(species as Species) || "succulent"] || SPECIES_MAP.succulent;
  if (stage === "sapling") return info.sapling;
  return info.bloom;
}

export function stageForXp(xp: number): Stage {
  if (xp < 50) return "seed";
  if (xp < 150) return "sprout";
  if (xp < 350) return "sapling";
  return "bloom";
}

// Backwards-compat for anything still importing STAGE_EMOJI
export const STAGE_EMOJI: Record<Stage, string> = {
  seed: "🌱",
  sprout: "🌿",
  sapling: "🪴",
  bloom: "🌺",
};
