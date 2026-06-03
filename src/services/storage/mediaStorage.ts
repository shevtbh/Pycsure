import * as FileSystem from "expo-file-system/legacy";
import { Directory, File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Platform } from "react-native";
import { SaveDestination } from "../../types/preferences";

export const PYCSURE_FOLDER_NAME = "Pycsure";

const OUTPUT_DIR = `${FileSystem.documentDirectory}pycsure/`;

export function normalizeLocalMediaUri(uri: string) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri)) {
    return uri;
  }

  return `file://${uri}`;
}

/** Android MediaLibrary requires a local path starting with file:///. */
function ensureAndroidMediaUri(uri: string): string {
  const normalized = normalizeLocalMediaUri(uri);
  if (Platform.OS !== "android") {
    return normalized;
  }

  if (normalized.startsWith("file:///")) {
    return normalized;
  }

  if (normalized.startsWith("file://")) {
    const path = normalized.slice("file://".length).replace(/^\/+/, "");
    return `file:///${path}`;
  }

  return `file:///${normalized.replace(/^\/+/, "")}`;
}

function mediaUriForPlatform(localUri: string): string {
  return Platform.OS === "android" ? ensureAndroidMediaUri(localUri) : normalizeLocalMediaUri(localUri);
}

async function ensureOutputDirectory() {
  const dirInfo = await FileSystem.getInfoAsync(OUTPUT_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(OUTPUT_DIR, { intermediates: true });
  }
}

export async function duplicateToOutputDirectory(sourceUri: string, filename: string) {
  await ensureOutputDirectory();
  const destination = normalizeLocalMediaUri(`${OUTPUT_DIR}${filename}`);
  await FileSystem.copyAsync({
    from: normalizeLocalMediaUri(sourceUri),
    to: destination
  });
  return destination;
}

export async function writeBase64ToOutputDirectory(base64Data: string, filename: string) {
  await ensureOutputDirectory();
  const destination = `${OUTPUT_DIR}${filename}`;
  await FileSystem.writeAsStringAsync(destination, base64Data, {
    encoding: FileSystem.EncodingType.Base64
  });
  return destination;
}

export async function saveToGallery(localUri: string) {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return false;
  }

  await MediaLibrary.saveToLibraryAsync(mediaUriForPlatform(localUri));
  return true;
}

function filenameFromUri(uri: string): string {
  const normalized = normalizeLocalMediaUri(uri);
  const lastSegment = normalized.split("/").pop() ?? "";
  const filename = lastSegment.split("?")[0].split("#")[0];
  return filename.length > 0 ? filename : `capture_${Date.now()}.jpg`;
}

function isImageFilename(filename: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension === "jpg" || extension === "jpeg" || extension === "png" || extension === "heic";
}

/**
 * Saves into a dedicated Pycsure album (Android: Files → Pictures/DCIM → Pycsure).
 * On iOS this also ensures captures land in a named album if Documents export fails.
 */
async function saveToPycsureMediaAlbum(localUri: string): Promise<boolean> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    return false;
  }

  const uri = mediaUriForPlatform(localUri);
  let album = await MediaLibrary.getAlbumAsync(PYCSURE_FOLDER_NAME);

  if (album == null) {
    const asset = await MediaLibrary.createAssetAsync(uri);
    if (Platform.OS === "ios") {
      await MediaLibrary.createAlbumAsync(PYCSURE_FOLDER_NAME, asset);
    } else {
      await MediaLibrary.createAlbumAsync(PYCSURE_FOLDER_NAME, asset, false);
    }
    album = await MediaLibrary.getAlbumAsync(PYCSURE_FOLDER_NAME);
  } else {
    await MediaLibrary.createAssetAsync(uri, album);
  }

  if (album == null) {
    return false;
  }

  if (Platform.OS === "android") {
    try {
      await MediaLibrary.migrateAlbumIfNeededAsync(album);
    } catch {
      // Album migration is only required on some Android versions.
    }
  }

  return true;
}

/**
 * iOS Files app: On My iPhone → Pycsure → Pycsure
 * Requires UIFileSharingEnabled in the native build (see app.json).
 */
