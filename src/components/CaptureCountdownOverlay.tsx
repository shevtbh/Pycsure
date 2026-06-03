import { StyleSheet, Text, View } from "react-native";
import { colors } from "../constants/theme";

interface CaptureCountdownOverlayProps {
  secondsRemaining: number;
}

export function CaptureCountdownOverlay({ secondsRemaining }: CaptureCountdownOverlayProps) {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <Text style={styles.count}>{secondsRemaining}</Text>
      <Text style={styles.hint}>Hold still</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.countdownOverlay
  },
  count: {
    color: colors.textOnAccent,
    fontSize: 72,
    fontWeight: "800"
  },
  hint: {
    color: colors.previewLoadingText,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8
  }
});
