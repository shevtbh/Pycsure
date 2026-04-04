import { FILTERS } from "../../config/filters";
import { FilterId, FilterPreset } from "../../types/pipeline";

export interface FilterComputation {
  preset: FilterPreset;
  effectiveContrast: number;
  effectiveSaturation: number;
  effectiveTemperature: number;
  colorMatrix4x5: number[];
}

export function getFilterPreset(filterId: FilterId) {
  return FILTERS[filterId];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizePreset(preset: FilterPreset): FilterPreset {
  const toneCurve = {
    blacks: clamp(preset.toneCurve.blacks, 0, 1),
    shadows: clamp(preset.toneCurve.shadows, 0, 1),
    midtones: clamp(preset.toneCurve.midtones, 0, 1),
    highlights: clamp(preset.toneCurve.highlights, 0, 1),
    whites: clamp(preset.toneCurve.whites, 0, 1)
  };

  return {
    ...preset,
    toneCurve,
    contrast: clamp(preset.contrast, 0, 2),
    saturation: clamp(preset.saturation, 0, 2),
    temperature: clamp(preset.temperature, -1, 1),
    tint: clamp(preset.tint, -1, 1),
    grain: clamp(preset.grain, 0, 1),
    sharpen: clamp(preset.sharpen, 0, 1),
    fade: clamp(preset.fade, 0, 1)
  };
}

function makeColorMatrix4x5(preset: FilterPreset) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = preset.colorMatrix;
  const saturation = preset.saturation;
  const contrast = preset.contrast;
  const temperatureBias = preset.temperature * 0.12;
  const tintBias = preset.tint * 0.08;
  const fadeOffset = preset.fade * 20;
  const highlightCompression = (1 - preset.toneCurve.highlights) * -10;
  const shadowsLift = preset.toneCurve.blacks * 8;

  const rw = 0.2126;
  const gw = 0.7152;
  const bw = 0.0722;
  const invSat = 1 - saturation;

  const satR = [invSat * rw + saturation, invSat * gw, invSat * bw];
  const satG = [invSat * rw, invSat * gw + saturation, invSat * bw];
  const satB = [invSat * rw, invSat * gw, invSat * bw + saturation];

  const c = contrast;
  const t = 128 * (1 - c);

  const combined = [
    m00 * satR[0] * c,
    m01 * satR[1] * c,
    m02 * satR[2] * c,
    0,
    t + fadeOffset + shadowsLift + temperatureBias * 255,
    m10 * satG[0] * c,
    m11 * satG[1] * c,
    m12 * satG[2] * c,
    0,
    t + fadeOffset + tintBias * 255,
    m20 * satB[0] * c,
    m21 * satB[1] * c,
    m22 * satB[2] * c,
    0,
    t + fadeOffset + highlightCompression - temperatureBias * 160,
    0,
    0,
    0,
    1,
    0
  ];

  return combined;
}

export function computeFilter(filterId: FilterId): FilterComputation {
  const preset = normalizePreset(getFilterPreset(filterId));
  return {
    preset,
    effectiveContrast: preset.contrast,
    effectiveSaturation: preset.saturation,
    effectiveTemperature: preset.temperature,
    colorMatrix4x5: makeColorMatrix4x5(preset)
  };
}