async function saveToIosDocumentsFolder(localUri: string, filename: string): Promise<boolean> {
  try {
    const folder = new Directory(Paths.document, PYCSURE_FOLDER_NAME);
    if (!folder.exists) {
      folder.create({ intermediates: true, idempotent: true });
    }

    const source = new File(mediaUriForPlatform(localUri));
    if (!source.exists) {
      return false;
    }

    const destination = new File(folder, filename);
    if (destination.exists) {
      destination.delete();
    }

    source.copy(destination);
    return destination.exists && (destination.size ?? 0) > 0;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[mediaStorage] iOS Documents export failed, trying legacy copy.", error);
    return saveToIosDocumentsFolderLegacy(localUri, filename);
  }
}

async function saveToIosDocumentsFolderLegacy(localUri: string, filename: string): Promise<boolean> {
  if (!FileSystem.documentDirectory) {
    return false;
  }

  const folderUri = `${FileSystem.documentDirectory}${PYCSURE_FOLDER_NAME}/`;
  const dirInfo = await FileSystem.getInfoAsync(folderUri);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(folderUri, { intermediates: true });
  }

  const sourceUri = mediaUriForPlatform(localUri);
  const destinationUri = normalizeLocalMediaUri(`${folderUri}${filename}`);
  const sourceInfo = await FileSystem.getInfoAsync(sourceUri);
  if (!sourceInfo.exists) {
    return false;
  }

  const existingDest = await FileSystem.getInfoAsync(destinationUri);
  if (existingDest.exists) {
    await FileSystem.deleteAsync(destinationUri, { idempotent: true });
  }

  if (isImageFilename(filename)) {
    try {
      const base64 = await FileSystem.readAsStringAsync(sourceUri, {
        encoding: FileSystem.EncodingType.Base64
      });
      await FileSystem.writeAsStringAsync(destinationUri, base64, {
        encoding: FileSystem.EncodingType.Base64
      });
    } catch {
      await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
    }
  } else {
    await FileSystem.copyAsync({ from: sourceUri, to: destinationUri });
  }

  const destInfo = await FileSystem.getInfoAsync(destinationUri);
  return destInfo.exists && (destInfo.size ?? 0) > 0;
}

async function saveToPycsureFolderIOS(localUri: string, filename: string): Promise<boolean> {
  const documentsSaved = await saveToIosDocumentsFolder(localUri, filename);
  if (documentsSaved) {
    return true;
  }

  return saveToPycsureMediaAlbum(localUri);
}

/** Saves a capture to the user-visible Pycsure folder on device storage. */
export async function saveToPycsureFolder(localUri: string): Promise<boolean> {
  const filename = filenameFromUri(localUri);

  try {
    if (Platform.OS === "android") {
      return await saveToPycsureMediaAlbum(localUri);
    }

    if (Platform.OS === "ios") {
      return await saveToPycsureFolderIOS(localUri, filename);
    }

    return false;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to save ${filename} to ${PYCSURE_FOLDER_NAME} folder:`, error);
    return false;
  }
}

export async function exportCapturesByPreference(uris: string[], destination: SaveDestination): Promise<void> {
  const uniqueUris = Array.from(new Set(uris));
  const shouldExportToGallery = destination === "gallery" || destination === "both";
  const shouldExportToFiles = destination === "files" || destination === "both";

  for (const uri of uniqueUris) {
    if (shouldExportToGallery) {
      const saved = await saveToGallery(uri);
      if (!saved) {
        throw new Error("Photo library permission is required to save captures.");
      }
    }

    if (shouldExportToFiles) {
      const saved = await saveToPycsureFolder(uri);
      if (!saved) {
        throw new Error(
          Platform.OS === "android"
            ? `Could not save to the ${PYCSURE_FOLDER_NAME} folder. Check media permissions in Settings.`
            : `Could not save to the ${PYCSURE_FOLDER_NAME} folder. Allow photo access in Settings, then rebuild the app to see files under Files → On My iPhone → Pycsure → ${PYCSURE_FOLDER_NAME}.`
        );
      }
    }
  }
}

export async function getLocalMediaInfo(
  uri: string
): Promise<{ exists: boolean; size?: number }> {
  try {
    const info = await FileSystem.getInfoAsync(normalizeLocalMediaUri(uri));
    return { exists: info.exists, size: info.exists ? info.size : undefined };
  } catch {
    return { exists: false };
  }
}

export async function deleteMedia(uri: string) {
  try {
    await FileSystem.deleteAsync(normalizeLocalMediaUri(uri), { idempotent: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to delete media at ${uri}:`, error);
  }
}
