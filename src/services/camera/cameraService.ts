import type { RefObject } from "react";
import {
  Camera,
  CameraDevice,
  PhotoFile,
  TakePhotoOptions,
  TakeSnapshotOptions,
  VideoFile
} from "react-native-vision-camera";
import * as ImageManipulator from "expo-image-manipulator";

export function photoFileToUri(photo: PhotoFile): string {
  return `file://${photo.path}`;
}

export async function requestCameraPermissions() {
  const cameraPermission = await Camera.requestCameraPermission();
  const microphonePermission = await Camera.requestMicrophonePermission();
  return {
    cameraPermission,
    microphonePermission,
    granted: cameraPermission === "granted" && microphonePermission === "granted"
  };
}

export function getDefaultCameraFormat(device: CameraDevice | null) {
  if (!device || device.formats.length === 0) {
    return undefined;
  }
  return device.formats[0];
}

export async function capturePhoto(
  cameraRef: RefObject<Camera | null>,
  options?: Omit<TakePhotoOptions, "enableShutterSound">
): Promise<PhotoFile> {
  if (!cameraRef.current) {
    throw new Error("Camera is not ready.");
  }

  return cameraRef.current.takePhoto({
    enableShutterSound: false,
    ...options
  });
}

/**
 * Normalize a raw camera path into a stable JPEG URI.
 * This helps when native capture returns HEIC or a not-yet-flushed temp file.
 */
export async function normalizeCaptureToJpeg(rawPathOrUri: string): Promise<string> {
  const uri = rawPathOrUri.startsWith("file://") ? rawPathOrUri : `file://${rawPathOrUri}`;
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { compress: 0.97, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    return uri;
  }
}

export async function capturePhotoNormalized(
  cameraRef: RefObject<Camera | null>,
  options?: Omit<TakePhotoOptions, "enableShutterSound">
): Promise<{ photo: PhotoFile; normalizedUri: string }> {
  const photo = await capturePhoto(cameraRef, options);
  const normalizedUri = await normalizeCaptureToJpeg(photo.path);
  return { photo, normalizedUri };
}

/**
 * Grabs a frame from the same pipeline as the live preview / video stream.
 * Use this when `takePhoto()` yields black frames but preview and video look correct.
 * On iOS, `video` must be enabled on `<Camera />` for snapshots to work.
 */
export async function captureSnapshot(
  cameraRef: RefObject<Camera | null>,
  options?: TakeSnapshotOptions
): Promise<PhotoFile> {
  if (!cameraRef.current) {
    throw new Error("Camera is not ready.");
  }

  return cameraRef.current.takeSnapshot({
    quality: 100,
    ...options
  });
}

export async function captureTimedVideo(
  cameraRef: RefObject<Camera | null>,
  durationMs: number,
  flash: "on" | "off" = "off"
): Promise<VideoFile> {
  const camera = cameraRef.current;
  if (!camera) {
    throw new Error("Camera is not ready.");
  }

  return new Promise<VideoFile>((resolve, reject) => {
    const timeout = setTimeout(() => {
      camera.stopRecording();
    }, durationMs);

    camera.startRecording({
      flash,
      onRecordingFinished: (video) => {
        clearTimeout(timeout);
        resolve(video);
      },
      onRecordingError: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}
