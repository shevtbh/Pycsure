import AsyncStorage from "@react-native-async-storage/async-storage";
import { SaveDestination } from "../../types/preferences";

const SAVE_DESTINATION_KEY = "pycsure:save-destination";
const DEFAULT_SAVE_DESTINATION: SaveDestination = "gallery";

let cachedDestination: SaveDestination | undefined;

function isSaveDestination(value: unknown): value is SaveDestination {
  return value === "files" || value === "gallery" || value === "both";
}

export async function getSaveDestination(): Promise<SaveDestination> {
  if (cachedDestination) {
    return cachedDestination;
  }

  const saved = await AsyncStorage.getItem(SAVE_DESTINATION_KEY);
  if (isSaveDestination(saved)) {
    cachedDestination = saved;
    return saved;
  }

  cachedDestination = DEFAULT_SAVE_DESTINATION;
  return DEFAULT_SAVE_DESTINATION;
}

export async function setSaveDestination(destination: SaveDestination): Promise<void> {
  cachedDestination = destination;
  await AsyncStorage.setItem(SAVE_DESTINATION_KEY, destination);
}
