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

## Filter and Flash Behavior
- [ ] `STD`, `VTG1`, `VTG2`, and `BW` outputs are visibly different.
- [ ] `selfie` xenon profile looks softer/warmer than `group`.
- [ ] `group` xenon profile looks brighter/cooler with stronger falloff.
- [ ] Variants are generated from one source photo capture only.

## UX and Prompts
- [ ] No-preview CampSnap mode is on by default.
- [ ] Meme sound plays on every tap before capture starts.
- [ ] Prompt generation is fast and avoids immediate repeats.
- [ ] Prompt result includes a category for future expansion.

## Reliability
- [ ] Permissions-denied path is clear and non-crashing.
- [ ] Partial variant render failures do not abort entire session.
- [ ] Low-storage errors are surfaced to UI.
- [ ] Video recording interruptions are handled without deadlocking capture state.
