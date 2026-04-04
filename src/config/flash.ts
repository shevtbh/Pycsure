import { FlashMode, FlashProfile } from "../types/pipeline";

export const FLASH_MODES: FlashMode[] = ["none", "selfie", "group"];

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
  selfie: {
    mode: "selfie",
    exposureBoost: 0.35,
    contrastBoost: 0.1,
    highlightThreshold: 0.88,
    highlightBoost: 0.08,
    temperatureShift: 0.08,
    radialFalloff: 0.6,
    centerBiasY: 0
  },
  group: {
    mode: "group",
    exposureBoost: 0.65,
    contrastBoost: 0.22,
    highlightThreshold: 0.84,
    highlightBoost: 0.14,
    temperatureShift: -0.05,
    radialFalloff: 1.2,
    centerBiasY: -0.1
  }
};
