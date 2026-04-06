import { FlashMode, FlashProfile } from "../types/pipeline";

/** Order matches capture bracket: no flash → torch fill (low) → burst (high). */
export const FLASH_MODES: FlashMode[] = ["none", "low", "high"];

export const FLASH_PROFILES: Record<FlashMode, FlashProfile> = {
  none: {
    mode: "none",
    exposureBoost: 0,
    contrastBoost: 0,
    highlightThreshold: 1,
    highlightBoost: 0,
    temperatureShift: 0,
    radialFalloff: 0,
    centerBiasY: 0
  },
  low: {
    mode: "low",
    exposureBoost: 0.35,
    contrastBoost: 0.1,
    highlightThreshold: 0.88,
    highlightBoost: 0.08,
    temperatureShift: 0.08,
    radialFalloff: 0.6,
    centerBiasY: 0
  },
  high: {
    mode: "high",
    exposureBoost: 0.65,
    contrastBoost: 0.22,
    highlightThreshold: 0.84,
    highlightBoost: 0.14,
    temperatureShift: -0.05,
    radialFalloff: 1.2,
    centerBiasY: -0.1
  }
};
