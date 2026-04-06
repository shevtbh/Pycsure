import { duplicateToOutputDirectory, saveToGallery } from "../storage/mediaStorage";
import { computeFilter } from "./filterEngine";
import { computeFlash } from "./flashEngine";
import { copySourceAsVariant, renderVariantImage } from "./imageRenderer";
import { IDENTITY_COLOR_MATRIX_4X5 } from "./filterEngine";
import {
  CaptureDiagnostics,
  CaptureJobConfig,
  CaptureSourceMode,
  CaptureSessionResult,
  CaptureVariantResult,
  FilterId,
  FlashMode,
  PipelineHealthTag
} from "../../types/pipeline";

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

function toFileUri(uri: string): string {
  return uri.startsWith("file://") ? uri : `file://${uri}`;
}

export interface ProcessCaptureInput {
  baseImageUri: string;
  /** Optional per-flash capture sources (e.g. hardware bracket pipeline). */
  baseImageByFlash?: Partial<Record<FlashMode, string>>;
  captureDiagnostics?: CaptureDiagnostics;
  videoUri?: string;
  config: CaptureJobConfig;
  onVariantDone?: (progress: number) => void;
}

const OUTPUT_VARIANTS: { filterId: FilterId; flashMode: FlashMode }[] = [
  { filterId: "STD", flashMode: "none" },
  { filterId: "STD", flashMode: "high" },
  { filterId: "VTG1", flashMode: "none" },
  { filterId: "VTG1", flashMode: "high" },
  { filterId: "VTG2", flashMode: "none" },
  { filterId: "VTG2", flashMode: "high" },
  { filterId: "BW", flashMode: "none" },
  { filterId: "BW", flashMode: "high" }
];

export async function processCapture(input: ProcessCaptureInput): Promise<CaptureSessionResult> {
  const start = Date.now();
  const sessionId = timestampId();
  const totalVariants = OUTPUT_VARIANTS.length;
  const outputs: CaptureVariantResult[] = [];
  let failedVariants = 0;
  let matrixFallbackCount = 0;
  let identityFallbackCount = 0;

  const renderReasonCounts: Partial<Record<PipelineHealthTag, number>> = {};
  const countReason = (tag: PipelineHealthTag) => {
    renderReasonCounts[tag] = (renderReasonCounts[tag] ?? 0) + 1;
  };

  const classifyRenderReason = (reason: string): PipelineHealthTag => {
    const normalized = reason.toLowerCase();
    if (normalized.includes("jpeg encode")) {
      return "encode_bad";
    }
    if (normalized.includes("decode") || normalized.includes("source image") || normalized.includes("reading")) {
      return "decode_bad";
    }
    if (normalized.includes("color filter") || normalized.includes("matrix") || normalized.includes("surface")) {
      return "filter_bad";
    }
    return "filter_bad";
  };

  for (let index = 0; index < OUTPUT_VARIANTS.length; index += 1) {
    const variantStart = Date.now();
    const { filterId, flashMode } = OUTPUT_VARIANTS[index];
    const filename = buildFilename(sessionId, filterId, flashMode);
    const sourceUri = toFileUri(input.baseImageByFlash?.[flashMode] ?? input.baseImageUri);
    const fallbackUri = toFileUri(input.baseImageUri);

    try {
      const filter = computeFilter(filterId);
      const flash = computeFlash(flashMode);
      const rendered = await renderVariantImage({
        sourceUri,
        fallbackUri,
        destinationFilename: filename,
        filterMatrix: filter.colorMatrix4x5,
        flash,
        config: input.config
      });
      if (rendered.usedFallback) {
        matrixFallbackCount += 1;
        countReason(classifyRenderReason(rendered.reason));
      }

      let localUri = rendered.localUri;
      if (rendered.usedFallback) {
        const identityRendered = await renderVariantImage({
          sourceUri,
          fallbackUri,
          destinationFilename: filename,
          filterMatrix: IDENTITY_COLOR_MATRIX_4X5,
          flash: computeFlash("none"),
          config: input.config
        });
        if (identityRendered.usedFallback) {
          identityFallbackCount += 1;
          countReason(classifyRenderReason(identityRendered.reason));
        } else {
          // If matrix rendering degraded to fallback but identity succeeds, keep identity.
          localUri = identityRendered.localUri;
        }
      }

      if (input.config.saveToGallery) {
        await saveToGallery(localUri);
      }

      outputs.push({
        variant: { filterId, flashMode },
        localUri,
        processingMs: Date.now() - variantStart
      });
    } catch (error) {
      failedVariants += 1;
      // eslint-disable-next-line no-console
      console.warn(`[batchProcessor] Failed variant ${filterId}/${flashMode}, using source fallback.`, error);

      const localUri = await copySourceAsVariant({
        sourceUri: fallbackUri,
        destinationFilename: filename
      });

      if (input.config.saveToGallery) {
        await saveToGallery(localUri);
      }

      outputs.push({
        variant: { filterId, flashMode },
        localUri,
        processingMs: Date.now() - variantStart
      });
    } finally {
      input.onVariantDone?.((index + 1) / totalVariants);
    }
  }

  let outputVideoUri: string | undefined;
  if (input.videoUri && input.config.includeVideo) {
    outputVideoUri = await duplicateToOutputDirectory(input.videoUri, buildVideoFilename(sessionId));
    if (input.config.saveToGallery) {
      await saveToGallery(outputVideoUri);
    }
  }

  let healthTag: PipelineHealthTag = "ok";
  const selectedMode: CaptureSourceMode | undefined = input.captureDiagnostics?.selectedMode;
  const selectedCandidate = input.captureDiagnostics?.candidates.find((candidate) => candidate.mode === selectedMode);
  if (selectedCandidate?.isDegenerate) {
    healthTag = "capture_bad";
  } else if ((renderReasonCounts.decode_bad ?? 0) > 0) {
    healthTag = "decode_bad";
  } else if ((renderReasonCounts.encode_bad ?? 0) > 0) {
    healthTag = "encode_bad";
  } else if ((renderReasonCounts.filter_bad ?? 0) > 0) {
    healthTag = "filter_bad";
  }

  return {
    sessionId,
    baseImageUri: input.baseImageUri,
    videoUri: outputVideoUri,
    outputs,
    summary: {
      attemptedVariants: totalVariants,
      completedVariants: outputs.length,
      failedVariants
    },
    diagnostics: input.captureDiagnostics ? {
      healthTag,
      capture: input.captureDiagnostics,
      render: {
        identityFallbackCount,
        matrixFallbackCount
      }
    } : undefined,
    elapsedMs: Date.now() - start
  };
}
