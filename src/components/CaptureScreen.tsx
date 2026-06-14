import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat } from "react-native-vision-camera";
import { NativeModulesProxy } from "expo-modules-core";
import { FOUR_K_CAPTURE_FORMAT, requestCameraPermissions, captureTimedVideo } from "../services/camera/cameraService";
import {
  preloadCaptureSound,
  startCaptureSound,
  playTimerCompleteSound,
  unloadCaptureSound
} from "../services/audio/soundService";
import { ViewfinderGridOverlay } from "./ViewfinderGridOverlay";
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

type CameraPosition = "back" | "front";
const CAMERA_POSITION_OPTIONS: CameraPosition[] = ["back", "front"];
const CAMERA_POSITION_LABELS: Record<CameraPosition, string> = {
  back: "Back",
  front: "Front"
};

const CAPTURE_COUNT_OPTIONS = [1, 2, 3] as const;
type CaptureCount = typeof CAPTURE_COUNT_OPTIONS[number];
const CAPTURE_COUNT_LABELS: Record<CaptureCount, string> = { 1: "1×", 2: "2×", 3: "3×" };

const ZOOM_STEP = 0.15;

/** Compact preview height vs. expanded height (~60% of the screen) for the "Large" viewfinder option. */
const PREVIEW_HEIGHT_COMPACT = 220;
const PREVIEW_HEIGHT_EXPANDED = Math.round(Dimensions.get("window").height * 0.6);

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

type CaptureStageKey = "photos" | "video" | "flashVideo" | "filters";

