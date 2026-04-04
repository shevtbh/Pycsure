# Release Checklist

## Preflight
- [ ] Install Node.js and run `npm install`
- [ ] Build Expo dev client for target devices
- [ ] Replace placeholder `assets/capture.mp3`

## Functional Validation
- [ ] Capture flow generates exactly 12 processed photo variants
- [ ] 4-second video output saves correctly
- [ ] Prompt flow supports generate + reroll + no immediate repeat with cooldown
- [ ] Camera flip and default no-preview mode are stable
- [ ] All sessions report 13 total outputs (12 photos + 1 video)

## Reliability
- [ ] Camera/microphone/media permissions denied state is graceful
- [ ] Low-storage failure path surfaces an error to user
- [ ] Timeouts in variant processing do not crash app
- [ ] Capture button lock prevents overlapping jobs

## Performance
- [ ] End-to-end processing under target on baseline Android
- [ ] End-to-end processing under target on baseline iOS
- [ ] Repeated captures do not cause runaway memory growth

## Sign-off
- [ ] QA checklist complete
- [ ] Known limitations documented
- [ ] MVP release candidate tagged
