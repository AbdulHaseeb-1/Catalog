import { createElement } from 'react';

/**
 * react-native-webview has no web implementation, so on web the preview is a
 * sandboxed iframe holding the same document the export produces.
 */
export function HtmlPreview({ html }: { html: string }) {
  return createElement('iframe', {
    srcDoc: html,
    title: 'Catalogue preview',
    sandbox: 'allow-same-origin',
    style: {
      flex: 1,
      width: '100%',
      height: '100%',
      border: 'none',
      background: '#fff',
    },
  });
}
