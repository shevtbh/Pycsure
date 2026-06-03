/** Palette derived from assets/app-icon.svg */
export const colors = {
  cream: "#F5E6CC",
  sand: "#E0C097",
  tan: "#D4A373",
  caramel: "#A47148",
  coffee: "#6F4E37",
  espresso: "#4E342E",

  background: "#F5E6CC",
  surface: "#FFF8EE",
  surfaceMuted: "#F0E2CC",
  border: "#D4B896",
  borderStrong: "#A47148",

  text: "#4E342E",
  textSecondary: "#6F4E37",
  textMuted: "#8B6B55",
  textOnAccent: "#FFF8EE",

  primary: "#A47148",
  primaryDark: "#6F4E37",
  secondary: "#D4A373",
  accent: "#6F4E37",

  success: "#4A6B3F",
  error: "#B84A3A",

  progressTrack: "#E0C097",
  progressFill: "#A47148",

  chipBg: "#FFF8EE",
  chipBorder: "#D4B896",
  chipActiveBg: "#F0E2CC",
  chipActiveBorder: "#A47148",
  chipCompleteBg: "#E8F0E4",
  chipCompleteBorder: "#4A6B3F",

  previewFrame: "#4E342E",
  previewOverlay: "rgba(78, 52, 46, 0.45)",
  previewLoadingText: "#F5E6CC",

  mediaOverlay: "rgba(78, 52, 46, 0.72)",
  fullscreenOverlay: "rgba(78, 52, 46, 0.96)",
  videoSurface: "#4E342E"
} as const;

export const switchColors = {
  trackFalse: colors.sand,
  trackTrue: colors.caramel,
  thumb: colors.surface
};
