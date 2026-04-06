type CapturePlayer = {
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  remove: () => void;
};

let capturePlayer: CapturePlayer | null = null;

async function loadExpoAudio(): Promise<typeof import("expo-audio") | null> {
  try {
    return await import("expo-audio");
  } catch {
    return null;
  }
}

export async function preloadCaptureSound() {
  if (capturePlayer) {
    return;
  }

  const audio = await loadExpoAudio();
  if (!audio) {
    return;
  }

  try {
    capturePlayer = audio.createAudioPlayer(require("../../../assets/memeSound.mp3"));
  } catch {
    capturePlayer = null;
  }
}

export async function playCaptureSound() {
  if (!capturePlayer) {
    return;
  }

  await capturePlayer.seekTo(0);
  capturePlayer.play();
}

export async function unloadCaptureSound() {
  if (!capturePlayer) {
    return;
  }

  capturePlayer.remove();
  capturePlayer = null;
}
