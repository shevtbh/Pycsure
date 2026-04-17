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
    const impactStyle =
      style === "medium" ? haptics.ImpactFeedbackStyle.Medium : haptics.ImpactFeedbackStyle.Light;
    await haptics.impactAsync(impactStyle);
  } catch {
    // Ignore haptic errors so camera flow never breaks.
  }
}

export async function triggerPromptHaptic() {
  await runHaptic("light");
}

export async function triggerCaptureHaptic() {
  await runHaptic("medium");
}
