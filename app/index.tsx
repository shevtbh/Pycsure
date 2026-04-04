import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function ExpoGoPlaceholder() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Development build required</Text>
      <Text style={styles.body}>
        <Text style={styles.bold}>react-native-vision-camera</Text> does not run in Expo Go.{"\n\n"}
        Build and run a dev client:{"\n"}
        <Text style={styles.mono}>npx expo run:ios</Text>
        {" or "}
        <Text style={styles.mono}>npx expo run:android</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    padding: 24
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16
  },
  body: {
    color: "#aaa",
    fontSize: 16,
    lineHeight: 24
  },
  bold: {
    fontWeight: "600",
    color: "#ccc"
  },
  mono: {
    fontFamily: "monospace",
    color: "#7cf"
  }
});

export default function IndexPage() {
  const [Main, setMain] = useState<ComponentType | null>(() => (isExpoGo ? ExpoGoPlaceholder : null));

  useEffect(() => {
    if (isExpoGo) {
      return;
    }
    let cancelled = false;
    import("../src/components/CaptureScreen")
      .then(({ CaptureScreen }) => {
        if (!cancelled) {
          setMain(() => CaptureScreen);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMain(() => ExpoGoPlaceholder);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Main) {
    return (
      <View style={[styles.center, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return <Main />;
}
