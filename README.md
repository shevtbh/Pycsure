# Pycsure

Expo React Native MVP for a CampSnap-style camera workflow.

## MVP Features
- One-tap capture pipeline producing `13` outputs:
  - `12` processed photo variants (`4 filters x 3 flash modes`)
  - `1` four-second video
- Optional 4-second video capture per tap
- Meme sound on shutter
- Funny pose prompts with reroll, cooldown, and repeat prevention
- Local-first storage and gallery save

## Tech Stack
- Expo + React Native + TypeScript
- Vision Camera (Expo development build)
- React Native Skia (offscreen filter/flash rendering)
- Expo AV (capture sound)
- Expo Image Manipulator (image utility support)
- Expo FileSystem + Media Library
- AsyncStorage (prompt history)

## Dependencies (validated)
- `react-native-vision-camera`
- `@shopify/react-native-skia`
- `expo-av`
- `expo-image-manipulator`
- `expo-media-library`
- `expo-file-system`
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

## Notes
- Vision Camera requires a development build; Expo Go is not enough.
- `assets/capture.mp3` is a placeholder file and should be replaced with a real meme sound.
- Rendering pipeline uses one source photo, then generates all 12 photo variants with deterministic filenames.
- `expo-av` is currently retained for stable cross-platform capture sound behavior in this project.
