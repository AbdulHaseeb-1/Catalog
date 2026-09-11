import { ScrollView, StyleSheet, Text } from "react-native";

/**
 * Shown when the app is opened directly (home screen icon, App Store, etc.)
 * rather than via a `verifybridge://session/:token` or
 * `https://<mobile-host>/session/:token` deep link. There is nothing to
 * verify without a session token, so this just explains what the app is for.
 */
export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>VerifyBridge</Text>
      <Text style={styles.body}>
        This app completes an identity verification that was started on a computer without a webcam.
      </Text>
      <Text style={styles.body}>
        On your computer, open the VerifyBridge extension or website and scan the QR code, or tap
        the verification link it shows you - this app (or your browser, if it isn&apos;t installed)
        will open directly to that session.
      </Text>
      <Text style={styles.faint}>There is nothing to do here until you start a verification.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 22, fontWeight: "700", color: "#111827", textAlign: "center" },
  body: { fontSize: 14, color: "#4B5563", textAlign: "center", lineHeight: 20 },
  faint: { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 8 },
});
