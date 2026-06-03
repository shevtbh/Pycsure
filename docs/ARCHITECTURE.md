# Architecture

## Pipeline
1. Shutter tap triggers meme sound (if enabled) and optional countdown (0 / 3 / 5 / 10 seconds).
2. Camera captures one photo at 4K when supported (falls back to device max).
3. Camera records one 4-second video at 4K when supported.
4. Processor fans out 12 image variants:
   - Filters: `STD`, `VTG1`, `VTG2`, `BW`
   - Flash modes: `none`, `selfie`, `group`
5. Variant renderer applies:
   - Filter color matrix pass (`.flt`-style JSON preset)
   - Flash color pass (`selfie`/`group` xenon simulation)
   - Flash radial overlay for xenon falloff behavior
6. Processor saves 13 outputs per session:
   - 12 processed photos
   - 1 four-second video
7. Result review lets the user select captures to export.
8. Export respects save preference:
   - `gallery` → photo library
   - `files` → Pycsure folder (Documents on iOS, MediaLibrary album on Android)
   - `both` → gallery and Pycsure folder

## Modules
- `src/components/CaptureScreen.tsx`: UI, viewfinder, toggles, and orchestration
- `src/components/ViewfinderGridOverlay.tsx`: rule-of-thirds grid overlay
- `src/components/CaptureCountdownOverlay.tsx`: countdown display during timer
- `src/components/ResultReviewView.tsx`: post-capture review, selection, and video scrubbing
- `src/services/camera/cameraService.ts`: camera permissions, 4K format selection, and capture wrappers
- `src/services/camera/flashBracketCapture.ts`: hardware flash bracket capture
- `src/services/pipeline/filterEngine.ts`: deterministic filter computation and matrix generation
- `src/services/pipeline/flashEngine.ts`: xenon flash profile computation
- `src/services/pipeline/imageRenderer.ts`: Skia-based image rendering and encoding
- `src/services/pipeline/batchProcessor.ts`: capture fanout, timeout isolation, and summary
- `src/services/prompts/promptService.ts`: funny prompt generation + repeat control
- `src/services/storage/mediaStorage.ts`: local storage, gallery, and Pycsure folder export
- `src/services/storage/savePreferenceService.ts`: persisted save-destination preference
- `src/services/audio/soundService.ts`: capture and timer-complete sounds
- `src/services/media/videoFrameExtract.ts`: video thumbnail and frame extraction for review
- `src/services/haptics/hapticService.ts`: capture and prompt haptics
- `src/constants/theme.ts`: shared color tokens
- `src/types/preferences.ts`: save destination types and labels
- `src/utils/runCountdown.ts`: async countdown with cancellation support

## Performance Guardrails
- Single source image capture per session (no recapture for variants)
- 4K format preferred with graceful fallback to device maximum
- Batch loop reports progress to UI
- Per-variant timeout prevents long stalls
- Fallback write path preserves session continuity if one render pass fails
- GPU-native transforms run via Skia offscreen surface
- Capture cancellation unwinds the pipeline without deadlocking UI state
