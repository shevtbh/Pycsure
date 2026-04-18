import { Platform } from "react-native";

async function loadExpoHaptics() {
  try {
    return await import("expo-haptics");
  } catch {
    return null;
  }
}

async function runHaptic(
  style: "light" | "medium"
) {
  const haptics = await loadExpoHaptics();
  if (!haptics) {
    return;
  }

  try {
    if (Platform.OS === "android") {
      const androidType =
        style === "medium" ? haptics.AndroidHaptics.Confirm : haptics.AndroidHaptics.Segment_Frequent_Tick;
      await haptics.performAndroidHapticsAsync(androidType);
      return;
    }

    const impactStyle =
      style === "medium" ? haptics.ImpactFeedbackStyle.Medium : haptics.ImpactFeedbackStyle.Light;
    await haptics.impactAsync(impactStyle);
  } catch {
    // Ignore haptic errors so camera flow never breaks.
    try {
      await haptics.selectionAsync();
    } catch {
      // Fallback also failed; keep this non-fatal.
    }
  }
}

export async function triggerPromptHaptic() {
  await runHaptic("light");
}

export async function triggerCaptureHaptic() {
  await runHaptic("medium");
}
