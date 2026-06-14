import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from "react-native";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  normalizeLocalMediaUri
} from "../services/storage/mediaStorage";
import { colors } from "../constants/theme";
import {
  extractVideoFrameAtTime,
  extractVideoThumbnailAtTime,
  formatVideoTimestamp,
  isVideoFrameExtractAvailable
} from "../services/media/videoFrameExtract";

const FILMSTRIP_FRAME_COUNT = 8;

type VideoPlaybackState = "loading" | "ready" | "error";

type VideoPlayer = {
  addListener: (
    eventName: "statusChange" | "timeUpdate",
    listener: (payload: {
      status?: "idle" | "loading" | "readyToPlay" | "error";
      error?: unknown;
      currentTime?: number;
      bufferedPosition?: number;
    }) => void
  ) => { remove: () => void };
  play: () => void;
  pause: () => void;
  replaceAsync: (source: string) => Promise<void>;
  loop: boolean;
  currentTime: number;
  duration: number;
  timeUpdateEventInterval: number;
  scrubbingModeEnabled?: boolean;
};

type ExpoVideoModuleShape = {
  VideoView: React.ComponentType<{
    player: VideoPlayer;
    style?: unknown;
    nativeControls?: boolean;
    contentFit?: "contain" | "cover" | "fill";
    allowsFullscreen?: boolean;
    onFirstFrameRender?: () => void;
  }>;
  useVideoPlayer: (source: string | null, setup?: (player: VideoPlayer) => void) => VideoPlayer;
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
  onFrameExtracted?: (item: MediaItem) => void;
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

interface ExpoVideoScrubberPreviewProps {
  uri: string;
  videoLabel: string;
  onStateChange: (state: VideoPlaybackState) => void;
  onError: (message: string) => void;
  onFrameExtracted?: (item: MediaItem) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

function seekFromTrackPosition(
  trackWidth: number,
  locationX: number,
  duration: number
): number {
  if (trackWidth <= 0 || duration <= 0) {
    return 0;
  }
  const ratio = Math.min(Math.max(locationX / trackWidth, 0), 1);
  return ratio * duration;
}

function confirmSaveSelection(selectedCount: number, totalCount: number): Promise<boolean> {
  const deleteCount = Math.max(totalCount - selectedCount, 0);
  const selectedNoun = selectedCount === 1 ? "item" : "items";
  const deleteNoun = deleteCount === 1 ? "item" : "items";

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    Alert.alert(
      "Confirm Save",
      `${selectedCount} ${selectedNoun} will be saved. ${deleteCount} ${deleteNoun} will be removed from this review only.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => settle(false)
        },
        {
          text: "Save Selected",
          style: "destructive",
          onPress: () => settle(true)
        }
      ],
      {
        cancelable: true,
        onDismiss: () => settle(false)
      }
    );
  });
}

function ExpoVideoScrubberPreview({
  uri,
  videoLabel,
  onStateChange,
  onError,
  onFrameExtracted,
  onScrubbingChange
}: ExpoVideoScrubberPreviewProps) {
  const NativeVideoView = VideoViewComponent as NonNullable<typeof VideoViewComponent>;
  const { height: windowHeight } = useWindowDimensions();
  const playerHeight = Math.round(Math.min(Math.max(windowHeight * 0.46, 320), 540));
  const player = (useExpoVideoPlayer as NonNullable<typeof useExpoVideoPlayer>)(null, (createdPlayer) => {
    createdPlayer.loop = false;
    createdPlayer.timeUpdateEventInterval = 0.25;
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSavingFrame, setIsSavingFrame] = useState(false);
  const [scrubTrackWidth, setScrubTrackWidth] = useState(0);
  const [filmstripFrames, setFilmstripFrames] = useState<(string | null)[]>([]);
  const scrubTrackWidthRef = useRef(0);
  const durationRef = useRef(0);
  const isScrubbingRef = useRef(false);

  useEffect(() => {
    onScrubbingChange?.(isScrubbing);
  }, [isScrubbing, onScrubbingChange]);

  useEffect(() => {
    scrubTrackWidthRef.current = scrubTrackWidth;
  }, [scrubTrackWidth]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  // Build a filmstrip of evenly-spaced thumbnails once we know the duration so the
  // user can see the whole video while scrubbing.
  useEffect(() => {
    setFilmstripFrames([]);

    if (duration <= 0 || !isVideoFrameExtractAvailable()) {
      return;
    }

    let isCancelled = false;
    const lastFrameIndex = Math.max(FILMSTRIP_FRAME_COUNT - 1, 1);
    const targets = Array.from({ length: FILMSTRIP_FRAME_COUNT }, (_, index) => {
      const ratio = index / lastFrameIndex;
      return Math.min(ratio * duration, Math.max(duration - 0.05, 0));
    });

    setFilmstripFrames(new Array(FILMSTRIP_FRAME_COUNT).fill(null));

    (async () => {
      for (let index = 0; index < targets.length; index += 1) {
        if (isCancelled) {
          return;
        }
        const frameUri = await extractVideoThumbnailAtTime(uri, targets[index]);
        if (isCancelled) {
          return;
        }
        setFilmstripFrames((prev) => {
          const next = [...prev];
          next[index] = frameUri;
          return next;
        });
      }
    })().catch(() => null);

    return () => {
      isCancelled = true;
    };
  }, [duration, uri]);

  const applySeek = useCallback(
    (seconds: number, resumeAfter = false) => {
      const clampedDuration = durationRef.current;
      const nextTime =
        clampedDuration > 0
          ? Math.min(Math.max(seconds, 0), clampedDuration)
          : Math.max(seconds, 0);
      player.currentTime = nextTime;
      setCurrentTime(nextTime);
      if (resumeAfter) {
        player.play();
        setIsPlaying(true);
      }
    },
    [player]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (event) => {
          setIsScrubbing(true);
          isScrubbingRef.current = true;
          try {
            player.pause();
            setIsPlaying(false);
          } catch {
            // Player may already be disposed.
          }
          if ("scrubbingModeEnabled" in player) {
            player.scrubbingModeEnabled = true;
          }
          const nextTime = seekFromTrackPosition(
            scrubTrackWidthRef.current,
            event.nativeEvent.locationX,
            durationRef.current
          );
          applySeek(nextTime);
        },
        onPanResponderMove: (event) => {
          const nextTime = seekFromTrackPosition(
            scrubTrackWidthRef.current,
            event.nativeEvent.locationX,
            durationRef.current
          );
          applySeek(nextTime);
        },
        onPanResponderRelease: () => {
          setIsScrubbing(false);
          isScrubbingRef.current = false;
          if ("scrubbingModeEnabled" in player) {
            player.scrubbingModeEnabled = false;
          }
          // Stay paused on the frame the user landed on so they can review and
          // save it. Playback only resumes when they explicitly tap Play.
          try {
            player.pause();
          } catch {
            // Player may already be disposed.
          }
          setIsPlaying(false);
        },
        onPanResponderTerminate: () => {
          setIsScrubbing(false);
          isScrubbingRef.current = false;
          if ("scrubbingModeEnabled" in player) {
            player.scrubbingModeEnabled = false;
          }
        }
      }),
    [applySeek, player]
  );

  useEffect(() => {
    onStateChange("loading");
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);

    let isCancelled = false;

    const loadAndPlay = async () => {
      try {
        await player.replaceAsync(uri);
        if (isCancelled) {
          return;
        }
        if (player.duration > 0) {
          setDuration(player.duration);
          durationRef.current = player.duration;
        }
        player.play();
        setIsPlaying(true);
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
    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
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
        if (player.duration > 0) {
          setDuration(player.duration);
          durationRef.current = player.duration;
        }
      }
    });

    const timeSubscription = player.addListener("timeUpdate", (payload) => {
      if (isScrubbingRef.current) {
        return;
      }
      if (typeof payload.currentTime === "number") {
        setCurrentTime(payload.currentTime);
      }
      if (player.duration > 0 && durationRef.current !== player.duration) {
        setDuration(player.duration);
        durationRef.current = player.duration;
      }
    });

    return () => {
      statusSubscription.remove();
      timeSubscription.remove();
    };
  }, [onError, onStateChange, player]);

  const handleScrubTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setScrubTrackWidth(width);
    scrubTrackWidthRef.current = width;
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      return;
    }
    player.play();
    setIsPlaying(true);
  }, [isPlaying, player]);

  const handleSaveStill = useCallback(async () => {
    if (!onFrameExtracted) {
      return;
    }

    if (!isVideoFrameExtractAvailable()) {
      Alert.alert(
        "Frame Export Unavailable",
        "Rebuild and reinstall your development client to export stills from video."
      );
      return;
    }

    setIsSavingFrame(true);
    try {
      const frameUri = await extractVideoFrameAtTime(uri, currentTime);
      const timestampLabel = formatVideoTimestamp(currentTime);
      onFrameExtracted({
        uri: frameUri,
        type: "image",
        label: `Frame @ ${timestampLabel} (${videoLabel})`
      });
      Alert.alert("Still Saved", "The frame was added to your gallery review.");
    } catch (error) {
      Alert.alert(
        "Save Still Failed",
        error instanceof Error ? error.message : "Could not extract a still from this video."
      );
    } finally {
      setIsSavingFrame(false);
    }
  }, [currentTime, onFrameExtracted, uri, videoLabel]);

  const scrubProgress = duration > 0 ? currentTime / duration : 0;

  return (
    <View style={styles.previewVideoScrubberColumn}>
      <View style={[styles.previewVideoPlayerWrap, { height: playerHeight }]}>
        <NativeVideoView
          player={player}
          style={styles.nativeVideoPlayer}
          nativeControls={false}
          contentFit="contain"
          onFirstFrameRender={() => onStateChange("ready")}
        />
      </View>
      <View style={styles.scrubberControls}>
        <View style={styles.scrubberTransportRow}>
          <Pressable style={styles.scrubberPlayButton} onPress={togglePlayback}>
            <Text style={styles.scrubberPlayButtonText}>{isPlaying && !isScrubbing ? "Pause" : "Play"}</Text>
          </Pressable>
          <Text style={styles.scrubberTimeText}>
            {formatVideoTimestamp(currentTime)} / {formatVideoTimestamp(duration)}
          </Text>
        </View>
        <View
          style={styles.scrubberTrack}
          onLayout={handleScrubTrackLayout}
          {...panResponder.panHandlers}
        >
          <View style={styles.filmstripRow} pointerEvents="none">
            {(filmstripFrames.length > 0
              ? filmstripFrames
              : new Array(FILMSTRIP_FRAME_COUNT).fill(null)
            ).map((frameUri, index) =>
              frameUri ? (
                <Image
                  key={`frame-${index}-${frameUri}`}
                  source={{ uri: frameUri }}
                  style={styles.filmstripFrame}
                />
              ) : (
                <View key={`frame-placeholder-${index}`} style={styles.filmstripFramePlaceholder} />
              )
            )}
          </View>
          <View
            style={[styles.filmstripDim, { left: `${scrubProgress * 100}%` }]}
            pointerEvents="none"
          />
          <View
            style={[styles.scrubberPlayhead, { left: `${scrubProgress * 100}%` }]}
            pointerEvents="none"
          >
            <View style={styles.scrubberPlayheadLine} />
            <View style={styles.scrubberThumb} />
          </View>
        </View>
        <Pressable
          style={[styles.saveStillButton, isSavingFrame && styles.saveStillButtonDisabled]}
          onPress={handleSaveStill}
          disabled={isSavingFrame || !onFrameExtracted}
        >
          {isSavingFrame ? (
            <ActivityIndicator color={colors.textOnAccent} size="small" />
          ) : (
            <Text style={styles.saveStillButtonText}>Save Still</Text>
          )}
        </Pressable>
        <Text style={styles.scrubberHint}>
          Drag the timeline to scrub. Stills use full video resolution (not the same as a fresh photo capture).
        </Text>
      </View>
    </View>
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

export function ResultReviewView({
  mediaItems,
  onClose,
  onSaveSelected,
  onDiscardAll,
  onFrameExtracted
}: ResultReviewViewProps) {
  const [selectedUris, setSelectedUris] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeZoomScale, setActiveZoomScale] = useState(1);
  const [videoPlayerState, setVideoPlayerState] = useState<VideoPlaybackState>("loading");
  const [videoErrorText, setVideoErrorText] = useState<string | null>(null);
  const [isScrubbingActive, setIsScrubbingActive] = useState(false);
  const previewPagerRef = useRef<ScrollView>(null);
  const previewIndexRef = useRef<number | null>(null);
  const { width: viewportWidth } = useWindowDimensions();
  // `appOwnership` can be unreliable in custom/prod builds; prefer executionEnvironment.
  const isExpoGo =
    Constants.executionEnvironment != null
      ? Constants.executionEnvironment === "storeClient"
      : Constants.appOwnership === "expo";

  const resetVideoState = useCallback(() => {
    setVideoPlayerState("loading");
    setVideoErrorText(null);
    setIsScrubbingActive(false);
  }, []);

  const previewItem = useMemo(() => {
    if (previewIndex == null || previewIndex < 0 || previewIndex >= mediaItems.length) {
      return null;
    }
    return mediaItems[previewIndex];
  }, [mediaItems, previewIndex]);

  const openPreview = useCallback(
    (index: number) => {
      resetVideoState();
      setActiveZoomScale(1);
      setPreviewIndex(index);
    },
    [resetVideoState]
  );

  const closePreview = useCallback(() => {
    previewIndexRef.current = null;
    setPreviewIndex(null);
    setActiveZoomScale(1);
    resetVideoState();
  }, [resetVideoState]);

  useEffect(() => {
    previewIndexRef.current = previewIndex;
  }, [previewIndex]);

  useEffect(() => {
    if (previewIndex == null) {
      return;
    }

    previewPagerRef.current?.scrollTo({
      x: previewIndex * viewportWidth,
      animated: false
    });
  }, [previewIndex, viewportWidth]);

  const handlePagerMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Prevent stale momentum events from re-opening the preview after user closes it.
      if (previewIndexRef.current == null) {
        return;
      }

      if (viewportWidth <= 0) {
        return;
      }

      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / viewportWidth);
      const clampedIndex = Math.max(0, Math.min(nextIndex, mediaItems.length - 1));
      if (clampedIndex !== previewIndex) {
        setPreviewIndex(clampedIndex);
        setActiveZoomScale(1);
        resetVideoState();
      }
    },
    [mediaItems.length, previewIndex, resetVideoState, viewportWidth]
  );

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
    const didConfirm = await confirmSaveSelection(selectedUris.size, mediaItems.length);
    if (!didConfirm) {
      return;
    }

    setIsProcessing(true);
    try {
      await onSaveSelected(Array.from(selectedUris));
      setSelectedUris(new Set());
      onClose();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to save selected media:", error);
      Alert.alert(
        "Save Failed",
        error instanceof Error ? error.message : "Could not save your selected captures."
      );
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
        {mediaItems.map((item, index) => {
          const isSelected = selectedUris.has(item.uri);
          return (
            <View key={item.uri} style={[styles.itemContainer, isSelected && styles.itemSelected]}>
              <Pressable style={styles.mediaTapArea} onPress={() => openPreview(index)}>
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
      <Modal visible={previewIndex !== null} transparent animationType="fade" onRequestClose={closePreview}>
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
            <ScrollView
              ref={previewPagerRef}
              horizontal
              pagingEnabled
              style={styles.previewPager}
              contentContainerStyle={styles.previewPagerContent}
              onMomentumScrollEnd={handlePagerMomentumEnd}
              showsHorizontalScrollIndicator={false}
              scrollEnabled={activeZoomScale <= 1.01 && !isScrubbingActive}
            >
              {mediaItems.map((item, index) => {
                const isActiveItem = index === previewIndex;
                return (
                  <View key={item.uri} style={[styles.previewPage, { width: viewportWidth }]}>
                    {item.type === "image" ? (
                      <ScrollView
                        style={styles.previewImageScroll}
                        contentContainerStyle={styles.previewImageContainer}
                        minimumZoomScale={1}
                        maximumZoomScale={4}
                        centerContent
                        scrollEventThrottle={16}
                        onScroll={(event) => {
                          if (!isActiveItem || typeof event.nativeEvent.zoomScale !== "number") {
                            return;
                          }
                          setActiveZoomScale(event.nativeEvent.zoomScale);
                        }}
                      >
                        <Image source={{ uri: item.uri }} style={styles.previewImage} resizeMode="contain" />
                      </ScrollView>
                    ) : (
                      <View style={styles.previewVideoContainer}>
                        {!isActiveItem ? (
                          <View style={styles.previewVideoSurface}>
                            {item.thumbnailUri ? (
                              <Image source={{ uri: item.thumbnailUri }} style={styles.previewVideoThumbnail} />
                            ) : null}
                            <View style={styles.previewVideoInactiveOverlay}>
                              <Text style={styles.previewVideoInactiveText}>Swipe here to preview video</Text>
                            </View>
                          </View>
                        ) : isExpoGo ? (
                          <View style={styles.errorContainer}>
                            <Text style={styles.previewVideoError}>Video preview is unavailable in Expo Go.</Text>
                            <Text style={styles.previewVideoErrorHint}>
                              Use a development build to preview videos in-app, or select this clip and save it to your gallery.
                            </Text>
                            <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(item.uri)}>
                              <Text style={styles.saveFromPreviewButtonText}>
                                {selectedUris.has(item.uri) ? "✓ Selected for Save" : "Select to Save"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : !hasExpoVideoNativeModule ? (
                          <View style={styles.errorContainer}>
                            <Text style={styles.previewVideoError}>Video preview module is missing in this app build.</Text>
                            <Text style={styles.previewVideoErrorHint}>
                              Rebuild and reinstall your development client after adding expo-video, then reopen this preview.
                            </Text>
                            <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(item.uri)}>
                              <Text style={styles.saveFromPreviewButtonText}>
                                {selectedUris.has(item.uri) ? "✓ Selected for Save" : "Select to Save"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : videoPlayerState !== "error" ? (
                          <View style={styles.previewVideoScrubberWrap}>
                            {item.thumbnailUri ? (
                              <Image source={{ uri: item.thumbnailUri }} style={styles.previewVideoThumbnail} />
                            ) : null}
                            <ExpoVideoScrubberPreview
                              uri={normalizeLocalMediaUri(item.uri)}
                              videoLabel={item.label}
                              onStateChange={setVideoPlayerState}
                              onError={setVideoErrorText}
                              onFrameExtracted={onFrameExtracted}
                              onScrubbingChange={setIsScrubbingActive}
                            />
                            {videoPlayerState === "loading" ? (
                              <View style={styles.previewVideoLoading}>
                                <ActivityIndicator color={colors.previewLoadingText} />
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
                            <Pressable style={styles.saveFromPreviewButton} onPress={() => toggleSelection(item.uri)}>
                              <Text style={styles.saveFromPreviewButtonText}>
                                {selectedUris.has(item.uri) ? "✓ Selected for Save" : "Select to Save"}
                              </Text>
                            </Pressable>
                          </View>
                        )}

                        <Text style={styles.previewVideoTitle}>{item.label}</Text>
                        <Text style={styles.previewVideoBody}>
                          Scrub the timeline, then tap Save Still to add a high-quality frame to your gallery.
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <Text style={styles.previewHelpText}>
            Swipe to browse. Pinch to zoom images. For videos, scrub the timeline and save a still.
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
            <ActivityIndicator color={colors.previewLoadingText} />
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
    backgroundColor: colors.background
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "bold"
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4
  },
  emptyState: {
    width: "100%",
    paddingVertical: 40,
    alignItems: "center"
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700"
  },
  emptyBody: {
    color: colors.textMuted,
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
    backgroundColor: colors.surfaceMuted
  },
  mediaTapArea: {
    width: "100%",
    height: "100%"
  },
  itemSelected: {
    borderColor: colors.primary
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
    backgroundColor: colors.mediaOverlay,
    padding: 6
  },
  labelText: {
    color: colors.textOnAccent,
    fontSize: 12,
    textAlign: "center"
  },
  checkmarkContainer: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: colors.primary,
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
    backgroundColor: colors.mediaOverlay,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  selectButtonText: {
    color: colors.textOnAccent,
    fontSize: 12,
    fontWeight: "600"
  },
  checkmarkText: {
    color: colors.textOnAccent,
    fontWeight: "bold",
    fontSize: 14
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    flexDirection: "row",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  buttonText: {
    color: colors.textOnAccent,
    fontWeight: "bold",
    fontSize: 16
  },
  discardButton: {
    backgroundColor: colors.secondary
  },
  saveButton: {
    backgroundColor: colors.primary
  },
  saveButtonDisabled: {
    backgroundColor: colors.sand,
    opacity: 0.7
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: colors.fullscreenOverlay
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
    backgroundColor: colors.primaryDark
  },
  previewActionText: {
    color: colors.textOnAccent,
    fontWeight: "700"
  },
  previewBody: {
    flex: 1
  },
  previewPager: {
    flex: 1
  },
  previewPagerContent: {
    flexGrow: 1
  },
  previewPage: {
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
    paddingHorizontal: 10,
    paddingBottom: 16,
    justifyContent: "center",
    gap: 8
  },
  previewVideoSurface: {
    width: "100%",
    aspectRatio: 3 / 4,
    maxHeight: "68%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.videoSurface
  },
  previewVideoScrubberWrap: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: colors.videoSurface
  },
  previewVideoScrubberColumn: {
    width: "100%"
  },
  previewVideoPlayerWrap: {
    width: "100%",
    overflow: "hidden"
  },
  nativeVideoPlayer: {
    flex: 1,
    backgroundColor: colors.espresso
  },
  scrubberControls: {
    padding: 12,
    gap: 10,
    backgroundColor: colors.espresso,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16
  },
  scrubberTransportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  scrubberPlayButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14
  },
  scrubberPlayButtonText: {
    color: colors.textOnAccent,
    fontWeight: "700",
    fontSize: 14
  },
  scrubberTimeText: {
    color: colors.previewLoadingText,
    fontSize: 14,
    fontWeight: "600"
  },
  scrubberTrack: {
    height: 62,
    borderRadius: 8,
    backgroundColor: colors.scrubberTrack,
    justifyContent: "center",
    marginVertical: 6,
    overflow: "visible"
  },
  filmstripRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.espresso
  },
  filmstripFrame: {
    flex: 1,
    height: "100%",
    resizeMode: "cover"
  },
  filmstripFramePlaceholder: {
    flex: 1,
    height: "100%",
    backgroundColor: colors.scrubberTrack
  },
  filmstripDim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: "rgba(78, 52, 46, 0.55)"
  },
  scrubberPlayhead: {
    position: "absolute",
    top: -6,
    bottom: -6,
    width: 36,
    marginLeft: -18,
    alignItems: "center",
    justifyContent: "center"
  },
  scrubberPlayheadLine: {
    width: 3,
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.scrubberThumb
  },
  scrubberThumb: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.scrubberThumb,
    borderWidth: 3,
    borderColor: colors.primary
  },
  saveStillButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center"
  },
  saveStillButtonDisabled: {
    opacity: 0.7
  },
  saveStillButtonText: {
    color: colors.textOnAccent,
    fontWeight: "700",
    fontSize: 15
  },
  scrubberHint: {
    color: colors.sand,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 15
  },
  previewVideoThumbnail: {
    ...StyleSheet.absoluteFillObject,
    resizeMode: "cover"
  },
  previewVideoLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.previewOverlay,
    gap: 8
  },
  previewVideoLoadingText: {
    color: colors.previewLoadingText,
    fontSize: 13
  },
  previewVideoInactiveOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.previewOverlay
  },
  previewVideoInactiveText: {
    color: colors.previewLoadingText,
    fontSize: 13,
    fontWeight: "600"
  },
  previewVideoTitle: {
    color: colors.textOnAccent,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center"
  },
  previewVideoBody: {
    color: colors.sand,
    textAlign: "center",
    fontSize: 12
  },
  errorContainer: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 10
  },
  previewVideoError: {
    color: colors.error,
    fontSize: 14,
    textAlign: "center",
    fontWeight: "600"
  },
  previewVideoErrorHint: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center"
  },
  saveFromPreviewButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  saveFromPreviewButtonText: {
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: "600"
  },
  videoFallbackThumb: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.surfaceMuted,
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
    backgroundColor: colors.mediaOverlay,
    alignItems: "center",
    justifyContent: "center"
  },
  videoBadgeIcon: {
    color: colors.textOnAccent,
    fontSize: 15,
    fontWeight: "700"
  },
  videoFallbackText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center"
  },
  videoFallbackHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    textAlign: "center"
  },
  previewHelpText: {
    color: colors.sand,
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
    backgroundColor: colors.primaryDark,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  closeBarButtonText: {
    color: colors.textOnAccent,
    fontWeight: "700",
    fontSize: 14
  }
});
