import { FilterPreset } from "../types/pipeline";
import { GENERATED_LUT_MATRICES } from "./generatedLutMatrices";

const VTG1_LUT = GENERATED_LUT_MATRICES.VTG1;
const VTG2_LUT = GENERATED_LUT_MATRICES.VTG2;

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
    colorMatrix: VTG1_LUT?.colorMatrix ?? [1.039, -0.0017, -0.0011, -0.001, 1.2194, -0.0129, -0.0007, -0.0083, 0.9678],
    colorMatrix4x5Override: VTG1_LUT?.colorMatrix4x5,
    toneCurve: { blacks: 0, shadows: 0.25, midtones: 0.5, highlights: 1, whites: 1 },
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    grain: 0.25,
    sharpen: 0.08,
    fade: 0
  },
  VTG2: {
    id: "VTG2",
    label: "Vintage 2",
    colorMatrix: VTG2_LUT?.colorMatrix ?? [1.0433, -0.0035, -0.0062, -0.0008, 1.208, -0.0226, -0.0017, -0.0142, 0.9151],
    colorMatrix4x5Override: VTG2_LUT?.colorMatrix4x5,
    toneCurve: { blacks: 0, shadows: 0.25, midtones: 0.5, highlights: 1, whites: 1 },
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    grain: 0.22,
    sharpen: 0.18,
    fade: 0
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