/** Share of the overall progress bar reserved for the pre-capture timer countdown. */
const TIMER_PROGRESS_SHARE = 0.1;

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
    } catch {
      // Thumbnail generation can fail transiently (e.g. file not yet fully
      // flushed to disk). The gallery item still works without a thumbnail.
    }
  } else if (!didWarnVideoThumbnailModuleMissing) {
    didWarnVideoThumbnailModuleMissing = true;
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
  const [viewfinderExpanded, setViewfinderExpanded] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(0);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>("back");
  const [isCancelling, setIsCancelling] = useState(false);
  const [captureCount, setCaptureCount] = useState<CaptureCount>(1);
  const [currentCaptureIndex, setCurrentCaptureIndex] = useState(0);
  const cameraRef = useRef<Camera>(null);
  /** Set to true when the user requests a cancel; checked between pipeline steps. */
  const cancelRequestedRef = useRef(false);
  /** Tracks media created during the in-flight capture so a cancel can delete it. */
  const pendingCleanupUrisRef = useRef<string[]>([]);
  /** Whether the in-flight capture started with a pre-capture timer. */
  const captureUsedTimerRef = useRef(false);
  /** Delays surfacing preview errors so transient flip/switch glitches can recover. */
  const cameraErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once the preview has actually streamed a frame for the current device. */
  const previewStartedRef = useRef(false);

  const frontDevice = useCameraDevice("front");
  const device = useCameraDevice(cameraPosition);
  /** Prefer 4K for both photo and video capture; falls back to device max. */
  const format = useCameraFormat(device, FOUR_K_CAPTURE_FORMAT);

  const captureStageKeys = useMemo<CaptureStageKey[]>(() => {
    const stages: CaptureStageKey[] = [];
    stages.push("photos", "video");
    if (flashEnabled && device?.hasFlash) {
      stages.push("flashVideo");
    }
    stages.push("filters");
    return stages;
  }, [device?.hasFlash, flashEnabled]);

  const stageIndexByKey = useMemo(() => {
    return captureStageKeys.reduce<Partial<Record<CaptureStageKey, number>>>((acc, stageKey, index) => {
      acc[stageKey] = index;
      return acc;
    }, {});
  }, [captureStageKeys]);

  const isCaptureBusy = busy || currentStage !== null;
  const captureProgressTitle = isCancelling
    ? "Cancelling..."
    : countdownRemaining != null && countdownRemaining > 0
      ? `Get ready... ${countdownRemaining}`
      : captureCount > 1 && currentCaptureIndex > 0
        ? `Capture ${currentCaptureIndex} of ${captureCount}`
        : "Almost There";
  const overallProgress = useMemo(() => {
    if (!isCaptureBusy) {
      return 0;
    }

    const pipelineShare = captureUsedTimerRef.current ? 1 - TIMER_PROGRESS_SHARE : 1;

    let singleCaptureProgress = 0;
    if (countdownRemaining != null && timerSeconds > 0) {
      const timerFraction = (timerSeconds - countdownRemaining) / timerSeconds;
      singleCaptureProgress = timerFraction * TIMER_PROGRESS_SHARE;
    } else {
      let pipelineProgress = 0;
      if (currentStage === "filters") {
        const filterStageIndex = stageIndexByKey.filters ?? captureStageKeys.length - 1;
        pipelineProgress = (filterStageIndex + progress) / captureStageKeys.length;
      } else if (currentStage) {
        const stageIndex = stageIndexByKey[currentStage] ?? 0;
        pipelineProgress = (stageIndex + 1) / captureStageKeys.length;
      }

      const pipelineBase = captureUsedTimerRef.current ? TIMER_PROGRESS_SHARE : 0;
      singleCaptureProgress = pipelineBase + pipelineProgress * pipelineShare;
    }

    if (captureCount > 1) {
      const completedFraction = (currentCaptureIndex - 1) / captureCount;
      return completedFraction + singleCaptureProgress / captureCount;
    }

    return singleCaptureProgress;
  }, [
    captureCount,
    captureStageKeys.length,
    countdownRemaining,
    currentCaptureIndex,
    currentStage,
    isCaptureBusy,
    progress,
    stageIndexByKey,
    timerSeconds
  ]);

  const onCameraPositionChange = useCallback(
    (position: CameraPosition) => {
      if (isCaptureBusy) {
        return;
      }
      setCameraPosition(position);
      setTorchOn(false);
    },
    [isCaptureBusy]
  );

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
      if (cameraErrorTimeoutRef.current) {
        clearTimeout(cameraErrorTimeoutRef.current);
        cameraErrorTimeoutRef.current = null;
      }
    };
  }, []);

  const onSaveDestinationChange = useCallback(async (destination: SaveDestination) => {
    setSaveDestinationState(destination);
    await setSaveDestination(destination);
  }, []);

  useEffect(() => {
    setCameraReady(false);
    setErrorText(null);
    previewStartedRef.current = false;
    if (cameraErrorTimeoutRef.current) {
      clearTimeout(cameraErrorTimeoutRef.current);
      cameraErrorTimeoutRef.current = null;
    }
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
    captureUsedTimerRef.current = timerSeconds > 0;
    setIsCancelling(false);
    setBusy(true);
    setProgress(0);
    setCurrentCaptureIndex(0);
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
      try {
        await runCountdown(
          timerSeconds,
          (remaining) => {
            setCountdownRemaining(remaining > 0 ? remaining : null);
          },
          () => cancelRequestedRef.current
        );
      } finally {
        setCountdownRemaining(null);
      }
    }

    try {
      for (let i = 1; i <= captureCount; i++) {
        setCurrentCaptureIndex(i);
        setProgress(0);

        setCurrentStage("photos");
        throwIfCancelled();
        await triggerCaptureHaptic();
        if (soundEnabled) {
          startCaptureSound();
        }
        throwIfCancelled();
        setCurrentStage("photos");
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
          try {
            const video = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "off");
            videoUri = normalizeLocalMediaUri(video.path);
            trackForCleanup(videoUri);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to capture video", e);
          }
          throwIfCancelled();

          if (flashEnabled && device.hasFlash) {
            setCurrentStage("flashVideo");
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
      }

      setLastSessionText("Done");

      if (usedTimer && soundEnabled) {
        await playTimerCompleteSound();
      }
    } catch (error) {
      if (error instanceof CaptureCancelledError) {
        // Delete anything captured before the cancel so nothing is left behind.
        const urisToDelete = [...new Set(pendingCleanupUrisRef.current)];
        await Promise.all(urisToDelete.map((uri) => deleteMedia(uri).catch(() => null)));
        setLastSessionText(null);
      } else {
        setErrorText(error instanceof Error ? error.message : "Capture failed.");
      }
    } finally {
      pendingCleanupUrisRef.current = [];
      captureUsedTimerRef.current = false;
      cancelRequestedRef.current = false;
      setTorchOn(false);
      setIsCancelling(false);
      setCurrentStage(null);
      setCurrentCaptureIndex(0);
      setBusy(false);
    }
  }, [busy, captureCount, cameraReady, device, flashEnabled, soundEnabled, timerSeconds]);

  const cancelCapture = useCallback(() => {
    if (!cancelRequestedRef.current) {
      cancelRequestedRef.current = true;
      setIsCancelling(true);
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
        <View style={styles.facingRow}>
          {CAMERA_POSITION_OPTIONS.map((position) => {
            const isActive = cameraPosition === position;
            const isDisabled = isCaptureBusy || (position === "front" && !frontDevice);
            return (
              <Pressable
                key={position}
                style={[
                  styles.facingButton,
                  isActive && styles.facingButtonActive,
                  isDisabled && styles.facingButtonDisabled
                ]}
                onPress={() => onCameraPositionChange(position)}
                disabled={isDisabled}
                accessibilityRole="button"
                accessibilityLabel={position === "back" ? "Use back camera" : "Use front camera"}
                accessibilityState={{ selected: isActive, disabled: isDisabled }}
              >
                <Text style={[styles.facingButtonText, isActive && styles.facingButtonTextActive]}>
                  {CAMERA_POSITION_LABELS[position]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.previewWrap, viewfinderExpanded && styles.previewWrapExpanded]}>
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
          isMirrored={cameraPosition === "front"}
          torch={torchOn && device.hasTorch ? "on" : "off"}
          photoQualityBalance="quality"
          onInitialized={() => {
            if (cameraErrorTimeoutRef.current) {
              clearTimeout(cameraErrorTimeoutRef.current);
              cameraErrorTimeoutRef.current = null;
            }
            setCameraReady(true);
            setErrorText(null);
          }}
          onPreviewStarted={() => {
            previewStartedRef.current = true;
            if (cameraErrorTimeoutRef.current) {
              clearTimeout(cameraErrorTimeoutRef.current);
              cameraErrorTimeoutRef.current = null;
            }
            setCameraReady(true);
            setErrorText(null);
          }}
          onPreviewStopped={() => {
            previewStartedRef.current = false;
          }}
          onError={(error) => {
            // These codes are non-fatal: they don't prevent preview from
            // working and fire routinely when switching to a camera that
            // lacks the feature (e.g. front camera has no flash/torch).
            const NON_FATAL_CODES = new Set([
              "device/flash-unavailable",
              "device/focus-not-supported",
              "device/microphone-unavailable",
              "session/audio-in-use-by-other-app",
              "session/audio-session-failed-to-activate"
            ]);
            if (NON_FATAL_CODES.has(error.code)) {
              return;
            }
            if (__DEV__) {
              console.warn(`[Camera] ${error.code}: ${error.message}`);
            }
            if (cameraErrorTimeoutRef.current) {
              clearTimeout(cameraErrorTimeoutRef.current);
            }
            // Only surface an error message if the preview genuinely never
            // starts after a grace period (covers transient session resets
            // that happen when switching devices).
            cameraErrorTimeoutRef.current = setTimeout(() => {
              cameraErrorTimeoutRef.current = null;
              if (previewStartedRef.current) {
                return;
              }
              setCameraReady(false);
              setErrorText("Camera preview failed to initialize.");
            }, 2000);
          }}
        />
          {gridEnabled && cameraReady ? <ViewfinderGridOverlay /> : null}
          {countdownRemaining != null && countdownRemaining > 0 ? (
            <View style={[StyleSheet.absoluteFill, styles.countdownOverlay]} pointerEvents="none">
              <Text style={styles.countdownNumber}>{countdownRemaining}</Text>
              <Text style={styles.countdownHint}>Hold still</Text>
            </View>
          ) : null}
          {!cameraReady && (countdownRemaining == null || countdownRemaining <= 0) ? (
            <View style={[StyleSheet.absoluteFill, styles.previewLoading]} pointerEvents="none">
              <ActivityIndicator color={colors.previewLoadingText} />
              <Text style={styles.cameraFacingLabel}>Preparing camera...</Text>
            </View>
          ) : null}
          {viewfinderExpanded ? (
            <Pressable
              style={styles.viewfinderCollapseButton}
              onPress={() => setViewfinderExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel="Collapse viewfinder"
            >
              <Text style={styles.viewfinderCollapseText}>⌃ Small</Text>
            </Pressable>
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
            <Text style={styles.captureProgressTitle}>{captureProgressTitle}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(5, Math.round(overallProgress * 100))}%` }]} />
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
          <View style={styles.quickToggle}>
            <Text style={styles.quickToggleLabel}>Large</Text>
            <View style={styles.quickToggleSwitchWrap}>
              <Switch
                value={viewfinderExpanded}
                onValueChange={setViewfinderExpanded}
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
          <Text style={styles.savePreferenceTitle}>Shots</Text>
          <View style={styles.savePreferenceRow}>
            {CAPTURE_COUNT_OPTIONS.map((count) => {
              const isActive = captureCount === count;
              return (
                <Pressable
                  key={count}
                  style={[styles.savePreferenceButton, isActive && styles.savePreferenceButtonActive]}
                  onPress={() => setCaptureCount(count)}
                  disabled={isCaptureBusy}
                >
                  <Text style={[styles.savePreferenceButtonText, isActive && styles.savePreferenceButtonTextActive]}>
                    {CAPTURE_COUNT_LABELS[count]}
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
    height: PREVIEW_HEIGHT_COMPACT,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: colors.previewFrame
  },
  previewWrapExpanded: {
    height: PREVIEW_HEIGHT_EXPANDED
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
  facingRow: {
    flexDirection: "row",
    gap: 8
  },
  facingButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 8,
    alignItems: "center"
  },
  facingButtonActive: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.chipActiveBg
  },
  facingButtonDisabled: {
    opacity: 0.5
  },
  facingButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600"
  },
  facingButtonTextActive: {
    color: colors.text
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
  viewfinderCollapseButton: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: colors.mediaOverlay,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  viewfinderCollapseText: {
    color: colors.textOnAccent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4
  },
  countdownOverlay: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.countdownOverlay
  },
  countdownNumber: {
    color: colors.textOnAccent,
    fontSize: 72,
    fontWeight: "800",
    lineHeight: 80
  },
  countdownHint: {
    color: colors.previewLoadingText,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 4,
    opacity: 0.85
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
