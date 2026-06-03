import { NativeModulesProxy } from "expo-modules-core";
import { normalizeCaptureToJpeg } from "../camera/cameraService";
import { duplicateToOutputDirectory } from "../storage/mediaStorage";

type ExpoVideoThumbnailsModuleShape = {
  getThumbnailAsync: (
    sourceFilename: string,
    options?: { time?: number; quality?: number }
  ) => Promise<{ uri: string; width: number; height: number }>;
};

let cachedModule: ExpoVideoThumbnailsModuleShape | null | undefined;

function getVideoThumbnailsModule(): ExpoVideoThumbnailsModuleShape | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  if (!NativeModulesProxy?.ExpoVideoThumbnails) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("expo-video-thumbnails") as ExpoVideoThumbnailsModuleShape;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

export function isVideoFrameExtractAvailable(): boolean {
  return getVideoThumbnailsModule() != null;
}

export async function extractVideoFrameAtTime(
  videoUri: string,
  positionSeconds: number
): Promise<string> {
  const module = getVideoThumbnailsModule();
  if (!module) {
    throw new Error(
      "Frame export requires a development build with expo-video-thumbnails installed."
    );
  }

  const timeMs = Math.max(0, Math.round(positionSeconds * 1000));
  const thumbnail = await module.getThumbnailAsync(videoUri, {
    time: timeMs,
    quality: 1
  });

  const normalizedUri = await normalizeCaptureToJpeg(thumbnail.uri);
  const filename = `frame-${Date.now()}.jpg`;
  return duplicateToOutputDirectory(normalizedUri, filename);
}

/**
 * Returns a raw (un-normalized, low-quality) thumbnail uri for a given position.
 * Used to build the scrubber filmstrip. Returns null when extraction is unavailable
 * or fails, so callers can render a placeholder instead of throwing.
 */
export async function extractVideoThumbnailAtTime(
  videoUri: string,
  positionSeconds: number,
  quality = 0.3
): Promise<string | null> {
  const module = getVideoThumbnailsModule();
  if (!module) {
    return null;
  }

  const timeMs = Math.max(0, Math.round(positionSeconds * 1000));
  try {
    const thumbnail = await module.getThumbnailAsync(videoUri, {
      time: timeMs,
      quality
    });
    return thumbnail.uri;
  } catch {
    return null;
  }
}

export function formatVideoTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
