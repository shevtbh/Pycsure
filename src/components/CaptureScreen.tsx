import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, useCameraDevice, useCameraFormat, Templates } from "react-native-vision-camera";
import * as FileSystem from "expo-file-system/legacy";
import {
  capturePhotoNormalized,
  captureSnapshot,
  photoFileToUri,
  requestCameraPermissions
} from "../services/camera/cameraService";
import { preloadCaptureSound, playCaptureSound, unloadCaptureSound } from "../services/audio/soundService";
import { getRandomPrompt, getPromptCount } from "../services/prompts/promptService";
import { processCapture } from "../services/pipeline/batchProcessor";
import { CaptureJobConfig, CaptureSourceCandidate, CaptureSourceMode, PromptItem } from "../types/pipeline";

const defaultJobConfig: CaptureJobConfig = {
  saveToGallery: true,
  includeVideo: false,
  captureVideoMs: 4000,
  outputJpegQuality: 0.9
};

const PRE_CAPTURE_SETTLE_MS = 450;
const BETWEEN_CAPTURE_MODES_MS = 200;
const MIN_CAPTURE_FILE_BYTES = 24 * 1024;

async function buildCaptureCandidate(input: {
  mode: CaptureSourceMode;
  uri: string;
  width?: number;
  height?: number;
}): Promise<CaptureSourceCandidate> {
  const info = await FileSystem.getInfoAsync(input.uri);
  const fileSizeBytes = info.exists && typeof info.size === "number" ? info.size : 0;
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const isDegenerate = fileSizeBytes < MIN_CAPTURE_FILE_BYTES || width <= 0 || height <= 0;
  return {
    mode: input.mode,
    uri: input.uri,
    width,
    height,
    fileSizeBytes,
    isDegenerate
  };
}

function pickCaptureCandidate(candidates: CaptureSourceCandidate[]) {
  const valid = candidates.filter((candidate) => !candidate.isDegenerate);
  if (valid.length === 1) {
    return { selected: valid[0], reason: `selected_${valid[0].mode}_only_valid` };
  }
  if (valid.length >= 2) {
    const snapshot = valid.find((candidate) => candidate.mode === "snapshot");
    const photo = valid.find((candidate) => candidate.mode === "photo_normalized");
    if (snapshot && photo) {
      if (photo.fileSizeBytes >= snapshot.fileSizeBytes * 0.85) {
        return { selected: photo, reason: "selected_photo_normalized_preferred" };
      }
      return { selected: snapshot, reason: "selected_snapshot_significantly_larger" };
    }
    const largest = valid.reduce((best, current) => (
      current.fileSizeBytes > best.fileSizeBytes ? current : best
    ));
    return { selected: largest, reason: "selected_largest_valid_candidate" };
  }
  const largestFallback = candidates.reduce((best, current) => (
    current.fileSizeBytes > best.fileSizeBytes ? current : best
  ));
  return { selected: largestFallback, reason: "selected_largest_degenerate_fallback" };
}

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
  const cameraRef = useRef<Camera>(null);

  const device = useCameraDevice("back");
  /** Snapshot uses the video/preview pipeline; favor a strong video format (esp. iOS). */
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

      setStatusText("Capturing A/B sources (snapshot + photo)...");
      setTorchOn(false);
      await new Promise<void>((resolve) => setTimeout(resolve, PRE_CAPTURE_SETTLE_MS));

      const candidates: CaptureSourceCandidate[] = [];

      try {
        const snapshot = await captureSnapshot(cameraRef, { quality: 100 });
        const snapshotUri = photoFileToUri(snapshot);
        candidates.push(await buildCaptureCandidate({
          mode: "snapshot",
          uri: snapshotUri,
          width: snapshot.width,
          height: snapshot.height
        }));
      } catch {
        // Keep going so the photo path can still rescue this session.
      }

      await new Promise<void>((resolve) => setTimeout(resolve, BETWEEN_CAPTURE_MODES_MS));

      try {
        const photo = await capturePhotoNormalized(cameraRef, { flash: "off" });
        candidates.push(await buildCaptureCandidate({
          mode: "photo_normalized",
          uri: photo.normalizedUri,
          width: photo.photo.width,
          height: photo.photo.height
        }));
      } catch {
        // Keep going with any successful candidate from snapshot path.
      }

      if (candidates.length === 0) {
        throw new Error("Both capture modes failed.");
      }

      const selection = pickCaptureCandidate(candidates);
      const baseImageUri = selection.selected.uri;

      setStatusText("Applying Standard + Vintage + B&W filters...");
      const result = await processCapture({
        baseImageUri,
        captureDiagnostics: {
          selectedMode: selection.selected.mode,
          selectionReason: selection.reason,
          candidates
        },
        config: defaultJobConfig,
        onVariantDone: setProgress
      });

      setStatusText("Done");
      const photoWord = result.outputs.length === 1 ? "photo" : "photos";
      const selectedMode = result.diagnostics?.capture.selectedMode ?? "unknown";
      const healthTag = result.diagnostics?.healthTag ?? "ok";
      setLastSessionText(
        `Session ${result.sessionId}: ${result.outputs.length} ${photoWord} (STD + VTG1 + VTG2 + BW) | source ${selectedMode} | health ${healthTag} | failed variants ${result.summary.failedVariants} | ${result.elapsedMs}ms`
      );
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
        <Text style={styles.body}>Outputs: 4 photos per capture — Standard (STD) + Vintage 1 (VTG1) + Vintage 2 (VTG2) + Black & White (BW), no flash</Text>
        <Text style={styles.body}>Prompt catalog: {promptCount} prompts</Text>
        <Text style={styles.body}>Status: {statusText}</Text>
        {busy ? <Text style={styles.body}>Progress: {Math.round(progress * 100)}%</Text> : null}
        {lastSessionText ? <Text style={styles.body}>{lastSessionText}</Text> : null}
        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

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
