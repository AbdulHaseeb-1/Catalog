import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirm. Native Alert.alert is unreliable on web.
 * Returns true if the user confirmed the destructive action.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = 'Delete'
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { confirm?: (m: string) => boolean }).confirm === 'function'
        ? (globalThis as { confirm: (m: string) => boolean }).confirm(`${title}\n\n${message}`)
        : true;
    return Promise.resolve(!!ok);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: 'destructive',
        onPress: () => resolve(true),
      },
    ]);
  });
}
