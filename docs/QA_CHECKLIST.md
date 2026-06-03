# QA Checklist

## Device Matrix
- Android (mid-range): front and rear camera
- iOS (mid-range): front and rear camera

## Functional
- Capture creates 12 processed photo outputs and 1 video output (13 total).
- All output files use deterministic names.
- 4K resolution is used when the device camera format supports it.
- Prompt button returns a prompt quickly with category metadata.
- Prompt reroll works and avoids immediate repeats with cooldown behavior.
- Flip camera switches devices reliably.
- Live viewfinder displays camera preview.
- Large viewfinder toggle expands preview height.
- Grid overlay toggle shows and hides rule-of-thirds lines.
- Timer (Off / 3s / 5s / 10s) delays capture with visible countdown.
- Timer-complete sound plays after countdown (when sound enabled).
- Meme sound plays on capture tap (when sound enabled).
- Sound toggle disables shutter and timer sounds.
- Flash toggle controls hardware flash bracket behavior.
- Selfie and group flash variants are visually distinct per filter.
- Result review shows photos and video with scrubbing / frame extraction.
- User can select individual captures before export.
- Save To: Gallery writes to photo library.
- Save To: Files writes to Pycsure folder (Files app on iOS).
- Save To: Both writes to gallery and Pycsure folder.
- Save destination preference persists after app restart.
- Cancel button aborts in-progress capture cleanly.

## Reliability
- Permission denied path is handled and displayed.
- Low storage path shows failure without app crash.
- Partial processing failures do not freeze UI.
- Repeated taps are blocked while a capture job runs.

## Performance
- End-to-end capture completion target: under 4 seconds on baseline device (excluding countdown timer).
- UI remains responsive while processing variants.
- Memory usage does not grow unbounded during repeated captures.
- Variant rendering failures do not abort entire session.

## Release
- Replace placeholder `assets/capture.mp3` with production meme sound.
- Confirm app permissions text and legal language.
- Verify gallery and Pycsure folder save behavior on Android and iOS.
- Verify iOS Files app access to Pycsure folder (UIFileSharingEnabled).
