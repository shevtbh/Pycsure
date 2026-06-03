# Pycsure

Expo React Native MVP for a CampSnap-style camera workflow.

## MVP Features
- One-tap capture pipeline producing `13` outputs:
  - `12` processed photo variants (`4 filters x 3 flash modes`)
  - `1` four-second video
- Optional 4-second video capture per tap
- 4K photo and video capture (falls back to device max resolution)
- Meme sound on shutter; optional timer-complete sound after countdown
- Funny pose prompts with reroll, cooldown, and repeat prevention
- Live viewfinder with optional grid overlay and expandable large preview (~60% screen height)
- Capture countdown timer: Off, 3s, 5s, or 10s
- Save destinations: Gallery, Files (Pycsure folder), or Both
- Result review with selective export, video scrubbing, and frame extraction
- Haptic feedback on capture and prompt actions
- Local-first storage and configurable gallery / folder export

## Tech Stack
- Expo + React Native + TypeScript
- Vision Camera (Expo development build)
- React Native Skia (offscreen filter/flash rendering)
- Expo Audio (capture and timer sounds)
- Expo Video + Expo Video Thumbnails (in-app video preview and frame extraction)
- Expo Image Manipulator (image utility support)
- Expo FileSystem + Media Library
- Expo Haptics
- AsyncStorage (prompt history and save preferences)

## Dependencies (validated)
- `react-native-vision-camera`
- `expo-video`
- `expo-video-thumbnails`
- `@shopify/react-native-skia`
- `expo-audio`
- `expo-image-manipulator`
- `expo-media-library`
- `expo-file-system`
- `expo-haptics`
- `expo-router` + required peers (`expo-constants`, `expo-linking`)

## Run (Dev Client)
1. Install Node.js 20+ and npm.
2. Install dependencies:
   - `npm install`
3. Validate setup:
   - `npx expo-doctor`
   - `npx tsc --noEmit`
4. Build native dev client:
   - Android: `npm run android`
   - iOS: `npm run ios`
5. Start the app:
   - `npm run start`

## EAS Builds
- iOS dev client: `npm run eas:build:ios`
- iOS internal (dev client): `npm run eas:build:internal:ios`
- iOS App Store / TestFlight: `npm run eas:build:production:ios`
- Submit latest iOS build to App Store Connect: `npm run eas:submit:ios:production`

## Save Destinations
| Option | iOS | Android |
|--------|-----|---------|
| Gallery | Photo library | Photo library |
| Files | Files → On My iPhone → Pycsure | Pictures/Pycsure album |
| Both | Gallery + Pycsure folder | Gallery + Pycsure album |

Default save destination is Gallery. Preference persists via AsyncStorage.

## Notes
- Vision Camera requires a development build; Expo Go is not enough.
- `assets/capture.mp3` is a placeholder file and should be replaced with a real meme sound.
- Rendering pipeline uses one source photo, then generates all 12 photo variants with deterministic filenames.
- `expo-audio` is used for stable cross-platform capture and timer-complete sound behavior.
- `expo-video` is used for native in-app video playback during review.
- iOS file sharing is enabled so the Pycsure folder is accessible via the Files app.
