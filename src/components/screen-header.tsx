import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/layout';
import { Spacing } from '@/constants/theme';

type Props = {
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Trailing control aligned with the title, e.g. a count badge. */
  right?: ReactNode;
};

export function ScreenHeader({ kicker, title, subtitle, right }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          {kicker ? (
            <ThemedText themeColor="textSecondary" style={styles.kicker}>
              {kicker}
            </ThemedText>
          ) : null}
          <ThemedText style={styles.title}>{title}</ThemedText>
        </View>
        {right}
      </View>
      {subtitle ? (
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Screen.padTop,
    paddingBottom: Spacing.three,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
});
