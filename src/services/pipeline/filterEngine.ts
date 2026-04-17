import { FILTERS } from "../../config/filters";
import { ColorMatrix4x5, FilterId, FilterPreset } from "../../types/pipeline";

export interface FilterComputation {
  preset: FilterPreset;
  effectiveContrast: number;
  effectiveSaturation: number;
  effectiveTemperature: number;
  colorMatrix4x5: ColorMatrix4x5;
}

export const IDENTITY_COLOR_MATRIX_4X5: ColorMatrix4x5 = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0
];

export function getFilterPreset(filterId: FilterId) {
  return FILTERS[filterId];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeMatrixValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, min, max);
}

function ensureValidColorMatrix4x5(matrix: number[], filterId: FilterId): ColorMatrix4x5 {
  if (matrix.length !== 20) {
    // eslint-disable-next-line no-console
    console.warn(`[filterEngine] Invalid matrix length for ${filterId}: ${matrix.length}`);
    return IDENTITY_COLOR_MATRIX_4X5;
  }

  for (const value of matrix) {
    if (!Number.isFinite(value)) {
      // eslint-disable-next-line no-console
      console.warn(`[filterEngine] Non-finite matrix value for ${filterId}; using identity matrix.`);
      return IDENTITY_COLOR_MATRIX_4X5;
    }
  }

  return matrix as ColorMatrix4x5;
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

function makeColorMatrix4x5(preset: FilterPreset): ColorMatrix4x5 {
  if (preset.colorMatrix4x5Override) {
    return ensureValidColorMatrix4x5([...preset.colorMatrix4x5Override], preset.id);
  }

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

  // Proper 3×3 matrix multiplication: colorMatrix × saturationMatrix.
  // The old element-wise product (m00*satR[0]) destroyed brightness for
  // filters like BW where off-diagonal color-matrix entries carry signal.
  const r0 = m00 * satR[0] + m01 * satG[0] + m02 * satB[0];
  const r1 = m00 * satR[1] + m01 * satG[1] + m02 * satB[1];
  const r2 = m00 * satR[2] + m01 * satG[2] + m02 * satB[2];

  const g0 = m10 * satR[0] + m11 * satG[0] + m12 * satB[0];
  const g1 = m10 * satR[1] + m11 * satG[1] + m12 * satB[1];
  const g2 = m10 * satR[2] + m11 * satG[2] + m12 * satB[2];

  const b0 = m20 * satR[0] + m21 * satG[0] + m22 * satB[0];
  const b1 = m20 * satR[1] + m21 * satG[1] + m22 * satB[1];
  const b2 = m20 * satR[2] + m21 * satG[2] + m22 * satB[2];

  const c = contrast;
  const t = 128 * (1 - c);

  const combined = [
    sanitizeMatrixValue(r0 * c, -4, 4),
    sanitizeMatrixValue(r1 * c, -4, 4),
    sanitizeMatrixValue(r2 * c, -4, 4),
    0,
    sanitizeMatrixValue(t + fadeOffset + shadowsLift + temperatureBias * 255, -255, 255),
    sanitizeMatrixValue(g0 * c, -4, 4),
    sanitizeMatrixValue(g1 * c, -4, 4),
    sanitizeMatrixValue(g2 * c, -4, 4),
    0,
    sanitizeMatrixValue(t + fadeOffset + tintBias * 255, -255, 255),
    sanitizeMatrixValue(b0 * c, -4, 4),
    sanitizeMatrixValue(b1 * c, -4, 4),
    sanitizeMatrixValue(b2 * c, -4, 4),
    0,
    sanitizeMatrixValue(t + fadeOffset + highlightCompression - temperatureBias * 160, -255, 255),
    0, 0, 0, 1, 0
  ];

  return ensureValidColorMatrix4x5(combined, preset.id);
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
