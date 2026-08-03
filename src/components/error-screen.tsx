import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

/**
 * Last-resort error UI.
 *
 * Deliberately built from bare React Native primitives with literal colours:
 * this renders *after* something in the tree has already thrown, so it must not
 * depend on the theme, the store, or any app component that might be the thing
 * that broke.
 */
export function ErrorScreen({
  title = 'Something went wrong',
  message,
  detail,
  actionLabel = 'Try again',
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title?: string;
  message: string;
  /** Stack or context — collapsed into a scrollable block, dev only by default. */
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#131314' : '#F7F7F8';
  const card = dark ? '#1E1F20' : '#FFFFFF';
  const ink = dark ? '#E8EAED' : '#1F1F1F';
  const muted = dark ? '#9AA0A6' : '#5F6368';
  const border = dark ? '#3C4043' : '#E8EAED';
  const accent = dark ? '#8AB4F8' : '#1A73E8';
  const onAccent = dark ? '#202124' : '#FFFFFF';

  return (
    <View style={[styles.screen, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={[styles.title, { color: ink }]}>{title}</Text>
          <Text style={[styles.message, { color: muted }]}>{message}</Text>

          {detail ? (
            <ScrollView
              style={[styles.detail, { borderColor: border }]}
              contentContainerStyle={styles.detailContent}
              nestedScrollEnabled>
              <Text style={[styles.detailText, { color: muted }]} selectable>
                {detail}
              </Text>
            </ScrollView>
          ) : null}

          {onAction ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAction}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: accent, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={[styles.buttonText, { color: onAccent }]}>{actionLabel}</Text>
            </Pressable>
          ) : null}

          {onSecondary && secondaryLabel ? (
            <Pressable
              accessibilityRole="button"
              onPress={onSecondary}
              style={({ pressed }) => [
                styles.button,
                styles.secondary,
                { borderColor: border, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={[styles.buttonText, { color: ink }]}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    gap: 12,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  emoji: { fontSize: 32 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
  },
  detail: {
    maxHeight: 180,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  detailContent: { padding: 12 },
  detailText: {
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  button: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: 4,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
