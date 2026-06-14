import * as FileSystem from "expo-file-system/legacy";
import { BlendMode, ImageFormat, Skia, TileMode, vec } from "@shopify/react-native-skia";
import type { SkCanvas, SkImage } from "@shopify/react-native-skia";
import { CaptureJobConfig, ColorMatrix4x5 } from "../../types/pipeline";
import { FlashComputation } from "./flashEngine";
import { writeBase64ToOutputDirectory } from "../storage/mediaStorage";
import { IDENTITY_COLOR_MATRIX_4X5 } from "./filterEngine";

/** A decoded source image plus a disposer that frees its backing native memory. */
export interface DecodedImage {
  image: SkImage;
  dispose: () => void;
}

function safeDispose(resource: { dispose?: () => void } | null | undefined) {
  try {
    resource?.dispose?.();
  } catch {
    // Native object may already be released; freeing twice is a no-op for us.
  }
}

/**
 * Reads and decodes an image once. The returned `dispose` frees both the decoded
 * image and its backing encoded data, so callers can cache one decode across many
 * variant renders instead of re-reading the same multi-MB JPEG per variant.
 */
export async function decodeImageFromUri(uri: string): Promise<DecodedImage | null> {
  const normalized = uri.startsWith("file://") ? uri : `file://${uri}`;

  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(normalized, {
      encoding: FileSystem.EncodingType.Base64
    });
  } catch {
    return null;
  }

  const data = Skia.Data.fromBase64(base64);
  const image = Skia.Image.MakeImageFromEncoded(data);

  if (!image || image.width() === 0 || image.height() === 0) {
    safeDispose(image);
    safeDispose(data);
    return null;
  }

  // Keep `data` alive until the image is disposed: MakeImageFromEncoded may
  // reference the encoded bytes lazily when the image is first drawn.
  return {
    image,
    dispose: () => {
      safeDispose(image);
      safeDispose(data);
    }
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function to255Color(value: number) {
  return Math.round(clamp(value, 0, 255));
}

function validateColorMatrix4x5(matrix: number[], context: string): ColorMatrix4x5 {
  if (matrix.length !== 20) {
    // eslint-disable-next-line no-console
    console.warn(`[imageRenderer] Invalid color matrix length in ${context}; using identity.`);
    return IDENTITY_COLOR_MATRIX_4X5;
  }

  for (const value of matrix) {
    if (!Number.isFinite(value)) {
      // eslint-disable-next-line no-console
      console.warn(`[imageRenderer] Non-finite color matrix value in ${context}; using identity.`);
      return IDENTITY_COLOR_MATRIX_4X5;
    }
  }

  return matrix as ColorMatrix4x5;
}

/**
 * Skia matrix offsets are effectively normalized channel units in practice.
 * Our presets historically used 0..255-style offsets, which can clip to white/black.
 */
function adaptMatrixForSkia(matrix: ColorMatrix4x5): ColorMatrix4x5 {
  const adapted = [...matrix] as number[];
  const offsetIndexes = [4, 9, 14, 19];
  for (const index of offsetIndexes) {
    if (Math.abs(adapted[index]) > 2) {
      adapted[index] = adapted[index] / 255;
    }
  }
  return adapted as ColorMatrix4x5;
}

function makeFlashColorMatrix(flash: FlashComputation): ColorMatrix4x5 {
  if (flash.profile.mode === "none") {
    return IDENTITY_COLOR_MATRIX_4X5;
  }

  const contrast = flash.contrastScale;
  const bias = 128 * (1 - contrast);
  const exposureBias = flash.profile.exposureBoost * 60;
  const temp = flash.temperatureOffset * 20;

  return validateColorMatrix4x5([
    contrast, 0, 0, 0, bias + exposureBias + temp,
    0, contrast, 0, 0, bias + exposureBias,
    0, 0, contrast, 0, bias + exposureBias - temp,
    0, 0, 0, 1, 0
  ], "flash");
}

function applyFlashOverlay(canvas: SkCanvas, width: number, height: number, flash: FlashComputation) {
  if (flash.profile.mode === "none") {
    return;
  }

  const centerX = width * 0.5;
  const centerY = height * (0.45 + flash.profile.centerBiasY);
  const radius = Math.max(width, height) * (0.55 + flash.profile.radialFalloff * 0.25);
  const alpha = clamp(flash.radialIntensity, 0.03, 0.18);

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
  const highlight = to255Color(210 + flash.highlightBehavior.boost * 18);
  const clipAlpha = clamp(0.02 + flash.overlayAlpha * 0.18, 0.02, 0.08);
  clipPaint.setColor(Skia.Color(`rgba(${highlight},${highlight},${highlight},${clipAlpha})`));
  canvas.drawRect(Skia.XYWHRect(0, 0, width, height), clipPaint);

  safeDispose(glowShader);
  safeDispose(glowPaint);
  safeDispose(clipPaint);
}

export interface RenderVariantResult {
  localUri: string;
  usedFallback: boolean;
  reason: string;
}

export async function renderVariantImage(input: {
  /** Preloaded, caller-owned source image. Not disposed here. */
  sourceImage?: SkImage | null;
  /** Preloaded, caller-owned fallback image (base no-flash frame). Not disposed here. */
  fallbackImage?: SkImage | null;
  /** URI used only for the ultimate copy-the-original fallback path. */
  sourceUri: string;
  fallbackUri?: string;
  destinationFilename: string;
  filterMatrix: ColorMatrix4x5;
  flash: FlashComputation;
  config: CaptureJobConfig;
}): Promise<RenderVariantResult> {
  const fallbackSource = input.fallbackUri ?? input.sourceUri;

  const fallbackToOriginal = async (reason: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[imageRenderer] ${reason}; writing original image.`);
    const localUri = await copySourceAsVariant({
      sourceUri: fallbackSource,
      destinationFilename: input.destinationFilename
    });
    return { localUri, usedFallback: true, reason };
  };

  // Prefer the decoded source; fall back to the decoded base frame if the
  // source could not be decoded by the caller.
  const image = input.sourceImage ?? input.fallbackImage ?? null;
  if (!image || image.width() === 0 || image.height() === 0) {
    return fallbackToOriginal("No decodable source image");
  }

  const width = image.width();
  const height = image.height();

  // Tracked so the finally block frees every native Skia object we allocate,
  // regardless of which early-return path we take. Leaving these to the GC
  // during an 8x 4K loop is the main out-of-memory risk on device.
  const filterSurface = Skia.Surface.MakeOffscreen(width, height);
  let filterPaint: ReturnType<typeof Skia.Paint> | null = null;
  let filterColorFilter: ReturnType<typeof Skia.ColorFilter.MakeMatrix> | null = null;
  let flashSurface: ReturnType<typeof Skia.Surface.MakeOffscreen> | null = null;
  let flashPaint: ReturnType<typeof Skia.Paint> | null = null;
  let flashColorFilter: ReturnType<typeof Skia.ColorFilter.MakeMatrix> | null = null;
  let filteredSnap: SkImage | null = null;
  let finalSnapshot: SkImage | null = null;

  try {
    if (!filterSurface) {
      return await fallbackToOriginal("Failed to create filter surface");
    }

    const filterCanvas = filterSurface.getCanvas();
    filterPaint = Skia.Paint();
    const safeFilterMatrix = adaptMatrixForSkia(
      validateColorMatrix4x5(input.filterMatrix, "renderVariantImage.filterMatrix")
    );
    filterColorFilter = Skia.ColorFilter.MakeMatrix(safeFilterMatrix);
    if (!filterColorFilter) {
      return await fallbackToOriginal("Failed to create filter color filter");
    }
    filterPaint.setColorFilter(filterColorFilter);
    filterCanvas.drawImage(image, 0, 0, filterPaint);

    const useFlash = input.flash.profile.mode !== "none";
    let finalSurface = filterSurface;

    if (useFlash) {
      flashSurface = Skia.Surface.MakeOffscreen(width, height);
      if (flashSurface) {
        // Snapshot the filter result ONCE, then draw it into the new surface.
        filteredSnap = filterSurface.makeImageSnapshot();
        const flashCanvas = flashSurface.getCanvas();
        flashPaint = Skia.Paint();
        flashColorFilter = Skia.ColorFilter.MakeMatrix(adaptMatrixForSkia(makeFlashColorMatrix(input.flash)));
        if (!flashColorFilter) {
          return await fallbackToOriginal("Failed to create flash color filter");
        }
        flashPaint.setColorFilter(flashColorFilter);
        flashCanvas.drawImage(filteredSnap, 0, 0, flashPaint);
        applyFlashOverlay(flashCanvas, width, height, input.flash);
        finalSurface = flashSurface;
      }
    }

    finalSnapshot = finalSurface.makeImageSnapshot();
    const quality = Math.round(clamp(input.config.outputJpegQuality * 100, 1, 100));
    const encoded = finalSnapshot.encodeToBase64(ImageFormat.JPEG, quality);

    if (!encoded) {
      return await fallbackToOriginal("JPEG encode returned empty output");
    }

    const localUri = await writeBase64ToOutputDirectory(encoded, input.destinationFilename);
    return { localUri, usedFallback: false, reason: "ok" };
  } finally {
    // Note: `image` (sourceImage / fallbackImage) is owned by the caller and
    // intentionally left intact so it can be reused across variants.
    safeDispose(finalSnapshot);
    safeDispose(filteredSnap);
    safeDispose(flashColorFilter);
    safeDispose(flashPaint);
    safeDispose(flashSurface);
    safeDispose(filterColorFilter);
    safeDispose(filterPaint);
    safeDispose(filterSurface);
  }
}

export async function copySourceAsVariant(input: { sourceUri: string; destinationFilename: string }) {
  const uri = input.sourceUri.startsWith("file://")
    ? input.sourceUri
    : `file://${input.sourceUri}`;
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
  return writeBase64ToOutputDirectory(base64, input.destinationFilename);
}
