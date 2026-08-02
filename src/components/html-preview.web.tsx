import { createElement, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

type Props = {
  html: string;
  /** Document page width in points, so the preview can be scaled to fit. */
  pageWidth: number;
};

/**
 * react-native-webview has no web implementation, so on web the preview is an
 * iframe holding the same document the export produces. The document is laid
 * out at a fixed page width, so it is scaled down to the available width
 * rather than being cropped.
 */
export function HtmlPreview({ html, pageWidth }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const scale = size.width ? Math.min(1, size.width / pageWidth) : 1;

  return (
    <View style={{ flex: 1, overflow: 'hidden', backgroundColor: '#fff' }} onLayout={onLayout}>
      {size.width
        ? createElement('iframe', {
            srcDoc: html,
            title: 'Catalogue preview',
            sandbox: 'allow-same-origin',
            style: {
              width: pageWidth,
              // Undo the scale so the frame still fills the container.
              height: size.height / scale,
              border: 'none',
              background: '#fff',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            },
          })
        : null}
    </View>
  );
}
