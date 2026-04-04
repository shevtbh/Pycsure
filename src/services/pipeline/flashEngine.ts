import { FLASH_PROFILES } from "../../config/flash";
import { FlashMode, FlashProfile } from "../../types/pipeline";

export interface FlashComputation {
  profile: FlashProfile;
  highlightBehavior: {
    threshold: number;
    boost: number;
  };
  radialIntensity: number;
  overlayAlpha: number;
  contrastScale: number;
  temperatureOffset: number;
}

export function getFlashProfile(flashMode: FlashMode) {
  return FLASH_PROFILES[flashMode];
}

export function computeFlash(flashMode: FlashMode): FlashComputation {
  const profile = getFlashProfile(flashMode);
  const radialIntensity = profile.mode === "none" ? 0 : 0.28 + profile.radialFalloff * 0.18;
  const overlayAlpha = profile.mode === "none" ? 0 : 0.06 + profile.exposureBoost * 0.05;
  const contrastScale = 1 + profile.contrastBoost;
  return {
    profile,
    highlightBehavior: {
      threshold: profile.highlightThreshold,
      boost: profile.highlightBoost
    },
    radialIntensity,
    overlayAlpha,
    contrastScale,
    temperatureOffset: profile.temperatureShift
  };
}
