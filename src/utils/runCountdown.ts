export async function runCountdown(
  seconds: number,
  onTick: (remaining: number) => void,
  shouldCancel?: () => boolean
): Promise<void> {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    if (shouldCancel?.()) {
      return;
    }
    onTick(remaining);
    // Sleep in small slices so a cancel request is picked up within ~100ms
    // instead of waiting out the full second.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (shouldCancel?.()) {
        return;
      }
    }
  }
  if (shouldCancel?.()) {
    return;
  }
  onTick(0);
}
