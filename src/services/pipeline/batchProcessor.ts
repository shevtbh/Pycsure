import { FILTER_ORDER } from "../../config/filters";
import { FLASH_MODES } from "../../config/flash";
import { computeFilter } from "./filterEngine";
import { computeFlash } from "./flashEngine";
import { duplicateToOutputDirectory, saveToGallery } from "../storage/mediaStorage";
import { CaptureJobConfig, CaptureSessionResult, CaptureVariantResult, FilterId, FlashMode } from "../../types/pipeline";
import { copySourceAsVariant, renderVariantImage } from "./imageRenderer";

function timestampId() {
  return Date.now().toString();
}

function buildFilename(sessionId: string, filterId: FilterId, flashMode: FlashMode) {
  const flashSuffix = flashMode === "none" ? "NOFLASH" : flashMode.toUpperCase();
  return `IMG_${sessionId}_${filterId}_${flashSuffix}.jpg`;
}

function buildVideoFilename(sessionId: string) {
  return `VID_${sessionId}_RAW.mp4`;
}

export interface ProcessCaptureInput {
  baseImageUri: string;
  videoUri?: string;
  config: CaptureJobConfig;
  variantTimeoutMs?: number;
  onVariantDone?: (progress: number) => void;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function processCapture(input: ProcessCaptureInput): Promise<CaptureSessionResult> {
  const start = Date.now();
  const sessionId = timestampId();
  const totalVariants = FILTER_ORDER.length * FLASH_MODES.length;
  const timeoutMs = input.variantTimeoutMs ?? 3000;
  let completed = 0;
  let failed = 0;
  const outputs: CaptureVariantResult[] = [];

  for (const filterId of FILTER_ORDER) {
    const filter = computeFilter(filterId);
    for (const flashMode of FLASH_MODES) {
      const flash = computeFlash(flashMode);
      const filename = buildFilename(sessionId, filter.preset.id, flash.profile.mode);
      const variantStart = Date.now();

      try {
        const localUri = await runWithTimeout(
          renderVariantImage({
            sourceUri: input.baseImageUri,
            destinationFilename: filename,
            filterMatrix: filter.colorMatrix4x5,
            flash,
            config: input.config
          }),
          timeoutMs,
          `${filter.preset.id}-${flash.profile.mode}`
        );

        if (input.config.saveToGallery) {
          await saveToGallery(localUri);
        }

        outputs.push({
          variant: { filterId: filter.preset.id, flashMode: flash.profile.mode },
          localUri,
          processingMs: Date.now() - variantStart
        });
      } catch {
        failed += 1;

        // Continue processing other variants instead of failing the whole session.
        try {
          const fallbackUri = await copySourceAsVariant({
            sourceUri: input.baseImageUri,
            destinationFilename: filename
          });

          outputs.push({
            variant: { filterId: filter.preset.id, flashMode: flash.profile.mode },
            localUri: fallbackUri,
            processingMs: Date.now() - variantStart
          });
        } catch {
          // Hard failure for this one variant only.
        }
      }

      completed += 1;
      input.onVariantDone?.(completed / totalVariants);
    }
  }

  let outputVideoUri: string | undefined;
  if (input.videoUri && input.config.includeVideo) {
    outputVideoUri = await duplicateToOutputDirectory(input.videoUri, buildVideoFilename(sessionId));
    if (input.config.saveToGallery) {
      await saveToGallery(outputVideoUri);
    }
  }

  return {
    sessionId,
    baseImageUri: input.baseImageUri,
    videoUri: outputVideoUri,
    outputs,
    summary: {
      attemptedVariants: totalVariants,
      completedVariants: outputs.length,
      failedVariants: Math.max(totalVariants - outputs.length, failed)
    },
    elapsedMs: Date.now() - start
  };
}
