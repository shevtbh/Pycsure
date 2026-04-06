export type FilterId = "STD" | "VTG1" | "VTG2" | "BW";
export type FlashMode = "none" | "low" | "high";
export type ColorMatrix4x5 = [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number
];

export interface ToneCurve {
  blacks: number;
  shadows: number;
  midtones: number;
  highlights: number;
  whites: number;
}

export interface FilterPreset {
  id: FilterId;
  label: string;
  colorMatrix: [number, number, number, number, number, number, number, number, number];
  toneCurve: ToneCurve;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  grain: number;
  sharpen: number;
  fade: number;
}

export interface FlashProfile {
  mode: FlashMode;
  exposureBoost: number;
  contrastBoost: number;
  highlightThreshold: number;
  highlightBoost: number;
  temperatureShift: number;
  radialFalloff: number;
  centerBiasY: number;
}

export interface SessionSummary {
  attemptedVariants: number;
  completedVariants: number;
  failedVariants: number;
}

export type CaptureSourceMode = "snapshot" | "photo_normalized";

export interface CaptureSourceCandidate {
  mode: CaptureSourceMode;
  uri: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  isDegenerate: boolean;
}

export type PipelineHealthTag = "capture_bad" | "decode_bad" | "filter_bad" | "encode_bad" | "ok";

export interface CaptureDiagnostics {
  selectedMode: CaptureSourceMode;
  selectionReason: string;
  candidates: CaptureSourceCandidate[];
}

export interface RenderDiagnostics {
  identityFallbackCount: number;
  matrixFallbackCount: number;
}

export interface PipelineDiagnostics {
  healthTag: PipelineHealthTag;
  capture: CaptureDiagnostics;
  render: RenderDiagnostics;
}

export interface CaptureJobConfig {
  saveToGallery: boolean;
  includeVideo: boolean;
  captureVideoMs: number;
  outputJpegQuality: number;
}

export interface CaptureVariant {
  filterId: FilterId;
  flashMode: FlashMode;
}

export interface CaptureVariantResult {
  variant: CaptureVariant;
  localUri: string;
  processingMs: number;
}

export interface CaptureSessionResult {
  sessionId: string;
  baseImageUri: string;
  videoUri?: string;
  outputs: CaptureVariantResult[];
  summary: SessionSummary;
  diagnostics?: PipelineDiagnostics;
  elapsedMs: number;
}

export interface PromptItem {
  id: string;
  text: string;
  vibe: "goofy" | "group" | "selfie" | "energetic" | "awkward";
  category: "expression" | "pose" | "interaction" | "movement";
}
