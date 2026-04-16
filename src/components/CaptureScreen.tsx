import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat, Templates } from "react-native-vision-camera";
import { requestCameraPermissions, captureTimedVideo } from "../services/camera/cameraService";
import { preloadCaptureSound, playCaptureSound, unloadCaptureSound } from "../services/audio/soundService";
import { getRandomPrompt, getPromptCount } from "../services/prompts/promptService";
import { processCapture } from "../services/pipeline/batchProcessor";
import { captureHardwareFlashBracket } from "../services/camera/flashBracketCapture";
import { CaptureJobConfig, PromptItem } from "../types/pipeline";
import { MediaItem, ResultReviewView } from "./ResultReviewView";
import { deleteMedia, normalizeLocalMediaUri, saveToGallery } from "../services/storage/mediaStorage";

const defaultJobConfig: CaptureJobConfig = {
  saveToGallery: false,
  includeVideo: true,
  captureVideoMs: 4000,
  outputJpegQuality: 0.9
};

export function CaptureScreen() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Ready");
  const [prompt, setPrompt] = useState<PromptItem | null>(null);
  const [lastSessionText, setLastSessionText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [galleryItems, setGalleryItems] = useState<MediaItem[]>([]);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const cameraRef = useRef<Camera>(null);

  const device = useCameraDevice("back");
  /** Keep video-capable format for stable preview/capture behavior across devices. */
  const format = useCameraFormat(device, Templates.Video);

  const promptCount = useMemo(() => getPromptCount(), []);

  const loadPrompt = useCallback(async () => {
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
    setStatusText("Playing shutter sound...");

    try {
      await playCaptureSound();

      setStatusText("Capturing base + flash source images...");
      const bracket = await captureHardwareFlashBracket({
        cameraRef,
        device,
        setTorchOn
      });

      let videoUri: string | undefined;
      let flashVideoUri: string | undefined;

      if (defaultJobConfig.includeVideo) {
        setStatusText("Recording 4-second video...");
        try {
          const video = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "off");
          videoUri = normalizeLocalMediaUri(video.path);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Failed to capture video", e);
        }

        setStatusText("Recording 4-second video with flash...");
        try {
          const flashVideo = await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs, "on");
          flashVideoUri = normalizeLocalMediaUri(flashVideo.path);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Failed to capture flash video", e);
        }
      }

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
        `Session ${result.sessionId}: ${result.outputs.length} ${photoWord} (STD + VTG1 + VTG2 + BW, each no-flash + flash) | failed variants ${result.summary.failedVariants} | ${result.elapsedMs}ms`
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

      const nextItems: MediaItem[] = [
        ...result.outputs.map((output) => ({
          uri: output.localUri,
          type: "image" as const,
          label: `${output.variant.filterId} ${output.variant.flashMode}`
        })),
        ...(result.videoUri ? [{ uri: result.videoUri, type: "video" as const, label: "Video" }] : []),
        ...(result.flashVideoUri ? [{ uri: result.flashVideoUri, type: "video" as const, label: "Flash Video" }] : [])
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
      setBusy(false);
    }
  }, [busy, cameraReady, device]);

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

    for (const uri of selectedSet) {
      await saveToGallery(uri);
    }

    for (const uri of allUris) {
      await deleteMedia(uri);
    }

    setGalleryItems([]);
  };

  const handleDiscardAll = async () => {
    for (const item of galleryItems) {
      await deleteMedia(item.uri);
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
        <Text style={styles.title}>Pycsure CampSnap Pro</Text>
        <Text style={styles.body}>Outputs: 8 photos per capture — Standard/Vintage1/Vintage2/B&W each with no-flash + flash</Text>
        <Text style={styles.body}>Prompt catalog: {promptCount} prompts</Text>
        <Text style={styles.body}>Status: {statusText}</Text>
        {busy ? <Text style={styles.body}>Progress: {Math.round(progress * 100)}%</Text> : null}
        {lastSessionText ? <Text style={styles.body}>{lastSessionText}</Text> : null}
        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
        <Text style={styles.body}>Gallery items pending review: {galleryItems.length}</Text>

        <Text style={styles.body}>Preview: live mini-viewfinder enabled</Text>

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
    gap: 10
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
  error: {
    color: "#ff6f6f",
    fontSize: 14
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
