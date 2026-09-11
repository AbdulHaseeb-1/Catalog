import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#F5F7FA" },
          headerTintColor: "#111827",
          contentStyle: { backgroundColor: "#F5F7FA" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "VerifyBridge" }} />
        <Stack.Screen name="session/[token]" options={{ title: "Verification" }} />
      </Stack>
    </>
  );
}
