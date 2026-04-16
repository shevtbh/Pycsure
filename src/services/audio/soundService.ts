type CapturePlayer = {
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  remove: () => void;
};

const CAPTURE_SOUND_SOURCES = [
  require("../../../assets/memeSound.mp3"),
  require("../../../assets/we-outside.mp3"),
  require("../../../assets/your-not-my-dad_XfGPPFN.mp3"),
  require("../../../assets/oh-brother-this-guy-stinks.mp3"),
  require("../../../assets/brother-ewwwwwww.mp3"),
  require("../../../assets/erro.mp3"),
  require("../../../assets/ahh_gLSTOu4.mp3")
];

let capturePlayers: CapturePlayer[] = [];

async function loadExpoAudio(): Promise<typeof import("expo-audio") | null> {
  try {
    return await import("expo-audio");
  } catch {
    return null;
  }
}

export async function preloadCaptureSound() {
  if (capturePlayers.length > 0) {
    return;
  }

  const audio = await loadExpoAudio();
  if (!audio) {
    return;
  }

  const loadedPlayers: CapturePlayer[] = [];
  for (const source of CAPTURE_SOUND_SOURCES) {
    try {
      loadedPlayers.push(audio.createAudioPlayer(source));
    } catch {
      // Skip invalid assets and keep loading remaining sounds.
    }
  }
  capturePlayers = loadedPlayers;
}

export async function playCaptureSound() {
  if (capturePlayers.length === 0) {
    return;
  }

  const randomIndex = Math.floor(Math.random() * capturePlayers.length);
  const randomPlayer = capturePlayers[randomIndex];
  await randomPlayer.seekTo(0);
  randomPlayer.play();
}

export async function unloadCaptureSound() {
  if (capturePlayers.length === 0) {
    return;
  }

  capturePlayers.forEach((player) => player.remove());
  capturePlayers = [];
}
