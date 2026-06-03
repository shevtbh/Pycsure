export type SaveDestination = "files" | "gallery" | "both";

export const SAVE_DESTINATION_LABELS: Record<SaveDestination, string> = {
  files: "Files",
  gallery: "Gallery",
  both: "Both"
};

export const SAVE_DESTINATION_DESCRIPTIONS: Record<SaveDestination, string> = {
  files: "Save to Files → On My iPhone → Pycsure → Pycsure (iOS) or Pictures/Pycsure (Android)",
  gallery: "Save selected captures to your photo library",
  both: "Save selected captures to Internal Storage/Pycsure and your photo library"
};
