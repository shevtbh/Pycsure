import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { capturePhoto, captureTimedVideo, requestCameraPermissions } from "../services/camera/cameraService";
import { preloadCaptureSound, playCaptureSound, unloadCaptureSound } from "../services/audio/soundService";
import { getRandomPrompt, getPromptCount } from "../services/prompts/promptService";
import { processCapture } from "../services/pipeline/batchProcessor";
import { CaptureJobConfig, PromptItem } from "../types/pipeline";

const defaultJobConfig: CaptureJobConfig = {
  saveToGallery: true,
  includeVideo: true,
  captureVideoMs: 4000,
  outputJpegQuality: 0.9
};

export function CaptureScreen() {
  const [cameraPosition, setCameraPosition] = useState<"front" | "back">("back");
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Ready");
  const [noPreview] = useState(true);
  const [prompt, setPrompt] = useState<PromptItem | null>(null);
  const [lastSessionText, setLastSessionText] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const cameraRef = useRef<Camera>(null);

  const device = useCameraDevice(cameraPosition);

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

  const onCapturePress = useCallback(async () => {
    if (!cameraRef.current || !device || busy) {
      return;
    }

    setBusy(true);
    setProgress(0);
    setErrorText(null);
    setStatusText("Playing shutter sound...");

    try {
      await playCaptureSound();

      setStatusText("Capturing photo...");
      const photo = await capturePhoto(cameraRef);
      setStatusText("Recording 4-second video...");

      const video = defaultJobConfig.includeVideo
        ? await captureTimedVideo(cameraRef, defaultJobConfig.captureVideoMs)
        : undefined;

      setStatusText("Processing 12 photos with filter + flash variants...");
      const result = await processCapture({
        baseImageUri: `file://${photo.path}`,
        videoUri: video ? `file://${video.path}` : undefined,
        config: defaultJobConfig,
        onVariantDone: setProgress
      });

      setStatusText("Done");
      setLastSessionText(
        `Session ${result.sessionId}: ${result.outputs.length} photos${result.videoUri ? " + 1 video" : ""} | failed variants ${result.summary.failedVariants} | ${result.elapsedMs}ms`
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Capture failed.");
      setStatusText("Failed");
    } finally {
      setBusy(false);
    }
  }, [busy, device]);

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
      <View style={styles.previewWrap}>
        {!noPreview ? (
          <Camera ref={cameraRef} style={StyleSheet.absoluteFill} device={device} isActive photo video />
        ) : (
          <View style={styles.noPreview}>
            <Text style={styles.noPreviewText}>No Preview Mode Enabled</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Text style={styles.title}>Pycsure CampSnap Pro</Text>
        <Text style={styles.body}>Outputs: 13 total (12 photos + 1 video)</Text>
        <Text style={styles.body}>Prompt catalog: {promptCount} prompts</Text>
        <Text style={styles.body}>Status: {statusText}</Text>
        {busy ? <Text style={styles.body}>Progress: {Math.round(progress * 100)}%</Text> : null}
        {lastSessionText ? <Text style={styles.body}>{lastSessionText}</Text> : null}
        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

        <Text style={styles.body}>No Preview: enabled (CampSnap mode)</Text>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.secondaryButton]}
            onPress={() => setCameraPosition((prev) => (prev === "back" ? "front" : "back"))}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Flip Camera</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.promptButton]} onPress={loadPrompt} disabled={busy}>
            <Text style={styles.buttonText}>Give Prompt</Text>
          </Pressable>
        </View>

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
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#222"
  },
  noPreview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f0f0f"
  },
  noPreviewText: {
    color: "#bbb"
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
  row: {
    flexDirection: "row",
    gap: 10
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
  secondaryButton: {
    backgroundColor: "#283447",
    flex: 1
  },
  promptButton: {
    backgroundColor: "#444734",
    flex: 1
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
