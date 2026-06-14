type PlaybackStatus = {
  didJustFinish: boolean;
  duration: number;
  currentTime: number;
  playing: boolean;
};

type CapturePlayer = {
  playing: boolean;
  duration: number;
  currentTime: number;
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  remove: () => void;
  addListener: (
    event: "playbackStatusUpdate",
    listener: (status: PlaybackStatus) => void
  ) => { remove: () => void };
};

const CAPTURE_SOUND_SOURCES = [
  require("../../../assets/memeSound.mp3"),
  require("../../../assets/we-outside.mp3"),
  require("../../../assets/your-not-my-dad_XfGPPFN.mp3"),
  require("../../../assets/oh-brother-this-guy-stinks.mp3"),
  require("../../../assets/brother-ewwwwwww.mp3"),
  require("../../../assets/erro.mp3"),
  require("../../../assets/ahh_gLSTOu4.mp3"),
  require("../../../assets/capture-sounds/young-metro.mp3"),
  require("../../../assets/capture-sounds/what-are-you-doing-in-my-swamp.mp3"),
  require("../../../assets/capture-sounds/ya-ya-ya-yeet.mp3"),
  require("../../../assets/capture-sounds/poopity-scoop.mp3"),
  require("../../../assets/capture-sounds/tueaday.mp3"),
  require("../../../assets/capture-sounds/damn-lil-uzi.mp3"),
  require("../../../assets/capture-sounds/woopty-doo.mp3"),
  require("../../../assets/capture-sounds/yuh_8eJpq7m.mp3")
];

const TIMER_COMPLETE_SOURCE = require("../../../assets/timer-complete.mp3");

const MAX_CAPTURE_SOUND_FALLBACK_MS = 15000;
const PLAYBACK_POLL_MS = 100;

let capturePlayers: CapturePlayer[] = [];
let timerCompletePlayer: CapturePlayer | null = null;
let audioModeConfigured = false;

async function loadExpoAudio(): Promise<typeof import("expo-audio") | null> {
  try {
    return await import("expo-audio");
  } catch {
    return null;
  }
}

async function configureCaptureAudioMode(audio: typeof import("expo-audio")) {
  if (audioModeConfigured) {
    return;
  }

  try {
    await audio.setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix"
    });
    audioModeConfigured = true;
  } catch {
    // Keep going with platform defaults if audio mode setup fails.
  }
}

function waitForPlaybackComplete(player: CapturePlayer): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.remove();
      clearTimeout(fallbackTimeout);
      clearInterval(pollInterval);
      resolve();
    };

    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        finish();
      }
    });

    const fallbackMs =
      player.duration > 0 ? player.duration * 1000 + 500 : MAX_CAPTURE_SOUND_FALLBACK_MS;
    const fallbackTimeout = setTimeout(finish, fallbackMs);

    const pollInterval = setInterval(() => {
      if (player.duration > 0 && !player.playing && player.currentTime >= player.duration - 0.1) {
        finish();
      }
    }, PLAYBACK_POLL_MS);
  });
}

export async function preloadCaptureSound() {
  if (capturePlayers.length > 0) {
    await preloadTimerCompleteSound();
    return;
  }

  const audio = await loadExpoAudio();
  if (!audio) {
    return;
  }

  await configureCaptureAudioMode(audio);

  const loadedPlayers: CapturePlayer[] = [];
  for (const source of CAPTURE_SOUND_SOURCES) {
    try {
      loadedPlayers.push(audio.createAudioPlayer(source, { downloadFirst: true }));
    } catch {
      // Skip invalid assets and keep loading remaining sounds.
    }
  }
  capturePlayers = loadedPlayers;
  await preloadTimerCompleteSound();
}

export async function playCaptureSound() {
  if (capturePlayers.length === 0) {
    return;
  }

  await stopCaptureSounds();

  const randomIndex = Math.floor(Math.random() * capturePlayers.length);
  const randomPlayer = capturePlayers[randomIndex];
  await randomPlayer.seekTo(0);
  randomPlayer.play();
  await waitForPlaybackComplete(randomPlayer);
}

export async function preloadTimerCompleteSound() {
  if (timerCompletePlayer) {
    return;
  }

  const audio = await loadExpoAudio();
  if (!audio) {
    return;
  }

  await configureCaptureAudioMode(audio);

  try {
    timerCompletePlayer = audio.createAudioPlayer(TIMER_COMPLETE_SOURCE, { downloadFirst: true });
  } catch {
    timerCompletePlayer = null;
  }
}

async function stopCaptureSounds() {
  await Promise.all(
    capturePlayers.map(async (player) => {
      if (player.playing) {
        player.pause();
        await player.seekTo(0);
      }
    })
  );
}

export async function playTimerCompleteSound() {
  if (!timerCompletePlayer) {
    await preloadTimerCompleteSound();
  }

  if (!timerCompletePlayer) {
    return;
  }

  await stopCaptureSounds();
  await timerCompletePlayer.seekTo(0);
  timerCompletePlayer.play();
  await waitForPlaybackComplete(timerCompletePlayer);
}

export async function unloadCaptureSound() {
  if (capturePlayers.length > 0) {
    capturePlayers.forEach((player) => player.remove());
    capturePlayers = [];
  }

  if (timerCompletePlayer) {
    timerCompletePlayer.remove();
    timerCompletePlayer = null;
  }
}
