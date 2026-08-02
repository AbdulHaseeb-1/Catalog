import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Screen, TabBar } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLibraryStore } from '@/stores/library-store';
import { layoutMeta } from '@/types/models';

export default function SettingsScreen() {
  const theme = useTheme();
  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const settings = useLibraryStore((s) => s.exportSettings);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            maxWidth: Screen.maxWidth,
            paddingHorizontal: Screen.padX,
            paddingBottom: TabBar.contentInset + Spacing.four,
          },
        ]}
        showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Settings"
          subtitle="Everything stays on this device. Nothing is uploaded unless you share a PDF yourself."
        />

        <Card>
          <Row icon="⬢" label="Companies" value={String(companies.length)} />
          <Divider />
          <Row icon="◆" label="Formulas" value={String(formulas.length)} />
          <Divider />
          <Row icon="▦" label="Products" value={String(products.length)} />
          <Divider />
          <Row icon="💾" label="Storage" value="On device" />
        </Card>

        <Card>
          <ThemedText style={styles.cardTitle}>Current export setup</ThemedText>
          <View style={styles.steps}>
            <Row
              icon="▤"
              label="Layout"
              value={layoutMeta(settings.layoutId).name}
              compact
            />
            <Row icon="📄" label="Paper" value={settings.pageSize} compact />
            <Row
              icon="🏷"
              label="Label pages"
              value={settings.includeSectionLabels ? 'On' : 'Off'}
              compact
            />
          </View>
          <ThemedText themeColor="textSecondary" style={styles.note}>
            Change these on the PDF tab — they apply to every catalogue you generate.
          </ThemedText>
        </Card>

        <Card>
          <ThemedText style={styles.cardTitle}>How it works</ThemedText>
          <View style={styles.steps}>
            <Step n="1" text="Add your companies and formulas once" />
            <Step n="2" text="Add products — company, formula, pack shot" />
            <Step n="3" text="Generate a PDF for one company, one formula, or all of them" />
          </View>
        </Card>

        <ThemedText themeColor="textSecondary" style={styles.footer}>
          Catalog Studio · Expo SDK 57
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        Elevation.card,
        { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
      ]}>
      {children}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  compact,
}: {
  icon: string;
  label: string;
  value: string;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View style={[styles.rowIcon, { backgroundColor: theme.primaryMuted }]}>
        <ThemedText style={{ fontSize: 13 }}>{icon}</ThemedText>
      </View>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
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
    width: '100%',
    alignSelf: 'center',
    gap: Screen.sectionGap,
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
  rowCompact: {
    minHeight: 38,
  },
  rowIcon: {
    width: 32,
    height: 32,
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
  note: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: Spacing.three,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
  },
});
