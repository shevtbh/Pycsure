import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat } from "react-native-vision-camera";
import { NativeModulesProxy } from "expo-modules-core";
import { FOUR_K_CAPTURE_FORMAT, requestCameraPermissions, captureTimedVideo } from "../services/camera/cameraService";
import {
  preloadCaptureSound,
  playCaptureSound,
  playTimerCompleteSound,
  unloadCaptureSound
} from "../services/audio/soundService";
import { ViewfinderGridOverlay } from "./ViewfinderGridOverlay";
import { CaptureCountdownOverlay } from "./CaptureCountdownOverlay";
import { runCountdown } from "../utils/runCountdown";
import { getRandomPrompt } from "../services/prompts/promptService";
import { processCapture } from "../services/pipeline/batchProcessor";
import { captureHardwareFlashBracket } from "../services/camera/flashBracketCapture";
import { CaptureJobConfig, PromptItem } from "../types/pipeline";
import { MediaItem, ResultReviewView } from "./ResultReviewView";
import { deleteMedia, exportCapturesByPreference, normalizeLocalMediaUri } from "../services/storage/mediaStorage";
import { getSaveDestination, setSaveDestination } from "../services/storage/savePreferenceService";
import { triggerCaptureHaptic, triggerPromptHaptic } from "../services/haptics/hapticService";
import { colors, switchColors } from "../constants/theme";
import {
  SAVE_DESTINATION_LABELS,
  SaveDestination
} from "../types/preferences";

const defaultJobConfig: CaptureJobConfig = {
  includeVideo: true,
  captureVideoMs: 4000,
  outputJpegQuality: 1
};

const SAVE_DESTINATIONS: SaveDestination[] = ["gallery", "files", "both"];

type TimerSeconds = 0 | 3 | 5 | 10;
const TIMER_OPTIONS: TimerSeconds[] = [0, 3, 5, 10];
const TIMER_LABELS: Record<TimerSeconds, string> = {
  0: "Off",
  3: "3s",
  5: "5s",
  10: "10s"
};

const ZOOM_STEP = 0.15;

/** Thrown internally to unwind the capture pipeline when the user hits Cancel. */
class CaptureCancelledError extends Error {
  constructor() {
    super("Capture cancelled");
    this.name = "CaptureCancelledError";
  }
}

type ExpoVideoThumbnailsModuleShape = {
  getThumbnailAsync: (
    sourceFilename: string,
    options?: { time?: number; quality?: number }
  ) => Promise<{ uri: string }>;
};

let cachedVideoThumbnailsModule: ExpoVideoThumbnailsModuleShape | null | undefined;
let didWarnVideoThumbnailModuleMissing = false;

type CaptureStageKey = "sound" | "photos" | "video" | "flashVideo" | "filters";

const CAPTURE_STAGE_LABELS: Record<CaptureStageKey, string> = {
  sound: "Sound",
  photos: "Photos",
  video: "Video",
  flashVideo: "Flash Video",
  filters: "Filters"
};

function getVideoThumbnailsModule(): ExpoVideoThumbnailsModuleShape | null {
  if (cachedVideoThumbnailsModule !== undefined) {
    return cachedVideoThumbnailsModule;
  }

  if (!NativeModulesProxy?.ExpoVideoThumbnails) {
    cachedVideoThumbnailsModule = null;
    return cachedVideoThumbnailsModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedVideoThumbnailsModule = require("expo-video-thumbnails") as ExpoVideoThumbnailsModuleShape;
  } catch {
    cachedVideoThumbnailsModule = null;
  }

  return cachedVideoThumbnailsModule;
}

