import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat } from "react-native-vision-camera";
import { NativeModulesProxy } from "expo-modules-core";
import { FOUR_K_CAPTURE_FORMAT, requestCameraPermissions, captureTimedVideo } from "../services/camera/cameraService";
import { preloadCaptureSound, playCaptureSound, unloadCaptureSound } from "../services/audio/soundService";
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
  SAVE_DESTINATION_DESCRIPTIONS,
  SAVE_DESTINATION_LABELS,
  SaveDestination
} from "../types/preferences";

const defaultJobConfig: CaptureJobConfig = {
  includeVideo: true,
  captureVideoMs: 4000,
  outputJpegQuality: 1
};

const SAVE_DESTINATIONS: SaveDestination[] = ["gallery", "files", "both"];

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
  const cameraRef = useRef<Camera>(null);

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

  const onCapturePress = useCallback(async () => {
    if (!cameraRef.current || !device || busy || !cameraReady) {
      return;
    }

    setBusy(true);
    setProgress(0);
    setErrorText(null);
    setLastSessionText(null);
    if (soundEnabled) {
      setCurrentStage("sound");
      setStatusText("Playing shutter sound...");
    } else {
      setCurrentStage("photos");
      setStatusText("Capturing base + flash source images...");
    }

    try {
      await triggerCaptureHaptic();
      if (soundEnabled) {
        await playCaptureSound();
      }

      setCurrentStage("photos");
      setStatusText("Capturing base + flash source images...");
      const bracket = await captureHardwareFlashBracket({
        cameraRef,
        device,
        setTorchOn,
        enableHardwareFlash: flashEnabled
      });

      let videoUri: string | undefined;
      let flashVideoUri: string | undefined;

      if (defaultJobConfig.includeVideo) {
        setCurrentStage("video");
        setStatusText("Recording 4-second video...");
        try {
          const video = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "off");
          videoUri = normalizeLocalMediaUri(video.path);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Failed to capture video", e);
        }

        if (flashEnabled) {
          setCurrentStage("flashVideo");
          setStatusText("Recording 4-second video with flash...");
          try {
            const flashVideo = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "on");
            flashVideoUri = normalizeLocalMediaUri(flashVideo.path);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to capture flash video", e);
          }
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
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Capture failed.");
      setStatusText("Failed");
    } finally {
      setCurrentStage(null);
      setBusy(false);
    }
  }, [busy, cameraReady, device, flashEnabled, soundEnabled]);

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
          zoom={device.neutralZoom}
          torch={torchOn ? "on" : "off"}
          photoQualityBalance="quality"
          onInitialized={() => setCameraReady(true)}
          onError={() => {
            setCameraReady(false);
            setErrorText("Camera preview failed to initialize.");
          }}
        />
          {!cameraReady ? (
            <View style={[StyleSheet.absoluteFill, styles.previewLoading]} pointerEvents="none">
              <ActivityIndicator color={colors.previewLoadingText} />
              <Text style={styles.cameraFacingLabel}>Preparing camera...</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.controls}>
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

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Sound</Text>
          <Switch
            value={soundEnabled}
            onValueChange={setSoundEnabled}
            disabled={isCaptureBusy}
            trackColor={{ false: switchColors.trackFalse, true: switchColors.trackTrue }}
            thumbColor={switchColors.thumb}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Flash</Text>
          <Switch
            value={flashEnabled}
            onValueChange={setFlashEnabled}
            disabled={isCaptureBusy}
            trackColor={{ false: switchColors.trackFalse, true: switchColors.trackTrue }}
            thumbColor={switchColors.thumb}
          />
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
          <Text style={styles.savePreferenceHint}>{SAVE_DESTINATION_DESCRIPTIONS[saveDestination]}</Text>
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

        <Pressable style={[styles.button, styles.captureButton]} onPress={onCapturePress} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? "Working..." : "Capture"}</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.reviewButton, galleryItems.length === 0 && styles.reviewButtonDisabled]}
          onPress={() => setIsReviewOpen(true)}
          disabled={busy || galleryItems.length === 0}
        >
          <Text style={styles.buttonText}>Open Gallery Review ({galleryItems.length})</Text>
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
  controls: {
    padding: 16,
    gap: 12
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  toggleLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
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
  savePreferenceHint: {
    color: colors.textMuted,
    fontSize: 12
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
