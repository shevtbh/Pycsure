import { StyleSheet, View } from "react-native";
import { colors } from "../constants/theme";

export function ViewfinderGridOverlay() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.line, styles.lineVertical, { left: "33.33%" }]} />
      <View style={[styles.line, styles.lineVertical, { left: "66.66%" }]} />
      <View style={[styles.line, styles.lineHorizontal, { top: "33.33%" }]} />
      <View style={[styles.line, styles.lineHorizontal, { top: "66.66%" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    position: "absolute",
    backgroundColor: colors.viewfinderGrid
  },
  lineVertical: {
    top: 0,
    bottom: 0,
    width: 1
  },
  lineHorizontal: {
    left: 0,
    right: 0,
    height: 1
  }
});
