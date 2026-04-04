import { Audio } from "expo-av";

let captureSound: Audio.Sound | null = null;

export async function preloadCaptureSound() {
  if (captureSound) {
    return;
  }

  try {
    captureSound = new Audio.Sound();
    await captureSound.loadAsync(require("../../../assets/capture.mp3"));
  } catch {
    captureSound = null;
  }
}

export async function playCaptureSound() {
  if (!captureSound) {
    return;
  }

  await captureSound.replayAsync();
}

export async function unloadCaptureSound() {
  if (!captureSound) {
    return;
  }

  await captureSound.unloadAsync();
  captureSound = null;
}
