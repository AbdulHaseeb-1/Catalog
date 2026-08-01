import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Screen, TabBar } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCatalogStore } from '@/stores/catalog-store';

export default function SettingsScreen() {
  const theme = useTheme();
  const catalogs = useCatalogStore((s) => s.catalogs);
  const photoCount = catalogs.reduce((sum, c) => sum + c.photoCount, 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            maxWidth: Screen.maxWidth,
            width: '100%',
            alignSelf: 'center',
            paddingHorizontal: Screen.padX,
            paddingTop: Screen.padTop,
            paddingBottom: TabBar.contentInset + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ThemedText style={styles.heading}>Settings</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.lead}>
            Local-first photo catalogs. Nothing leaves this device unless you share a PDF.
          </ThemedText>
        </View>

        <View
          style={[
            styles.card,
            Elevation.card,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}>
          <Row icon="▦" label="Catalogs" value={String(catalogs.length)} />
          <Divider color={theme.border} />
          <Row icon="🖼" label="Photos" value={String(photoCount)} />
          <Divider color={theme.border} />
          <Row icon="💾" label="Storage" value="On device" />
        </View>

        <View
          style={[
            styles.card,
            Elevation.card,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}>
          <ThemedText style={styles.cardTitle}>How it works</ThemedText>
          <View style={styles.steps}>
            <Step n="1" text="Create a catalog and batch-upload photos" />
            <Step n="2" text="Crop images to fit your grid (2×2, 2×3, …)" />
            <Step n="3" text="Preview and export a clean PDF to share" />
          </View>
        </View>

        <ThemedText themeColor="textSecondary" style={styles.footer}>
          Catalog Studio · Expo SDK 57
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: theme.primaryMuted }]}>
        <ThemedText style={{ fontSize: 14 }}>{icon}</ThemedText>
      </View>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

function Step({ n, text }: { n: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepBadge, { backgroundColor: theme.primaryMuted }]}>
        <ThemedText style={[styles.stepN, { color: theme.primary }]}>{n}</ThemedText>
      </View>
      <ThemedText themeColor="textSecondary" style={styles.stepText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    gap: Screen.sectionGap,
  },
  header: {
    gap: 8,
    marginBottom: 4,
  },
  heading: {
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: 4,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
  },
  steps: {
    gap: 12,
    marginTop: 8,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepN: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
  },
});
