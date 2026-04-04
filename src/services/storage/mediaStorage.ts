import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

const OUTPUT_DIR = `${FileSystem.documentDirectory}pycsure/`;

async function ensureOutputDirectory() {
  const dirInfo = await FileSystem.getInfoAsync(OUTPUT_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(OUTPUT_DIR, { intermediates: true });
  }
}

export async function duplicateToOutputDirectory(sourceUri: string, filename: string) {
  await ensureOutputDirectory();
  const destination = `${OUTPUT_DIR}${filename}`;
  await FileSystem.copyAsync({
    from: sourceUri,
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

  await MediaLibrary.saveToLibraryAsync(localUri);
  return true;
}
