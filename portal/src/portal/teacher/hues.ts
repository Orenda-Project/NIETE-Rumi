/** bd-fmf24g.1 — the seven Home features and their hues (canvas v28). */
export type ArtFeature = "lessons" | "coaching" | "observations" | "training" | "assessment" | "attendance" | "classes";

/** Feature hues (canvas v28): text = the hue, bg = its light tint. */
export const FEATURE_HUE: Record<ArtFeature, { fg: string; bg: string }> = {
  lessons: { fg: "#2f7a52", bg: "#eaf6ef" },
  coaching: { fg: "#c2410c", bg: "#ffedd5" },
  observations: { fg: "#c8331f", bg: "#fee4e2" },
  training: { fg: "#6e52e0", bg: "#eeeafd" },
  assessment: { fg: "#1d6fd8", bg: "#e3eefc" },
  attendance: { fg: "#33374a", bg: "#e8e9f0" },
  classes: { fg: "#0f766e", bg: "#ccfbf1" },
};

