import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  normalizeLocalMediaUri
} from "../services/storage/mediaStorage";

type VideoPlaybackState = "loading" | "ready" | "error";

type ExpoVideoModuleShape = {
  VideoView: React.ComponentType<{
    player: {
      addListener: (
        eventName: "statusChange",
        listener: (payload: {
          status: "idle" | "loading" | "readyToPlay" | "error";
          error?: unknown;
        }) => void
      ) => { remove: () => void };
      play: () => void;
      pause: () => void;
      replaceAsync: (source: string) => Promise<void>;
      loop: boolean;
    };
    style?: unknown;
    nativeControls?: boolean;
    contentFit?: "contain" | "cover" | "fill";
    allowsFullscreen?: boolean;
    onFirstFrameRender?: () => void;
  }>;
  useVideoPlayer: (
    source: string | null,
    setup?: (player: {
      addListener: (
        eventName: "statusChange",
        listener: (payload: {
          status: "idle" | "loading" | "readyToPlay" | "error";
          error?: unknown;
        }) => void
      ) => { remove: () => void };
      play: () => void;
      pause: () => void;
      replaceAsync: (source: string) => Promise<void>;
      loop: boolean;
    }) => void
  ) => {
    addListener: (
      eventName: "statusChange",
      listener: (payload: {
        status: "idle" | "loading" | "readyToPlay" | "error";
        error?: unknown;
      }) => void
    ) => { remove: () => void };
    play: () => void;
    pause: () => void;
    replaceAsync: (source: string) => Promise<void>;
    loop: boolean;
  };
};

function loadExpoVideoModule(): ExpoVideoModuleShape | null {
  try {
    return require("expo-video") as ExpoVideoModuleShape;
  } catch {
    return null;
  }
}

const expoVideoModule = loadExpoVideoModule();
const VideoViewComponent = expoVideoModule?.VideoView ?? null;
const useExpoVideoPlayer = expoVideoModule?.useVideoPlayer ?? null;
const hasExpoVideoNativeModule = Boolean(VideoViewComponent && useExpoVideoPlayer);

interface ResultReviewViewProps {
  mediaItems: MediaItem[];
  onClose: () => void;
  onSaveSelected: (uris: string[]) => Promise<void>;
  onDiscardAll: () => Promise<void>;
}

type MediaItemType = "image" | "video";

export interface MediaItem {
  uri: string;
  type: MediaItemType;
  label: string;
  thumbnailUri?: string;
}

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown player error.";
    }
  }

  return String(error);
}

interface VideoThumbnailProps {
  label: string;
  thumbnailUri?: string;
}

interface ExpoVideoPreviewProps {
  uri: string;
  onStateChange: (state: VideoPlaybackState) => void;
  onError: (message: string) => void;
}

function ExpoVideoPreview({ uri, onStateChange, onError }: ExpoVideoPreviewProps) {
  if (!VideoViewComponent || !useExpoVideoPlayer) {
    return null;
  }

  const player = useExpoVideoPlayer(null, (createdPlayer) => {
    createdPlayer.loop = true;
  });

  useEffect(() => {
    onStateChange("loading");

    let isCancelled = false;

    const loadAndPlay = async () => {
      try {
        await player.replaceAsync(uri);
        if (isCancelled) {
          return;
        }
        player.play();
      } catch (error) {
        if (isCancelled) {
          return;
        }
        onStateChange("error");
        onError(`Unable to play this video in-app. ${toErrorText(error)}`);
      }
    };

    loadAndPlay().catch(() => null);

    return () => {
      isCancelled = true;
      try {
        player.pause();
      } catch {
        // The underlying native player can already be disposed during unmount.
      }
    };
  }, [onError, onStateChange, player, uri]);

  useEffect(() => {
    const subscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") {
        onStateChange("error");
        onError(`Unable to play this video in-app. ${toErrorText(error)}`);
        return;
      }

      if (status === "loading") {
        onStateChange("loading");
        return;
      }

      if (status === "readyToPlay") {
        onStateChange("ready");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [onError, onStateChange, player]);

  return (
    <VideoViewComponent
      player={player}
      style={styles.nativeVideoPlayer}
      nativeControls
      contentFit="contain"
      onFirstFrameRender={() => onStateChange("ready")}
    />
  );
}

function VideoThumbnail({ label, thumbnailUri }: VideoThumbnailProps) {
  return (
    <View style={styles.videoFallbackThumb}>
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} />
      ) : (
        <View style={styles.videoFallbackEmpty}>
          <Text style={styles.videoFallbackText}>{label}</Text>
          <Text style={styles.videoFallbackHint}>Tap to preview video</Text>
        </View>
      )}
      <View style={styles.videoBadge}>
        <Text style={styles.videoBadgeIcon}>▶</Text>
      </View>
    </View>
  );
}

