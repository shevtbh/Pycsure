import { Camera, CameraDevice, PhotoFile, VideoFile } from "react-native-vision-camera";

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

export async function capturePhoto(cameraRef: React.RefObject<Camera | null>): Promise<PhotoFile> {
  if (!cameraRef.current) {
    throw new Error("Camera is not ready.");
  }

  return cameraRef.current.takePhoto({
    enableShutterSound: false
  });
}

export async function captureTimedVideo(
  cameraRef: React.RefObject<Camera | null>,
  durationMs: number
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
      flash: "off",
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
