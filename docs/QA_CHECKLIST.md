# QA Checklist

## Device Matrix
- Android (mid-range): front and rear camera
- iOS (mid-range): front and rear camera

## Functional
- Capture creates 12 processed photo outputs and 1 video output (13 total).
- All output files use deterministic names.
- Prompt button returns a prompt quickly with category metadata.
- Prompt reroll works and avoids immediate repeats with cooldown behavior.
- Flip camera switches devices reliably.
- No preview mode is enabled by default and still captures.
- Meme sound plays on capture tap.
- Selfie and group flash variants are visually distinct per filter.

## Reliability
- Permission denied path is handled and displayed.
- Low storage path shows failure without app crash.
- Partial processing failures do not freeze UI.
- Repeated taps are blocked while a capture job runs.

## Performance
- End-to-end capture completion target: under 4 seconds on baseline device.
- UI remains responsive while processing variants.
- Memory usage does not grow unbounded during repeated captures.
- Variant rendering failures do not abort entire session.

## Release
- Replace placeholder `assets/capture.mp3` with production meme sound.
- Confirm app permissions text and legal language.
- Verify gallery save behavior on Android and iOS.
