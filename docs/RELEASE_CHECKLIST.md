# Release Checklist

## Preflight
- [ ] Install Node.js and run `npm install`
- [ ] Run `npx expo-doctor` and `npx tsc --noEmit`
- [ ] Replace placeholder `assets/capture.mp3`
- [ ] Confirm save-destination flows on iOS and Android

## Functional Validation
- [ ] Capture flow generates exactly 12 processed photo variants
- [ ] 4-second video output saves correctly at preferred 4K resolution
- [ ] Prompt flow supports generate + reroll + no immediate repeat with cooldown
- [ ] Camera flip, grid overlay, large viewfinder, and timer are stable
- [ ] All sessions report 13 total outputs (12 photos + 1 video)
- [ ] Result review selection and export work for Gallery, Files, and Both
- [ ] Capture cancellation does not leave UI locked

## Reliability
- [ ] Camera/microphone/media permissions denied state is graceful
- [ ] Low-storage failure path surfaces an error to user
- [ ] Timeouts in variant processing do not crash app
- [ ] Capture button lock prevents overlapping jobs

## Performance
- [ ] End-to-end processing under target on baseline Android
- [ ] End-to-end processing under target on baseline iOS
- [ ] Repeated captures do not cause runaway memory growth

## TestFlight (iOS)
- [ ] Commit and push latest changes to GitHub
- [ ] Build: `npm run eas:build:production:ios`
- [ ] Submit: `npm run eas:submit:ios:production`
- [ ] Confirm build appears in App Store Connect → TestFlight
- [ ] Install via TestFlight and smoke-test capture + export flows

## Sign-off
- [ ] QA checklist complete
- [ ] Known limitations documented
- [ ] MVP release candidate tagged
