import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

const OUTPUT_DIR = `${FileSystem.documentDirectory}pycsure/`;

export function normalizeLocalMediaUri(uri: string) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri)) {
    return uri;
  }

  return `file://${uri}`;
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

  await MediaLibrary.saveToLibraryAsync(normalizeLocalMediaUri(localUri));
  return true;
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
