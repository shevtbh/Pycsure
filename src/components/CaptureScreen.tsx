import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat, Templates } from "react-native-vision-camera";
import { NativeModulesProxy } from "expo-modules-core";
import { requestCameraPermissions, captureTimedVideo } from "../services/camera/cameraService";
import { preloadCaptureSound, playCaptureSound, unloadCaptureSound } from "../services/audio/soundService";
import { getRandomPrompt } from "../services/prompts/promptService";
import { processCapture } from "../services/pipeline/batchProcessor";
import { captureHardwareFlashBracket } from "../services/camera/flashBracketCapture";
import { CaptureJobConfig, PromptItem } from "../types/pipeline";
import { MediaItem, ResultReviewView } from "./ResultReviewView";
import { deleteMedia, normalizeLocalMediaUri, saveToGallery } from "../services/storage/mediaStorage";
import { triggerCaptureHaptic, triggerPromptHaptic } from "../services/haptics/hapticService";

const defaultJobConfig: CaptureJobConfig = {
  saveToGallery: false,
  includeVideo: true,
  captureVideoMs: 4000,
  outputJpegQuality: 0.9
};

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
  const [galleryItems, setGalleryItems] = useState<MediaItem[]>([]);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<CaptureStageKey | null>(null);
  const cameraRef = useRef<Camera>(null);

  const device = useCameraDevice("back");
  /** Keep video-capable format for stable preview/capture behavior across devices. */
  const format = useCameraFormat(device, Templates.Video);

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

    preloadCaptureSound().catch(() => null);
    return () => {
      unloadCaptureSound().catch(() => null);
    };
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
        <ActivityIndicator color="#fff" />
        <Text style={styles.body}>Waiting for camera device...</Text>
      </SafeAreaView>
    );
  }

  const handleSaveSelected = async (uris: string[]) => {
    const selectedSet = new Set(uris);
    const allUris = galleryItems.map((item) => item.uri);
    const thumbnailUris = Array.from(
      new Set(
        galleryItems
          .map((item) => item.thumbnailUri)
          .filter((uri): uri is string => typeof uri === "string" && uri.length > 0)
      )
    );

    for (const uri of selectedSet) {
      await saveToGallery(uri);
    }

    for (const uri of allUris) {
      await deleteMedia(uri);
    }

    for (const thumbnailUri of thumbnailUris) {
      await deleteMedia(thumbnailUri);
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
              <ActivityIndicator color="#fff" />
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
          <Switch value={soundEnabled} onValueChange={setSoundEnabled} disabled={isCaptureBusy} />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Flash</Text>
          <Switch value={flashEnabled} onValueChange={setFlashEnabled} disabled={isCaptureBusy} />
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
    backgroundColor: "#000"
  },
  centered: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  previewWrap: {
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
    borderBottomWidth: 1,
    borderColor: "#222"
  },
  previewSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8
  },
  previewLabel: {
    color: "#aaa",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  previewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)"
  },
  cameraFacingLabel: {
    color: "#bbb",
    fontSize: 12,
    marginTop: 8
  },
  controls: {
    padding: 16,
    gap: 12
  },
  title: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 20
  },
  body: {
    color: "#ddd",
    fontSize: 14
  },
  successText: {
    color: "#9fd89b",
    fontSize: 14
  },
  error: {
    color: "#ff6f6f",
    fontSize: 14
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  toggleLabel: {
    color: "#ddd",
    fontSize: 14,
    fontWeight: "600"
  },
  captureProgressCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    padding: 10,
    gap: 8
  },
  captureProgressTitle: {
    color: "#dcdcdc",
    fontSize: 13
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#232323",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#5a80ff"
  },
  stageChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  stageChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#151515"
  },
  stageChipActive: {
    borderColor: "#5a80ff",
    backgroundColor: "#1a2240"
  },
  stageChipComplete: {
    borderColor: "#366f40",
    backgroundColor: "#1a2d1d"
  },
  stageChipText: {
    color: "#ddd",
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
    color: "#fff",
    fontWeight: "600"
  },
  promptButton: {
    backgroundColor: "#444734"
  },
  captureButton: {
    backgroundColor: "#3265ff"
  },
  rerollButton: {
    backgroundColor: "#333",
    marginTop: 8
  },
  reviewButton: {
    backgroundColor: "#5b3fd6"
  },
  reviewButtonDisabled: {
    backgroundColor: "#2d2b4f",
    opacity: 0.8
  },
  promptCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#1a1a1a",
    borderColor: "#2a2a2a",
    borderWidth: 1
  },
  promptVibe: {
    color: "#7ec8ff",
    marginBottom: 4
  },
  promptText: {
    color: "#fff",
    fontSize: 15
  }
});
