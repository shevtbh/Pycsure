# MVP Checklist

## Build and Dependencies
- [ ] `npm install` completes without dependency resolution errors.
- [ ] `npx expo-doctor` passes all checks.
- [ ] `npx tsc --noEmit` passes.
- [ ] Native dev client builds for Android and iOS.

## Capture Contract
- [ ] One tap produces 12 processed photos (`4 filters x 3 flash modes`).
- [ ] One tap produces one 4-second video.
- [ ] Session summary reports 13 total outputs when successful.
- [ ] Capture button stays locked during active session.
- [ ] Capture can be cancelled mid-pipeline without freezing UI.
- [ ] 4K capture is used when the device supports it.

## Filter and Flash Behavior
- [ ] `STD`, `VTG1`, `VTG2`, and `BW` outputs are visibly different.
- [ ] `selfie` xenon profile looks softer/warmer than `group`.
- [ ] `group` xenon profile looks brighter/cooler with stronger falloff.
- [ ] Variants are generated from one source photo capture only.

## UX and Prompts
- [ ] Live viewfinder shows camera preview by default.
- [ ] Large viewfinder toggle expands preview to ~60% of screen height.
- [ ] Grid overlay toggle shows rule-of-thirds lines on viewfinder.
- [ ] Timer options (Off / 3s / 5s / 10s) delay capture with countdown overlay.
- [ ] Timer-complete sound plays when countdown finishes (when sound enabled).
- [ ] Meme sound plays on every tap before capture starts (when sound enabled).
- [ ] Prompt generation is fast and avoids immediate repeats.
- [ ] Prompt result includes a category for future expansion.
- [ ] Haptic feedback fires on capture and prompt actions.

## Save and Export
- [ ] Save destination preference persists across app restarts.
- [ ] Gallery export saves to photo library with permission prompt.
- [ ] Files export saves to Pycsure folder (Documents on iOS, Pictures/Pycsure on Android).
- [ ] Both export saves to gallery and Pycsure folder.
- [ ] Result review lets user select which captures to export (not auto-select all).

## Reliability
- [ ] Permissions-denied path is clear and non-crashing.
- [ ] Partial variant render failures do not abort entire session.
- [ ] Low-storage errors are surfaced to UI.
- [ ] Video recording interruptions are handled without deadlocking capture state.
