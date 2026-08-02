import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  html: string;
  /** Document page width in points. The document carries a matching viewport
   * meta tag, so the WebView scales it to fit on its own. */
  pageWidth: number;
};

/** Renders the generated catalog HTML exactly as the PDF engine will see it. */
export function HtmlPreview({ html, pageWidth }: Props) {
  void pageWidth;
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
