import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const LUT_CONFIG = {
  VTG1: path.join(projectRoot, "assets", "luts", "vintage1.cube"),
  VTG2: path.join(projectRoot, "assets", "luts", "vintage2.cube")
};

const OUTPUT_FILE = path.join(projectRoot, "src", "config", "generatedLutMatrices.ts");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function invertMatrix4x4(matrix) {
  const n = 4;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: n }, (_, index) => (index === rowIndex ? 1 : 0))
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      throw new Error("Unable to invert matrix; data is singular.");
    }

    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const factor = augmented[col][col];
    for (let idx = 0; idx < n * 2; idx += 1) {
      augmented[col][idx] /= factor;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const rowFactor = augmented[row][col];
      if (rowFactor === 0) {
        continue;
      }
      for (let idx = 0; idx < n * 2; idx += 1) {
        augmented[row][idx] -= rowFactor * augmented[col][idx];
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

function parseCubeFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  let lutSize = null;
  const points = [];

  const numberLine = /^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?\s+[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?\s+[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("LUT_3D_SIZE")) {
      const sizeValue = Number(trimmed.split(/\s+/)[1]);
      if (!Number.isFinite(sizeValue) || sizeValue <= 1) {
        throw new Error(`Invalid LUT_3D_SIZE in ${filePath}`);
      }
      lutSize = Math.floor(sizeValue);
      continue;
    }

    if (numberLine.test(trimmed)) {
      const [r, g, b] = trimmed.split(/\s+/).map(Number);
      points.push([r, g, b]);
    }
  }

  if (!lutSize) {
    const inferred = Math.round(Math.cbrt(points.length));
    if (inferred ** 3 !== points.length) {
      throw new Error(`Could not infer LUT size for ${filePath}`);
    }
    lutSize = inferred;
  }

  if (points.length !== lutSize ** 3) {
    throw new Error(
      `LUT point count mismatch for ${filePath}. Expected ${lutSize ** 3}, got ${points.length}.`
    );
  }

  return { lutSize, points };
}

function fitAffineRgb(points, lutSize) {
  const values = Array.from({ length: lutSize }, (_, idx) => idx / (lutSize - 1));
  const input = [];
  for (const b of values) {
    for (const g of values) {
      for (const r of values) {
        input.push([r, g, b, 1]);
      }
    }
  }

  if (input.length !== points.length) {
    throw new Error("Input and output LUT lengths do not match.");
  }

  const xtx = Array.from({ length: 4 }, () => Array(4).fill(0));
  const xty = Array.from({ length: 4 }, () => Array(3).fill(0));

  for (let idx = 0; idx < input.length; idx += 1) {
    const x = input[idx];
    const y = points[idx];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        xtx[i][j] += x[i] * x[j];
      }
      xty[i][0] += x[i] * y[0];
      xty[i][1] += x[i] * y[1];
      xty[i][2] += x[i] * y[2];
    }
  }

  const inv = invertMatrix4x4(xtx);
  const weights = Array.from({ length: 4 }, () => Array(3).fill(0));

  for (let i = 0; i < 4; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      for (let k = 0; k < 4; k += 1) {
        weights[i][channel] += inv[i][k] * xty[k][channel];
      }
    }
  }

  const squaredError = [0, 0, 0];
  for (let idx = 0; idx < input.length; idx += 1) {
    const x = input[idx];
    const y = points[idx];
    const predicted = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      predicted[channel] =
        x[0] * weights[0][channel] +
        x[1] * weights[1][channel] +
        x[2] * weights[2][channel] +
        x[3] * weights[3][channel];
      const diff = predicted[channel] - y[channel];
      squaredError[channel] += diff * diff;
    }
  }

  const count = input.length;
  const rmse = squaredError.map((value) => Math.sqrt(value / count));

  const matrix3x3 = [
    [weights[0][0], weights[1][0], weights[2][0]],
    [weights[0][1], weights[1][1], weights[2][1]],
    [weights[0][2], weights[1][2], weights[2][2]]
  ];

  const bias = [weights[3][0], weights[3][1], weights[3][2]];

  return { matrix3x3, bias, rmse };
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toOutputMatrix4x5(matrix3x3, bias) {
  return [
    matrix3x3[0][0], matrix3x3[0][1], matrix3x3[0][2], 0, clamp(round(bias[0] * 255, 4), -255, 255),
    matrix3x3[1][0], matrix3x3[1][1], matrix3x3[1][2], 0, clamp(round(bias[1] * 255, 4), -255, 255),
    matrix3x3[2][0], matrix3x3[2][1], matrix3x3[2][2], 0, clamp(round(bias[2] * 255, 4), -255, 255),
    0, 0, 0, 1, 0
  ].map((value, index) => (index % 5 === 4 ? value : round(value, 6)));
}