export function ResultReviewView({ mediaItems, onClose, onSaveSelected, onDiscardAll }: ResultReviewViewProps) {
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [videoPlayerState, setVideoPlayerState] = useState<VideoPlaybackState>("loading");
  const [videoErrorText, setVideoErrorText] = useState<string | null>(null);
  // `appOwnership` can be unreliable in custom/prod builds; prefer executionEnvironment.
  const isExpoGo =
    Constants.executionEnvironment != null
      ? Constants.executionEnvironment === "storeClient"
      : Constants.appOwnership === "expo";

  const resetVideoState = useCallback(() => {
    setVideoPlayerState("loading");
    setVideoErrorText(null);
  }, []);

  const previewVideoUri = useMemo(() => {
    if (previewItem?.type !== "video") {
      return null;
    }
    return normalizeLocalMediaUri(previewItem.uri);
  }, [previewItem]);

  const openPreview = useCallback(
    (item: MediaItem) => {
      resetVideoState();
      setPreviewItem(item);
    },
    [resetVideoState]
  );

  const closePreview = useCallback(() => {
    setPreviewItem(null);
    resetVideoState();
  }, [resetVideoState]);

  const toggleSelection = (uri: string) => {
    setSelectedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  const handleSaveSelected = async () => {
    if (selectedUris.size === 0) return;
    setIsProcessing(true);
    try {
      await onSaveSelected(Array.from(selectedUris));
      setSelectedUris(new Set());
      onClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to save selected media:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDiscardAll = async () => {
    setIsProcessing(true);
    try {
      await onDiscardAll();
      setSelectedUris(new Set());
      onClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to discard media:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Gallery Review</Text>
        <Text style={styles.subtitle}>Keep shooting, then review and save what you want</Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {mediaItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No captures yet</Text>
            <Text style={styles.emptyBody}>Return to camera and tap Capture to build your gallery.</Text>
          </View>
        ) : null}
        {mediaItems.map((item) => {
          const isSelected = selectedUris.has(item.uri);
          return (
            <View key={item.uri} style={[styles.itemContainer, isSelected && styles.itemSelected]}>
              <Pressable style={styles.mediaTapArea} onPress={() => openPreview(item)}>
                {item.type === "image" ? (
                  <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                ) : (
                  <VideoThumbnail label={item.label} thumbnailUri={item.thumbnailUri} />
                )}
              </Pressable>
              <View style={styles.labelContainer}>
                <Text style={styles.labelText}>{item.label}</Text>
              </View>
              <Pressable style={styles.selectButton} onPress={() => toggleSelection(item.uri)}>
                <Text style={styles.selectButtonText}>{isSelected ? "Deselect" : "Select"}</Text>
              </Pressable>
              {isSelected && (
                <View style={styles.checkmarkContainer}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Video / Image preview modal */}
      <Modal visible={Boolean(previewItem)} transparent animationType="fade" onRequestClose={closePreview}>
        <View style={styles.previewOverlay}>
          <View style={styles.previewHeader}>
            <Pressable style={styles.previewActionButton} onPress={closePreview}>
              <Text style={styles.previewActionText}>Close</Text>
            </Pressable>
            {previewItem ? (
              <Pressable style={styles.previewActionButton} onPress={() => toggleSelection(previewItem.uri)}>
                <Text style={styles.previewActionText}>
                  {selectedUris.has(previewItem.uri) ? "Deselect" : "Select"}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.previewBody}>
            {previewItem?.type === "image" ? (
              <ScrollView
                style={styles.previewImageScroll}
                contentContainerStyle={styles.previewImageContainer}
                minimumZoomScale={1}
                maximumZoomScale={4}
                centerContent
              >
                <Image source={{ uri: previewItem.uri }} style={styles.previewImage} resizeMode="contain" />
              </ScrollView>
            ) : null}

            {previewItem?.type === "video" ? (
              <View style={styles.previewVideoContainer}>
                {isExpoGo ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.previewVideoError}>Video preview is unavailable in Expo Go.</Text>
                    <Text style={styles.previewVideoErrorHint}>
                      Use a development build to preview videos in-app, or select this clip and save it to your gallery.
                    </Text>
                    <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(previewItem.uri)}>
                      <Text style={styles.saveFromPreviewButtonText}>
                        {selectedUris.has(previewItem.uri) ? "✓ Selected for Save" : "Select to Save"}
                      </Text>
                    </Pressable>
                  </View>
                ) : !hasExpoVideoNativeModule ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.previewVideoError}>Video preview module is missing in this app build.</Text>
                    <Text style={styles.previewVideoErrorHint}>
                      Rebuild and reinstall your development client after adding expo-video, then reopen this preview.
                    </Text>
                    <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(previewItem.uri)}>
                      <Text style={styles.saveFromPreviewButtonText}>
                        {selectedUris.has(previewItem.uri) ? "✓ Selected for Save" : "Select to Save"}
                      </Text>
                    </Pressable>
                  </View>
                ) : videoPlayerState !== "error" ? (
                  <View style={styles.previewVideoSurface}>
                    {previewVideoUri ? (
                      <ExpoVideoPreview
                        uri={previewVideoUri}
                        onStateChange={setVideoPlayerState}
                        onError={setVideoErrorText}
                      />
                    ) : null}
                    {videoPlayerState === "loading" ? (
                      <View style={styles.previewVideoLoading}>
                        <ActivityIndicator color="#fff" />
                        <Text style={styles.previewVideoLoadingText}>Loading video...</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.errorContainer}>
                    <Text style={styles.previewVideoError}>{videoErrorText ?? "Unable to play this video in-app."}</Text>
                    <Text style={styles.previewVideoErrorHint}>
                      You can still select this clip and save it to your gallery.
                    </Text>
                    <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(previewItem.uri)}>
                      <Text style={styles.saveFromPreviewButtonText}>
                        {selectedUris.has(previewItem.uri) ? "✓ Selected for Save" : "Select to Save"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                <Text style={styles.previewVideoTitle}>{previewItem.label}</Text>
                <Text style={styles.previewVideoBody}>
                  Preview this clip here before saving. Use the player controls or fullscreen button as needed.
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.previewHelpText}>
            Tap media in the grid to open fullscreen. Pinch to zoom images or use the video controls.
          </Text>
        </View>
      </Modal>

      <View style={styles.footer}>
        <Pressable
          style={[styles.button, styles.discardButton]}
          onPress={handleDiscardAll}
          disabled={isProcessing || mediaItems.length === 0}
        >
          <Text style={styles.buttonText}>Discard All</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.saveButton, selectedUris.size === 0 && styles.saveButtonDisabled]}
          onPress={handleSaveSelected}
          disabled={isProcessing || selectedUris.size === 0 || mediaItems.length === 0}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save Selected ({selectedUris.size})</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.closeBar}>
        <Pressable style={styles.closeBarButton} onPress={onClose} disabled={isProcessing}>
          <Text style={styles.closeBarButtonText}>Back to Camera</Text>
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
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#222"
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold"
  },
  subtitle: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 4
  },
  emptyState: {
    width: "100%",
    paddingVertical: 40,
    alignItems: "center"
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700"
  },
  emptyBody: {
    color: "#999",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
    paddingHorizontal: 20
  },
  grid: {
    padding: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between"
  },
  itemContainer: {
    width: "48%",
    aspectRatio: 3 / 4,
    marginBottom: 16,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#111"
  },
  mediaTapArea: {
    width: "100%",
    height: "100%"
  },
  itemSelected: {
    borderColor: "#3265ff"
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    resizeMode: "cover"
  },
  labelContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 6
  },
  labelText: {
    color: "#fff",
    fontSize: 12,
    textAlign: "center"
  },
  checkmarkContainer: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#3265ff",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  selectButton: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  selectButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600"
  },
  checkmarkText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    flexDirection: "row",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#222"
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16
  },
  discardButton: {
    backgroundColor: "#444"
  },
  saveButton: {
    backgroundColor: "#3265ff"
  },
  saveButtonDisabled: {
    backgroundColor: "#223366",
    opacity: 0.7
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)"
  },
  previewHeader: {
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  previewActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#1f1f1f"
  },
  previewActionText: {
    color: "#fff",
    fontWeight: "700"
  },
  previewBody: {
    flex: 1
  },
  previewImageScroll: {
    flex: 1
  },
  previewImageContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  previewImage: {
    width: "100%",
    height: "100%"
  },
  previewVideoContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 24,
    justifyContent: "center",
    gap: 12
  },
  previewVideoSurface: {
    width: "100%",
    aspectRatio: 3 / 4,
    maxHeight: "68%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111"
  },
  nativeVideoPlayer: {
    flex: 1,
    backgroundColor: "#000"
  },
  previewVideoLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.32)",
    gap: 8
  },
  previewVideoLoadingText: {
    color: "#ddd",
    fontSize: 13
  },
  previewVideoTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center"
  },
  previewVideoBody: {
    color: "#bbb",
    textAlign: "center",
    fontSize: 14
  },
  errorContainer: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: "#161616",
    alignItems: "center",
    gap: 10
  },
  previewVideoError: {
    color: "#ff8f8f",
    fontSize: 14,
    textAlign: "center",
    fontWeight: "600"
  },
  previewVideoErrorHint: {
    color: "#aaa",
    fontSize: 12,
    textAlign: "center"
  },
  saveFromPreviewButton: {
    backgroundColor: "#3265ff",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  saveFromPreviewButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600"
  },
  videoFallbackThumb: {
    width: "100%",
    height: "100%",
    backgroundColor: "#151515",
    justifyContent: "center"
  },
  videoFallbackEmpty: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 12
  },
  videoBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center"
  },
  videoBadgeIcon: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700"
  },
  videoFallbackText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  videoFallbackHint: {
    color: "#999",
    fontSize: 12,
    marginTop: 6,
    textAlign: "center"
  },
  previewHelpText: {
    color: "#bbb",
    textAlign: "center",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 16
  },
  closeBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16
  },
  closeBarButton: {
    backgroundColor: "#2b2b2b",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  closeBarButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14
  }
});
