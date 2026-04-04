# Architecture

## Pipeline
1. Shutter tap triggers meme sound.
2. Camera captures one photo.
3. Camera records one 4-second video.
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
7. Saves locally and optionally to gallery.

## Modules
- `src/components/CaptureScreen.tsx`: UI + orchestration
- `src/services/camera/cameraService.ts`: camera permissions and capture wrappers
- `src/services/pipeline/filterEngine.ts`: deterministic filter computation and matrix generation
- `src/services/pipeline/flashEngine.ts`: xenon flash profile computation
- `src/services/pipeline/imageRenderer.ts`: Skia-based image rendering and encoding
- `src/services/pipeline/batchProcessor.ts`: capture fanout, timeout isolation, and summary
- `src/services/prompts/promptService.ts`: funny prompt generation + repeat control
- `src/services/storage/mediaStorage.ts`: local and gallery persistence

## Performance Guardrails
- Single source image capture per session (no recapture for variants)
- Batch loop reports progress to UI
- Per-variant timeout prevents long stalls
- Fallback write path preserves session continuity if one render pass fails
- GPU-native transforms run via Skia offscreen surface
