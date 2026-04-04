import * as FileSystem from "expo-file-system/legacy";
import { BlendMode, ImageFormat, Skia, TileMode, vec } from "@shopify/react-native-skia";
import { CaptureJobConfig } from "../../types/pipeline";
import { FlashComputation } from "./flashEngine";
import { writeBase64ToOutputDirectory } from "../storage/mediaStorage";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function to255Color(value: number) {
  return Math.round(clamp(value, 0, 255));
}

function makeFlashColorMatrix(flash: FlashComputation): number[] {
  const identity = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0
  ];

  if (flash.profile.mode === "none") {
    return identity;
  }

  const contrast = flash.contrastScale;
  const bias = 128 * (1 - contrast);
  const exposureBias = flash.profile.exposureBoost * 60;
  const temp = flash.temperatureOffset * 20;

  return [
    contrast, 0, 0, 0, bias + exposureBias + temp,
    0, contrast, 0, 0, bias + exposureBias,
    0, 0, contrast, 0, bias + exposureBias - temp,
    0, 0, 0, 1, 0
  ];
}

function makeFinalMatrix(filterMatrix: number[], flashMatrix: number[]) {
  // Apply filter matrix and flash matrix in two render passes.
  return { filterMatrix, flashMatrix };
}

function applyFlashOverlay(canvas: any, width: number, height: number, flash: FlashComputation) {
  if (flash.profile.mode === "none") {
    return;
  }

  const centerX = width * 0.5;
  const centerY = height * (0.45 + flash.profile.centerBiasY);
  const radius = Math.max(width, height) * (0.55 + flash.profile.radialFalloff * 0.25);
  const alpha = clamp(flash.radialIntensity, 0.05, 0.7);

  const glowShader = Skia.Shader.MakeRadialGradient(
    vec(centerX, centerY),
    radius,
    [
      Skia.Color(`rgba(255,255,255,${alpha})`),
      Skia.Color("rgba(255,255,255,0)")
    ],
    [0, 1],
    TileMode.Clamp
  );

  const glowPaint = Skia.Paint();
  glowPaint.setBlendMode(BlendMode.Screen);
  glowPaint.setShader(glowShader);
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), glowPaint);

  const clipPaint = Skia.Paint();
  clipPaint.setBlendMode(BlendMode.Screen);
  const highlight = to255Color(255 * (flash.overlayAlpha + flash.highlightBehavior.boost));
  clipPaint.setColor(Skia.Color(`rgba(${highlight},${highlight},${highlight},0.09)`));
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), clipPaint);
}

function makeFallbackDataUri(sourceUri: string) {
  const normalized = sourceUri.startsWith("file://") ? sourceUri : `file://${sourceUri}`;
  return normalized;
}

export async function renderVariantImage(input: {
  sourceUri: string;
  destinationFilename: string;
  filterMatrix: number[];
  flash: FlashComputation;
  config: CaptureJobConfig;
}) {
  const normalizedSource = input.sourceUri.startsWith("file://") ? input.sourceUri : `file://${input.sourceUri}`;
  const base64 = await FileSystem.readAsStringAsync(normalizedSource, {
    encoding: FileSystem.EncodingType.Base64
  });

  const data = Skia.Data.fromBase64(base64);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    throw new Error(`Failed to decode image for ${input.destinationFilename}`);
  }

  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) {
    throw new Error("Could not allocate Skia offscreen surface.");
  }

  const canvas = surface.getCanvas();
  const { filterMatrix, flashMatrix } = makeFinalMatrix(input.filterMatrix, makeFlashColorMatrix(input.flash));

  const filterPaint = Skia.Paint();
  filterPaint.setColorFilter(Skia.ColorFilter.MakeMatrix(filterMatrix));
  canvas.drawImage(image, 0, 0, filterPaint);

  if (input.flash.profile.mode !== "none") {
    const snapshot = surface.makeImageSnapshot();
    const flashPassPaint = Skia.Paint();
    flashPassPaint.setColorFilter(Skia.ColorFilter.MakeMatrix(flashMatrix));
    canvas.drawImage(snapshot, 0, 0, flashPassPaint);
  }

  applyFlashOverlay(canvas, width, height, input.flash);

  const finalSnapshot = surface.makeImageSnapshot();
  const quality = Math.round(clamp(input.config.outputJpegQuality * 100, 1, 100));
  const encoded = finalSnapshot.encodeToBase64(ImageFormat.JPEG, quality);
  if (!encoded) {
    throw new Error("Failed to encode rendered image.");
  }

  return writeBase64ToOutputDirectory(encoded, input.destinationFilename);
}

export async function copySourceAsVariant(input: { sourceUri: string; destinationFilename: string }) {
  // Final fallback to preserve capture flow if GPU rendering fails.
  const uri = makeFallbackDataUri(input.sourceUri);
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return writeBase64ToOutputDirectory(base64, input.destinationFilename);
}
