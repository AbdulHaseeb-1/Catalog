import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickerSheet } from '@/components/picker-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen, TabBar } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  assessExportReadiness,
  type ReadinessHref,
  type ReadinessIssue,
} from '@/lib/export-readiness';
import { runSafely } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import { useLibraryStore } from '@/stores/library-store';
import {
  LAYOUTS,
  cropForLayout,
  hasContactDetails,
  layoutMeta,
  type ExportSettings,
  type LayoutId,
  type PageSize,
  type ProductWithRefs,
} from '@/types/models';

type SheetMode = 'company' | 'formula' | null;

export default function GenerateScreen() {
  const theme = useTheme();
  const router = useRouter();

  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const settings = useLibraryStore((s) => s.exportSettings);
  const setExportSettings = useLibraryStore((s) => s.setExportSettings);
  const contact = useLibraryStore((s) => s.brandContact);

  const [sheet, setSheet] = useState<SheetMode>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Every control on this screen writes to SQLite. Called bare from an
   * `onPress` the promise would float, so a failed write used to disappear
   * entirely and the toggle would quietly snap back on the next launch.
   */
  const applySetting = useCallback((patch: Partial<ExportSettings>) => {
    setSaveError(null);
    runSafely('library', () => setExportSettings(patch), setSaveError);
  }, [setExportSettings]);

  const companyOptions = useMemo(
    () =>
      companies
        .filter((company) => company.productCount > 0)
        .map((company) => ({
          id: company.id,
          name: company.name,
          meta: `${pluralize(company.productCount, 'product')} · ${pluralize(
            company.formulaCount,
            'formula'
          )}`,
        })),
    [companies]
  );

  const formulaOptions = useMemo(
    () =>
      formulas
        .filter((formula) => formula.productCount > 0)
        .map((formula) => ({
          id: formula.id,
          name: formula.name,
          meta: `${pluralize(formula.productCount, 'product')} · ${pluralize(
            formula.companyCount,
            'company',
            'companies'
          )}`,
        })),
    [formulas]
  );

  const openPreview = (params: Record<string, string>) => {
    router.push({ pathname: '/export/preview', params });
  };

  const hasProducts = products.length > 0;

  const readiness = useMemo(
    () => assessExportReadiness(products, settings, contact),
    [products, settings, contact]
  );

  const openReadinessHref = useCallback(
    (href: ReadinessHref) => {
      if (href.kind === 'settings') {
        router.push('/(tabs)/settings');
        return;
      }
      if (href.kind === 'product') {
        router.push(`/product/${href.productId}`);
        return;
      }
      router.push('/(tabs)');
    },
    [router]
  );

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
          kicker="Export"
          title="Generate PDF"
          subtitle={
            hasProducts
              ? 'Pick what the catalogue covers. Every PDF opens with a label page describing the products inside.'
              : undefined
          }
        />

        {!hasProducts ? (
          <EmptyState
            emoji="📄"
            title="Nothing to export yet"
            description="Add at least one product — a company, a formula and a pack shot — then come back to build a catalogue."
            actionLabel="Add product"
            onAction={() => router.push('/product/new')}
          />
        ) : (
          <>
            <Section title="What goes in the catalogue">
              <ScopeCard
                icon="⬢"
                title="One company"
                subtitle={
                  companyOptions.length
                    ? `Its full range · ${pluralize(companyOptions.length, 'company', 'companies')} available`
                    : 'No company has products yet'
                }
                disabled={!companyOptions.length}
                onPress={() => setSheet('company')}
              />
              <ScopeCard
                icon="◆"
                title="One formula"
                subtitle={
                  formulaOptions.length
                    ? `Every brand of it · ${pluralize(formulaOptions.length, 'formula')} available`
                    : 'No formula has products yet'
                }
                disabled={!formulaOptions.length}
                onPress={() => setSheet('formula')}
              />
              <ScopeCard
                icon="▦"
                title="All companies"
                subtitle={`One labelled section per company · ${pluralize(
                  products.length,
                  'product'
                )}`}
                onPress={() => openPreview({ kind: 'all-companies' })}
              />
              <ScopeCard
                icon="▤"
                title="All formulas"
                subtitle={`One labelled section per formula · ${pluralize(
                  products.length,
                  'product'
                )}`}
                onPress={() => openPreview({ kind: 'all-formulas' })}
              />
            </Section>

            <Section title="Images per page">
              <View style={styles.chipRow}>
                {LAYOUTS.map((layout) => (
                  <Chip
                    key={layout.id}
                    label={layout.name}
                    selected={settings.layoutId === layout.id}
                    onPress={() => applySetting({ layoutId: layout.id as LayoutId })}
                  />
                ))}
              </View>
              <ThemedText themeColor="textSecondary" style={styles.hint}>
                {layoutMeta(settings.layoutId).description} Each product keeps a crop for this
                grid — export uses the matching framing.
              </ThemedText>
              <FramingStatus products={products} layoutId={settings.layoutId} />
              <View style={{ height: Spacing.two }} />
              <ToggleRow
                label="Only include framed products"
                hint="Skip products that have no crop for this layout (full-frame fallbacks are left out)."
                value={settings.framedOnly}
                onChange={(framedOnly) => applySetting({ framedOnly })}
              />
            </Section>

            <Section title="Before you export">
              {readiness.issues.length === 0 ? (
                <ThemedText themeColor="textSecondary" style={styles.hint}>
                  Ready — {pluralize(readiness.total, 'product')}, {readiness.framed} framed for{' '}
                  {layoutMeta(settings.layoutId).name}.
                </ThemedText>
              ) : (
                <View style={styles.readinessList}>
                  <ThemedText themeColor="textSecondary" style={styles.readinessLead}>
                    Tap an item to fix it.
                  </ThemedText>
                  {readiness.issues.map((issue) => (
                    <ReadinessRow
                      key={issue.id}
                      issue={issue}
                      onPress={
                        issue.href ? () => openReadinessHref(issue.href!) : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </Section>

            <Section title="Paper">
              <View style={styles.chipRow}>
                {(['A4', 'Letter'] as PageSize[]).map((size) => (
                  <Chip
                    key={size}
                    label={size}
                    selected={settings.pageSize === size}
                    onPress={() => applySetting({ pageSize: size })}
                  />
                ))}
              </View>
            </Section>

            <Section title="Document pages">
              <ToggleRow
                label="Brand cover page"
                hint="Logo, title and what the catalogue covers."
                value={settings.includeCover}
                onChange={(includeCover) => applySetting({ includeCover })}
              />
              <Divider />
              <ToggleRow
                label="Contents page"
                hint="Lists every section. Skipped for single-section catalogues."
                value={settings.includeContents}
                onChange={(includeContents) => applySetting({ includeContents })}
              />
              <Divider />
              <ToggleRow
                label="Section label pages"
                hint="Introduces each company or formula before its images."
                value={settings.includeSectionLabels}
                onChange={(includeSectionLabels) => applySetting({ includeSectionLabels })}
              />
              <Divider />
              <ToggleRow
                label="Contact box"
                hint={
                  hasContactDetails(contact)
                    ? 'Your name, address, and CEO / office WhatsApp numbers at the foot of every image page.'
                    : 'Add your details in Settings to switch this on.'
                }
                value={settings.includeContactBox && hasContactDetails(contact)}
                disabled={!hasContactDetails(contact)}
                onChange={(includeContactBox) => applySetting({ includeContactBox })}
              />
            </Section>

            {saveError ? (
              <ThemedText style={[styles.saveError, { color: theme.danger }]}>
                {saveError}
              </ThemedText>
            ) : null}
          </>
        )}
      </ScrollView>

      <PickerSheet
        visible={sheet === 'company'}
        onClose={() => setSheet(null)}
        title="Which company?"
        subtitle="The PDF will hold that company's full range."
        options={companyOptions}
        onSelect={(id) => openPreview({ kind: 'company', id })}
        noun="company"
        nounPlural="companies"
        emptyHint="No company has products yet."
      />

      <PickerSheet
        visible={sheet === 'formula'}
        onClose={() => setSheet(null)}
        title="Which formula?"
        subtitle="The PDF will hold every company's version of it."
        options={formulaOptions}
        onSelect={(id) => openPreview({ kind: 'formula', id })}
        noun="formula"
        emptyHint="No formula has products yet."
      />
    </SafeAreaView>
  );
}

function FramingStatus({
  products,
  layoutId,
}: {
  products: ProductWithRefs[];
  layoutId: LayoutId | string;
}) {
  if (!products.length) return null;
  const framed = products.filter((p) => cropForLayout(p, layoutId) != null).length;
  const missing = products.length - framed;
  const name = layoutMeta(layoutId).name;
  return (
    <ThemedText themeColor="textSecondary" style={styles.hint}>
      {missing === 0
        ? `All ${products.length} products have a ${name} crop.`
        : `${framed} framed for ${name} · ${missing} will use full frame until cropped.`}
    </ThemedText>
  );
}

function ReadinessRow({
  issue,
  onPress,
}: {
  issue: ReadinessIssue;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const warn = issue.severity === 'warn';
  const body = (
    <ThemedText
      style={[styles.readinessItem, warn ? { color: theme.danger } : undefined]}
      themeColor={warn ? undefined : 'textSecondary'}>
      {warn ? '⚠ ' : '· '}
      {issue.message}
      {onPress ? (
        <ThemedText style={[styles.readinessLink, { color: theme.primary }]}>
          {' '}
          Fix →
        </ThemedText>
      ) : null}
    </ThemedText>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Fix: ${issue.message}`}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
      {body}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText themeColor="textSecondary" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          Elevation.card,
        ]}>
        {children}
      </View>
    </View>
  );
}

function ScopeCard({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scope,
        {
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      <View style={[styles.scopeIcon, { backgroundColor: theme.primaryMuted }]}>
        <ThemedText style={[styles.scopeIconText, { color: theme.primary }]}>{icon}</ThemedText>
      </View>
      <View style={styles.scopeText}>
        <ThemedText style={styles.scopeTitle}>{title}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.scopeSubtitle}>
          {subtitle}
        </ThemedText>
      </View>
      <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>›</ThemedText>
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.toggle, disabled && styles.toggleDisabled]}>
      <View style={styles.toggleText}>
        <ThemedText style={styles.toggleLabel}>{label}</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.toggleHint}>
          {hint}
        </ThemedText>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: theme.primary, false: theme.border }}
        thumbColor={theme.white}
      />
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    width: '100%',
    alignSelf: 'center',
    gap: Screen.sectionGap,
  },
  readinessList: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  readinessLead: {
    fontSize: 12,
    marginBottom: 2,
  },
  readinessItem: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  readinessLink: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  sectionBody: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
  },
  scope: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radii.md,
  },
  scopeIcon: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  scopeText: {
    flex: 1,
    gap: 2,
  },
  scopeTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  scopeSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '300',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    padding: Spacing.one,
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  saveError: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
    paddingHorizontal: Spacing.one,
  },
  toggleDisabled: {
    opacity: 0.5,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleHint: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.two,
  },
});
