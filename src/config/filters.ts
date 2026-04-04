import { FilterPreset } from "../types/pipeline";

export const FILTERS: Record<FilterPreset["id"], FilterPreset> = {
  STD: {
    id: "STD",
    label: "Standard",
    colorMatrix: [1.02, -0.01, -0.01, -0.01, 1.02, -0.01, -0.01, -0.02, 1.04],
    toneCurve: { blacks: 0.02, shadows: 0.2, midtones: 0.5, highlights: 0.9, whites: 0.98 },
    contrast: 1.05,
    saturation: 1.02,
    temperature: 0.03,
    tint: 0,
    grain: 0.05,
    sharpen: 0.15,
    fade: 0.01
  },
  VTG1: {
    id: "VTG1",
    label: "Vintage 1",
    colorMatrix: [1.08, -0.06, -0.02, -0.04, 1.03, 0.01, 0.02, -0.08, 1.12],
    toneCurve: { blacks: 0.1, shadows: 0.25, midtones: 0.52, highlights: 0.82, whites: 0.93 },
    contrast: 0.92,
    saturation: 1.08,
    temperature: 0.12,
    tint: -0.06,
    grain: 0.25,
    sharpen: 0.08,
    fade: 0.08
  },
  VTG2: {
    id: "VTG2",
    label: "Vintage 2",
    colorMatrix: [0.95, -0.02, 0.07, -0.03, 1.05, -0.02, 0.06, -0.04, 1.15],
    toneCurve: { blacks: 0.03, shadows: 0.18, midtones: 0.48, highlights: 0.88, whites: 0.98 },
    contrast: 1.18,
    saturation: 0.95,
    temperature: -0.08,
    tint: 0.03,
    grain: 0.15,
    sharpen: 0.16,
    fade: 0.03
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
