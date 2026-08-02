import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

/** Renders the generated catalog HTML exactly as the PDF engine will see it. */
export function HtmlPreview({ html }: { html: string }) {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={styles.web}
      scalesPageToFit
      setSupportMultipleWindows={false}
      startInLoadingState
      allowFileAccess
      allowUniversalAccessFromFileURLs
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#fff' },
});