function formatArray(values) {
  return values.map((value) => (Number.isInteger(value) ? `${value}` : `${value}`)).join(", ");
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const generated = {};
  const warnings = [];

  for (const [filterId, filePath] of Object.entries(LUT_CONFIG)) {
    if (!fs.existsSync(filePath)) {
      warnings.push(`${filterId}: missing ${path.relative(projectRoot, filePath)}`);
      continue;
    }

    const parsed = parseCubeFile(filePath);
    const fit = fitAffineRgb(parsed.points, parsed.lutSize);
    const colorMatrix = [
      round(fit.matrix3x3[0][0], 6),
      round(fit.matrix3x3[0][1], 6),
      round(fit.matrix3x3[0][2], 6),
      round(fit.matrix3x3[1][0], 6),
      round(fit.matrix3x3[1][1], 6),
      round(fit.matrix3x3[1][2], 6),
      round(fit.matrix3x3[2][0], 6),
      round(fit.matrix3x3[2][1], 6),
      round(fit.matrix3x3[2][2], 6)
    ];
    const colorMatrix4x5 = toOutputMatrix4x5(fit.matrix3x3, fit.bias);
    generated[filterId] = {
      sourceFile: path.relative(projectRoot, filePath).replaceAll("\\", "/"),
      sourceSha256: sha256(filePath),
      lutSize: parsed.lutSize,
      rmse: fit.rmse.map((value) => round(value, 6)),
      colorMatrix,
      colorMatrix4x5
    };
  }

  const keys = Object.keys(generated).sort();
  const lines = [];
  lines.push("/* eslint-disable */");
  lines.push("// This file is auto-generated by scripts/generate-lut-matrices.mjs");
  lines.push("// Do not edit manually.");
  lines.push("");
  lines.push("import { ColorMatrix4x5 } from \"../types/pipeline\";");
  lines.push("");
  lines.push("export interface GeneratedLutMatrix {");
  lines.push("  sourceFile: string;");
  lines.push("  sourceSha256: string;");
  lines.push("  lutSize: number;");
  lines.push("  rmse: [number, number, number];");
  lines.push("  colorMatrix: [number, number, number, number, number, number, number, number, number];");
  lines.push("  colorMatrix4x5: ColorMatrix4x5;");
  lines.push("}");
  lines.push("");
  lines.push(
    "export const GENERATED_LUT_MATRICES: Partial<Record<\"VTG1\" | \"VTG2\", GeneratedLutMatrix>> = {"
  );

  for (const key of keys) {
    const value = generated[key];
    lines.push(`  ${key}: {`);
    lines.push(`    sourceFile: \"${value.sourceFile}\",`);
    lines.push(`    sourceSha256: \"${value.sourceSha256}\",`);
    lines.push(`    lutSize: ${value.lutSize},`);
    lines.push(`    rmse: [${formatArray(value.rmse)}],`);
    lines.push(`    colorMatrix: [${formatArray(value.colorMatrix)}],`);
    lines.push(`    colorMatrix4x5: [${formatArray(value.colorMatrix4x5)}]`);
    lines.push("  },");
  }

  lines.push("};");
  lines.push("");

  fs.writeFileSync(OUTPUT_FILE, `${lines.join("\n")}\n`, "utf8");

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`[generate-lut-matrices] Warning: ${warning}`);
    }
  }

  console.log(
    `[generate-lut-matrices] Wrote ${path.relative(projectRoot, OUTPUT_FILE)} with ${keys.length} LUT entries.`
  );
}

main();