async function buildVideoGalleryItem(uri: string, label: string): Promise<MediaItem> {
  let thumbnailUri: string | undefined;
  const videoThumbnailsModule = getVideoThumbnailsModule();

  if (videoThumbnailsModule) {
    try {
      const thumbnail = await videoThumbnailsModule.getThumbnailAsync(uri, {
        time: 0,
        quality: 0.7
      });
      thumbnailUri = thumbnail.uri;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to generate thumbnail for ${label.toLowerCase()}`, error);
    }
  } else if (!didWarnVideoThumbnailModuleMissing) {
    didWarnVideoThumbnailModuleMissing = true;
    // eslint-disable-next-line no-console
    console.warn("expo-video-thumbnails native module is unavailable; video thumbnails are disabled for this run.");
  }

  return {
    uri,
    type: "video",
    label,
    thumbnailUri
  };
}

export function CaptureScreen() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Ready");
  const [prompt, setPrompt] = useState<PromptItem | null>(null);
  const [lastSessionText, setLastSessionText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [flashEnabled, setFlashEnabled] = useState(true);
  const [saveDestination, setSaveDestinationState] = useState<SaveDestination>("gallery");
  const [galleryItems, setGalleryItems] = useState<MediaItem[]>([]);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<CaptureStageKey | null>(null);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(0);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isCancelling, setIsCancelling] = useState(false);
  const cameraRef = useRef<Camera>(null);
  /** Set to true when the user requests a cancel; checked between pipeline steps. */
  const cancelRequestedRef = useRef(false);
  /** Tracks media created during the in-flight capture so a cancel can delete it. */
  const pendingCleanupUrisRef = useRef<string[]>([]);

  const device = useCameraDevice("back");
  /** Prefer 4K for both photo and video capture; falls back to device max. */
  const format = useCameraFormat(device, FOUR_K_CAPTURE_FORMAT);

  const captureStageKeys = useMemo<CaptureStageKey[]>(() => {
    const stages: CaptureStageKey[] = [];
    if (soundEnabled) {
      stages.push("sound");
    }
    stages.push("photos", "video");
    if (flashEnabled) {
      stages.push("flashVideo");
    }
    stages.push("filters");
    return stages;
  }, [flashEnabled, soundEnabled]);

  const stageIndexByKey = useMemo(() => {
    return captureStageKeys.reduce<Partial<Record<CaptureStageKey, number>>>((acc, stageKey, index) => {
      acc[stageKey] = index;
      return acc;
    }, {});
  }, [captureStageKeys]);

  const activeStageIndex = currentStage != null ? (stageIndexByKey[currentStage] ?? -1) : -1;
  const isCaptureBusy = busy || currentStage !== null;
  const progressWithinStage = currentStage === "filters" ? progress : currentStage ? 1 : 0;
  const overallProgress = useMemo(() => {
    if (!isCaptureBusy) {
      return 0;
    }

    if (currentStage === "filters") {
      const filterStageIndex = stageIndexByKey.filters ?? captureStageKeys.length - 1;
      return (filterStageIndex + progress) / captureStageKeys.length;
    }

    if (!currentStage) {
      return 0;
    }

    const stageIndex = stageIndexByKey[currentStage] ?? 0;
    return (stageIndex + 1) / captureStageKeys.length;
  }, [captureStageKeys.length, currentStage, isCaptureBusy, progress, stageIndexByKey]);

  const loadPrompt = useCallback(async () => {
    await triggerPromptHaptic();
    const next = await getRandomPrompt();
    setPrompt(next);
  }, []);

  useEffect(() => {
    requestCameraPermissions()
      .then((result) => setPermissionGranted(result.granted))
      .catch(() => setPermissionGranted(false));

    getSaveDestination()
      .then(setSaveDestinationState)
      .catch(() => null);

    preloadCaptureSound().catch(() => null);
    return () => {
      unloadCaptureSound().catch(() => null);
    };
  }, []);

  const onSaveDestinationChange = useCallback(async (destination: SaveDestination) => {
    setSaveDestinationState(destination);
    await setSaveDestination(destination);
  }, []);

  useEffect(() => {
    setCameraReady(false);
  }, [device]);

  useEffect(() => {
    if (device) {
      setZoom(device.neutralZoom);
    }
  }, [device]);

  const clampZoom = useCallback(
    (value: number) => {
      if (!device) {
        return value;
      }
      return Math.min(Math.max(value, device.minZoom), device.maxZoom);
    },
    [device]
  );

  const adjustZoom = useCallback(
    (delta: number) => {
      setZoom((current) => clampZoom(current + delta));
    },
    [clampZoom]
  );

  const onCapturePress = useCallback(async () => {
    if (!cameraRef.current || !device || busy || !cameraReady) {
      return;
    }

    cancelRequestedRef.current = false;
    pendingCleanupUrisRef.current = [];
    setIsCancelling(false);
    setBusy(true);
    setProgress(0);
    setErrorText(null);
    setLastSessionText(null);

    const trackForCleanup = (...uris: (string | undefined)[]) => {
      uris.forEach((uri) => {
        if (uri) {
          pendingCleanupUrisRef.current.push(uri);
        }
      });
    };
    const throwIfCancelled = () => {
      if (cancelRequestedRef.current) {
        throw new CaptureCancelledError();
      }
    };

    const usedTimer = timerSeconds > 0;
    if (usedTimer) {
      setStatusText(`Capturing in ${timerSeconds}...`);
      try {
        await runCountdown(
          timerSeconds,
          (remaining) => {
            setCountdownRemaining(remaining > 0 ? remaining : null);
            if (remaining > 0) {
              setStatusText(`Capturing in ${remaining}...`);
            }
          },
          () => cancelRequestedRef.current
        );
      } finally {
        setCountdownRemaining(null);
      }
    }

    if (soundEnabled) {
      setCurrentStage("sound");
      setStatusText("Playing shutter sound...");
    } else {
      setCurrentStage("photos");
      setStatusText("Capturing base + flash source images...");
    }

    try {
      throwIfCancelled();
      await triggerCaptureHaptic();
      if (soundEnabled) {
        await playCaptureSound();
      }

      throwIfCancelled();
      setCurrentStage("photos");
      setStatusText("Capturing base + flash source images...");
      const bracket = await captureHardwareFlashBracket({
        cameraRef,
        device,
        setTorchOn,
        enableHardwareFlash: flashEnabled
      });
      trackForCleanup(bracket.baseImageUri, ...Object.values(bracket.baseImageByFlash ?? {}));
      throwIfCancelled();

      let videoUri: string | undefined;
      let flashVideoUri: string | undefined;

      if (defaultJobConfig.includeVideo) {
        setCurrentStage("video");
        setStatusText("Recording 4-second video...");
        try {
          const video = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "off");
          videoUri = normalizeLocalMediaUri(video.path);
          trackForCleanup(videoUri);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Failed to capture video", e);
        }
        throwIfCancelled();

        if (flashEnabled) {
          setCurrentStage("flashVideo");
          setStatusText("Recording 4-second video with flash...");
          try {
            const flashVideo = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "on");
            flashVideoUri = normalizeLocalMediaUri(flashVideo.path);
            trackForCleanup(flashVideoUri);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to capture flash video", e);
          }
          throwIfCancelled();
        }
      }

      setCurrentStage("filters");
      setStatusText("Applying Standard + Vintage + B&W filters (flash/no-flash)...");
      const result = await processCapture({
        baseImageUri: bracket.baseImageUri,
        baseImageByFlash: bracket.baseImageByFlash,
        videoUri,
        flashVideoUri,
        config: defaultJobConfig,
        onVariantDone: setProgress
      });
      trackForCleanup(
        result.videoUri,
        result.flashVideoUri,
        ...result.outputs.map((output) => output.localUri)
      );
      throwIfCancelled();

      setStatusText("Done");
      const photoWord = result.outputs.length === 1 ? "photo" : "photos";
      setLastSessionText(
        `${result.outputs.length} ${photoWord} ready in ${Math.round(result.elapsedMs / 100) / 10}s`
      );

      // Cleanup base images since they are no longer needed
      deleteMedia(bracket.baseImageUri).catch(() => null);
      if (bracket.baseImageByFlash) {
        Object.values(bracket.baseImageByFlash).forEach(uri => {
          if (uri !== bracket.baseImageUri) {
            deleteMedia(uri).catch(() => null);
          }
        });
      }

      const videoItems = await Promise.all([
        ...(result.videoUri ? [buildVideoGalleryItem(result.videoUri, "Video")] : []),
        ...(result.flashVideoUri ? [buildVideoGalleryItem(result.flashVideoUri, "Flash Video")] : [])
      ]);

      const nextItems: MediaItem[] = [
        ...result.outputs.map((output) => ({
          uri: output.localUri,
          type: "image" as const,
          label: `${output.variant.filterId} ${output.variant.flashMode}`
        })),
        ...videoItems
      ];
      setGalleryItems((prev) => {
        const seen = new Set(prev.map((item) => item.uri));
        const dedupedNew = nextItems.filter((item) => !seen.has(item.uri));
        return [...prev, ...dedupedNew];
      });

      if (usedTimer) {
        await playTimerCompleteSound();
      }
    } catch (error) {
      if (error instanceof CaptureCancelledError) {
        // Delete anything captured before the cancel so nothing is left behind.
        const urisToDelete = [...new Set(pendingCleanupUrisRef.current)];
        await Promise.all(urisToDelete.map((uri) => deleteMedia(uri).catch(() => null)));
        setStatusText("Cancelled");
        setLastSessionText(null);
      } else {
        setErrorText(error instanceof Error ? error.message : "Capture failed.");
        setStatusText("Failed");
      }
    } finally {
      pendingCleanupUrisRef.current = [];
      cancelRequestedRef.current = false;
      setTorchOn(false);
      setIsCancelling(false);
      setCurrentStage(null);
      setBusy(false);
    }
  }, [busy, cameraReady, device, flashEnabled, soundEnabled, timerSeconds]);

  const cancelCapture = useCallback(() => {
    if (!cancelRequestedRef.current) {
      cancelRequestedRef.current = true;
      setIsCancelling(true);
      setStatusText("Cancelling...");
      setCountdownRemaining(null);
      // Stop an in-flight recording so its promise resolves immediately
      // instead of waiting out the full 4-second timer.
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // No recording in progress; ignore.
      }
    }
  }, []);

  const handleFrameExtracted = useCallback((item: MediaItem) => {
    setGalleryItems((prev) => {
      const seen = new Set(prev.map((entry) => entry.uri));
      if (seen.has(item.uri)) {
        return prev;
      }
      return [...prev, item];
    });
  }, []);

  if (!permissionGranted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.title}>Pycsure</Text>
        <Text style={styles.body}>Camera and microphone permissions are required.</Text>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Waiting for camera device...</Text>
      </SafeAreaView>
    );
  }

  const handleSaveSelected = async (uris: string[]) => {
    await exportCapturesByPreference(uris, saveDestination);

    for (const item of galleryItems) {
      await deleteMedia(item.uri);
      if (item.thumbnailUri) {
        await deleteMedia(item.thumbnailUri);
      }
    }

    setGalleryItems([]);
  };

  const handleDiscardAll = async () => {
    for (const item of galleryItems) {
      await deleteMedia(item.uri);
      if (item.thumbnailUri) {
        await deleteMedia(item.thumbnailUri);
      }
    }
    setGalleryItems([]);
  };

  if (isReviewOpen) {
    return (
      <ResultReviewView
        mediaItems={galleryItems}
        onClose={() => setIsReviewOpen(false)}
        onSaveSelected={handleSaveSelected}
        onDiscardAll={handleDiscardAll}
        onFrameExtracted={handleFrameExtracted}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.previewSection}>
        <Text style={styles.previewLabel}>Live Viewfinder</Text>
        <View style={styles.previewWrap}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          photo
          video
          format={format}
          zoom={zoom}
          enableZoomGesture={!isCaptureBusy}
          torch={torchOn ? "on" : "off"}
          photoQualityBalance="quality"
          onInitialized={() => setCameraReady(true)}
          onError={() => {
            setCameraReady(false);
            setErrorText("Camera preview failed to initialize.");
          }}
        />
          {gridEnabled && cameraReady ? <ViewfinderGridOverlay /> : null}
          {countdownRemaining != null ? (
            <CaptureCountdownOverlay secondsRemaining={countdownRemaining} />
          ) : null}
          {!cameraReady ? (
            <View style={[StyleSheet.absoluteFill, styles.previewLoading]} pointerEvents="none">
              <ActivityIndicator color={colors.previewLoadingText} />
              <Text style={styles.cameraFacingLabel}>Preparing camera...</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.zoomControls}>
          <Pressable
            style={[styles.zoomButton, isCaptureBusy && styles.zoomButtonDisabled]}
            onPress={() => adjustZoom(-ZOOM_STEP)}
            disabled={isCaptureBusy}
          >
            <Text style={styles.zoomButtonText}>−</Text>
          </Pressable>
          <Text style={styles.zoomLabel}>Pinch or use buttons to zoom</Text>
          <Pressable
            style={[styles.zoomButton, isCaptureBusy && styles.zoomButtonDisabled]}
            onPress={() => adjustZoom(ZOOM_STEP)}
            disabled={isCaptureBusy}
          >
            <Text style={styles.zoomButtonText}>+</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {isCaptureBusy ? (
          <View style={styles.captureProgressCard}>
            <Text style={styles.captureProgressTitle}>{statusText}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(5, Math.round(overallProgress * 100))}%` }]} />
            </View>
            <View style={styles.stageChips}>
              {captureStageKeys.map((stageKey, index) => {
                const isActive = index === activeStageIndex;
                const isComplete = index < activeStageIndex || (index === activeStageIndex && progressWithinStage >= 1);
                return (
                  <View
                    key={stageKey}
                    style={[
                      styles.stageChip,
                      isComplete && styles.stageChipComplete,
                      isActive && styles.stageChipActive
                    ]}
                  >
                    <Text style={styles.stageChipText}>
                      {isComplete ? `✓ ${CAPTURE_STAGE_LABELS[stageKey]}` : CAPTURE_STAGE_LABELS[stageKey]}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
        {!isCaptureBusy && lastSessionText ? <Text style={styles.successText}>{lastSessionText}</Text> : null}
        {!isCaptureBusy && !lastSessionText ? <Text style={styles.body}>Ready to shoot your next set.</Text> : null}
        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

        <View style={styles.quickToggleRow}>
          <View style={styles.quickToggle}>
            <Text style={styles.quickToggleLabel}>Sound</Text>
            <View style={styles.quickToggleSwitchWrap}>
              <Switch
                value={soundEnabled}
                onValueChange={setSoundEnabled}
                disabled={isCaptureBusy}
                trackColor={{ false: switchColors.trackFalse, true: switchColors.trackTrue }}
                thumbColor={switchColors.thumb}
              />
            </View>
          </View>
          <View style={styles.quickToggle}>
            <Text style={styles.quickToggleLabel}>Flash</Text>
            <View style={styles.quickToggleSwitchWrap}>
              <Switch
                value={flashEnabled}
                onValueChange={setFlashEnabled}
                disabled={isCaptureBusy}
                trackColor={{ false: switchColors.trackFalse, true: switchColors.trackTrue }}
                thumbColor={switchColors.thumb}
              />
            </View>
          </View>
          <View style={styles.quickToggle}>
            <Text style={styles.quickToggleLabel}>Grid</Text>
            <View style={styles.quickToggleSwitchWrap}>
              <Switch
                value={gridEnabled}
                onValueChange={setGridEnabled}
                disabled={isCaptureBusy}
                trackColor={{ false: switchColors.trackFalse, true: switchColors.trackTrue }}
                thumbColor={switchColors.thumb}
              />
            </View>
          </View>
        </View>

        <View style={styles.savePreferenceSection}>
          <Text style={styles.savePreferenceTitle}>Timer</Text>
          <View style={styles.savePreferenceRow}>
            {TIMER_OPTIONS.map((option) => {
              const isActive = timerSeconds === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.savePreferenceButton, isActive && styles.savePreferenceButtonActive]}
                  onPress={() => setTimerSeconds(option)}
                  disabled={isCaptureBusy}
                >
                  <Text style={[styles.savePreferenceButtonText, isActive && styles.savePreferenceButtonTextActive]}>
                    {TIMER_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.savePreferenceSection}>
          <Text style={styles.savePreferenceTitle}>Save To</Text>
          <View style={styles.savePreferenceRow}>
            {SAVE_DESTINATIONS.map((destination) => {
              const isActive = saveDestination === destination;
              return (
                <Pressable
                  key={destination}
                  style={[styles.savePreferenceButton, isActive && styles.savePreferenceButtonActive]}
                  onPress={() => onSaveDestinationChange(destination)}
                  disabled={isCaptureBusy}
                >
                  <Text style={[styles.savePreferenceButtonText, isActive && styles.savePreferenceButtonTextActive]}>
                    {SAVE_DESTINATION_LABELS[destination]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable style={[styles.button, styles.promptButton]} onPress={loadPrompt} disabled={busy}>
          <Text style={styles.buttonText}>Give Prompt</Text>
        </Pressable>

        {prompt ? (
          <View style={styles.promptCard}>
            <Text style={styles.promptVibe}>Vibe: {prompt.vibe}</Text>
            <Text style={styles.promptText}>{prompt.text}</Text>
            <Pressable style={[styles.button, styles.rerollButton]} onPress={loadPrompt} disabled={busy}>
              <Text style={styles.buttonText}>Reroll Prompt</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.actionBar}>
        {isCaptureBusy ? (
          <Pressable
            style={[styles.button, styles.cancelButton, styles.captureButtonInBar, isCancelling && styles.cancelButtonDisabled]}
            onPress={cancelCapture}
            disabled={isCancelling}
          >
            <Text style={styles.buttonText}>{isCancelling ? "Cancelling..." : "Cancel"}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.button, styles.captureButton, styles.captureButtonInBar]}
            onPress={onCapturePress}
            disabled={!cameraReady}
          >
            <Text style={styles.buttonText}>Capture</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.button, styles.reviewButton, styles.reviewButtonInBar, galleryItems.length === 0 && styles.reviewButtonDisabled]}
          onPress={() => setIsReviewOpen(true)}
          disabled={busy || galleryItems.length === 0}
        >
          <Text style={styles.buttonText}>Gallery ({galleryItems.length})</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  previewWrap: {
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.previewFrame
  },
  previewSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8
  },
  previewLabel: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  zoomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  zoomButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center"
  },
  zoomButtonDisabled: {
    opacity: 0.5
  },
  zoomButtonText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24
  },
  zoomLabel: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center"
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.previewOverlay
  },
  cameraFacingLabel: {
    color: colors.previewLoadingText,
    fontSize: 12,
    marginTop: 8
  },
  scrollArea: {
    flex: 1,
    marginTop: 8
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 12
  },
  quickToggleRow: {
    flexDirection: "row",
    gap: 10
  },
  quickToggle: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 14
  },
  quickToggleLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
    alignSelf: "stretch"
  },
  quickToggleSwitchWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  actionBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background
  },
  captureButtonInBar: {
    flex: 2
  },
  reviewButtonInBar: {
    flex: 1
  },
  title: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 20
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14
  },
  successText: {
    color: colors.success,
    fontSize: 14
  },
  error: {
    color: colors.error,
    fontSize: 14
  },
  savePreferenceSection: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8
  },
  savePreferenceTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  savePreferenceRow: {
    flexDirection: "row",
    gap: 8
  },
  savePreferenceButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chipBg,
    paddingVertical: 10,
    alignItems: "center"
  },
  savePreferenceButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.chipActiveBg
  },
  savePreferenceButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600"
  },
  savePreferenceButtonTextActive: {
    color: colors.text
  },
  captureProgressCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 10,
    gap: 8
  },
  captureProgressTitle: {
    color: colors.text,
    fontSize: 13
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.progressTrack,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.progressFill
  },
  stageChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  stageChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.chipBg
  },
  stageChipActive: {
    borderColor: colors.chipActiveBorder,
    backgroundColor: colors.chipActiveBg
  },
  stageChipComplete: {
    borderColor: colors.chipCompleteBorder,
    backgroundColor: colors.chipCompleteBg
  },
  stageChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600"
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  buttonText: {
    color: colors.textOnAccent,
    fontWeight: "600"
  },
  promptButton: {
    backgroundColor: colors.secondary
  },
  captureButton: {
    backgroundColor: colors.primary
  },
  cancelButton: {
    backgroundColor: colors.error
  },
  cancelButtonDisabled: {
    opacity: 0.7
  },
  rerollButton: {
    backgroundColor: colors.primaryDark,
    marginTop: 8
  },
  reviewButton: {
    backgroundColor: colors.accent
  },
  reviewButtonDisabled: {
    backgroundColor: colors.sand,
    opacity: 0.85
  },
  promptCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1
  },
  promptVibe: {
    color: colors.caramel,
    marginBottom: 4,
    fontWeight: "600"
  },
  promptText: {
    color: colors.text,
    fontSize: 15
  }
});
