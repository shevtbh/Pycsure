import type { RefObject } from "react";
import type { Camera, CameraDevice } from "react-native-vision-camera";
import type { FlashMode } from "../../types/pipeline";
import { capturePhoto, normalizeCaptureToJpeg } from "./cameraService";

/** Time between still captures so flash / torch hardware can settle. */
const BETWEEN_STILLS_MS = 600;
/** Initial delay before first capture so camera AE/AF has time to settle. */
const INITIAL_SETTLE_MS = 500;

export type BaseImageByFlash = Record<FlashMode, string>;

/**
 * Back camera only. One still per flash tier:
 * - none: flash off, AE-settled capture
 * - low:  same base frame (software-brightened in the render pipeline)
 * - high: separate hardware flash burst, also normalised to JPEG
 */
export async function captureHardwareFlashBracket(input: {
  cameraRef: RefObject<Camera | null>;
  device: CameraDevice;
  setTorchOn: (on: boolean) => void;
  enableHardwareFlash: boolean;
}): Promise<{ baseImageByFlash: BaseImageByFlash; baseImageUri: string }> {
  const { cameraRef, device, setTorchOn, enableHardwareFlash } = input;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  setTorchOn(false);

  // Give the camera AE/AF time to settle before the first capture.
  // 80 ms was too short on devices with computational photography pipelines.
  await sleep(INITIAL_SETTLE_MS);

  const none = await capturePhoto(cameraRef, { flash: "off" });
  const noneUri = await normalizeCaptureToJpeg(none.path);

  let lowUri = noneUri;
  let highUri = noneUri;

  if (!enableHardwareFlash || !device.hasFlash) {
    return {
      baseImageUri: noneUri,
      baseImageByFlash: { none: noneUri, low: noneUri, high: noneUri }
    };
  }

  await sleep(BETWEEN_STILLS_MS);
  try {
    const high = await capturePhoto(cameraRef, { flash: "on" });
    highUri = await normalizeCaptureToJpeg(high.path);
  } catch {
    highUri = noneUri;
  }

  return {
    baseImageUri: noneUri,
    baseImageByFlash: { none: noneUri, low: lowUri, high: highUri }
  };
}
