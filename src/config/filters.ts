import { FilterPreset } from "../types/pipeline";

export const FILTERS: Record<FilterPreset["id"], FilterPreset> = {
  STD: {
    id: "STD",
    label: "Standard",
    colorMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    toneCurve: { blacks: 0, shadows: 0.25, midtones: 0.5, highlights: 1, whites: 1 },
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    grain: 0,
    sharpen: 0,
    fade: 0
  },
  VTG1: {
    id: "VTG1",
    label: "Vintage 1",
    colorMatrix: [1.14, -0.09, -0.05, -0.07, 1.06, 0.02, 0.05, -0.14, 1.22],
    toneCurve: { blacks: 0.16, shadows: 0.28, midtones: 0.5, highlights: 0.74, whites: 0.88 },
    contrast: 0.84,
    saturation: 1.22,
    temperature: 0.24,
    tint: -0.1,
    grain: 0.25,
    sharpen: 0.08,
    fade: 0.14
  },
  VTG2: {
    id: "VTG2",
    label: "Vintage 2",
    colorMatrix: [0.91, -0.03, 0.1, -0.05, 1.08, -0.01, 0.08, -0.06, 1.2],
    toneCurve: { blacks: 0.08, shadows: 0.24, midtones: 0.46, highlights: 0.82, whites: 0.96 },
    contrast: 1.24,
    saturation: 0.9,
    temperature: -0.14,
    tint: 0.06,
    grain: 0.22,
    sharpen: 0.18,
    fade: 0.08
  },
  BW: {
    id: "BW",
    label: "Black & White",
    colorMatrix: [0.4, 0.4, 0.2, 0.4, 0.4, 0.2, 0.4, 0.4, 0.2],
    toneCurve: { blacks: 0, shadows: 0.15, midtones: 0.45, highlights: 0.92, whites: 1 },
    contrast: 1.3,
    saturation: 0,
    temperature: 0,
    tint: 0,
    grain: 0.35,
    sharpen: 0.2,
    fade: 0.02
  }
};

export const FILTER_ORDER: FilterPreset["id"][] = ["STD", "VTG1", "VTG2", "BW"];
