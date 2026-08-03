import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Screen, TabBar } from '@/constants/layout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useRecentErrors } from '@/hooks/use-recent-errors';
import { useTheme } from '@/hooks/use-theme';
import { clearErrors, reportError, toMessage } from '@/lib/errors';
import { pluralize } from '@/lib/text';
import { invalidateEncodedImages } from '@/services/pdf-service';
import {
  formatBytes,
  inspectStorage,
  sweepStorage,
  type StorageReport,
} from '@/services/storage-service';
import { useLibraryStore } from '@/stores/library-store';
import { hasContactDetails, layoutMeta } from '@/types/models';

export default function SettingsScreen() {
  const theme = useTheme();
  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const products = useLibraryStore((s) => s.products);
  const settings = useLibraryStore((s) => s.exportSettings);
  const contact = useLibraryStore((s) => s.brandContact);
  const setBrandContact = useLibraryStore((s) => s.setBrandContact);

  const errors = useRecentErrors();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(contact);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);

  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  const filled = hasContactDetails(contact);

  const readStorage = useCallback(async () => {
    try {
      setStorage(await inspectStorage());
    } catch (e) {
      reportError('library', e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const report = await inspectStorage();
        if (!cancelled) setStorage(report);
      } catch (e) {
        reportError('library', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [products.length]);

  const runSweep = async () => {
    setStorageNote(null);
    setBusy('Freeing space…');
    try {
      const result = await sweepStorage();
      invalidateEncodedImages();
      setStorageNote(
        result.freedBytes > 0
          ? `Freed ${formatBytes(result.freedBytes)} · ${result.orphans} unused file(s), ${result.purged} binned product(s) removed.`
          : 'Nothing to reclaim — storage is already tidy.'
      );
    } catch (e) {
      reportError('library', e);
      Alert.alert('Could not free space', toMessage(e));
    } finally {
      setBusy(null);
      void readStorage();
    }
  };

  const openContact = () => {
    setDraft({
      name: contact.name,
      address: contact.address,
      mapsUrl: contact.mapsUrl ?? '',
      ceoPhone: contact.ceoPhone,
      officePhone: contact.officePhone,
    });
    setError(null);
    setSheetOpen(true);
  };

  const saveContact = async () => {
    setSaving(true);
    setError(null);
    try {
      await setBrandContact({
        name: draft.name.trim(),
        address: draft.address.trim(),
        mapsUrl: draft.mapsUrl.trim(),
        ceoPhone: draft.ceoPhone.trim(),
        officePhone: draft.officePhone.trim(),
      });
      setSheetOpen(false);
    } catch (e) {
      setError(toMessage(e, 'Could not save your contact details.'));
    } finally {
      setSaving(false);
    }
  };

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
          <Row
            icon="💾"
            label="Storage"
            value={storage ? formatBytes(storage.totalBytes) : 'On device'}
          />
        </Card>

        <Card>
          <ThemedText style={styles.cardTitle}>Storage</ThemedText>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={theme.primary} />
              <ThemedText themeColor="textSecondary" style={styles.note}>
                {busy}
              </ThemedText>
            </View>
          ) : null}
          {storageNote ? (
            <ThemedText themeColor="textSecondary" style={styles.note}>
              {storageNote}
            </ThemedText>
          ) : null}
          {storage ? (
            <View style={styles.steps}>
              <Row icon="🖼" label="Product photos" value={formatBytes(storage.imageBytes)} compact />
              <Row
                icon="🧹"
                label={`Unused files${storage.orphanCount ? ` (${storage.orphanCount})` : ''}`}
                value={formatBytes(storage.orphanBytes)}
                compact
              />
              <Row
                icon="📄"
                label="Saved PDFs (Documents/Catalogs)"
                value={formatBytes(storage.exportBytes)}
                compact
              />
              <Row icon="🗑" label="In the bin" value={String(storage.binnedCount)} compact />
            </View>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.note}>
              Checking what is on disk…
            </ThemedText>
          )}
          <ThemedText themeColor="textSecondary" style={styles.note}>
            Reclaims leftover image files and old temp PDF cache. Saved catalogues in
            Documents/Catalogs are kept. Deleted products stay recoverable for a day.
          </ThemedText>
          <Button
            title="Free up space"
            variant="ghost"
            disabled={!!busy || !storage}
            onPress={runSweep}
          />
        </Card>

        <Card>
          <View style={styles.contactHead}>
            <View style={styles.contactHeadText}>
              <ThemedText style={styles.cardTitle}>Your contact details</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.note}>
                Printed at the foot of every catalogue page. Address opens Google Maps; CEO and
                office numbers open WhatsApp.
              </ThemedText>
            </View>
          </View>

          {filled ? (
            <>
              <View style={styles.contactLines}>
                {contact.name.trim() ? (
                  <ThemedText style={styles.contactName}>{contact.name}</ThemedText>
                ) : null}
                {contact.address.trim() ? (
                  <ThemedText themeColor="textSecondary" style={styles.contactLine}>
                    {contact.address}
                    {contact.mapsUrl?.trim() ? ' · Maps link set' : ''}
                  </ThemedText>
                ) : null}
                {contact.ceoPhone.trim() ? (
                  <ThemedText themeColor="textSecondary" style={styles.contactLine}>
                    CEO · {contact.ceoPhone}
                  </ThemedText>
                ) : null}
                {contact.officePhone.trim() ? (
                  <ThemedText themeColor="textSecondary" style={styles.contactLine}>
                    Office · {contact.officePhone}
                  </ThemedText>
                ) : null}
              </View>
              <View
                style={[
                  styles.footerPreview,
                  { borderColor: theme.border, backgroundColor: '#FFFFFF' },
                ]}>
                <ThemedText style={styles.footerPreviewLabel}>PDF footer preview</ThemedText>
                <View style={styles.footerPreviewRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.footerPreviewName} numberOfLines={1}>
                      {contact.name.trim() || 'Your name'}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.footerPreviewTip}>
                      Tap address for Maps · number for WhatsApp / Call
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    {contact.address.trim() ? (
                      <ThemedText
                        style={[styles.footerPreviewAddr, { color: theme.primary }]}
                        numberOfLines={2}>
                        {contact.address.trim()}
                      </ThemedText>
                    ) : null}
                    {contact.ceoPhone.trim() ? (
                      <ThemedText style={styles.footerPreviewPhone} numberOfLines={1}>
                        CEO · {contact.ceoPhone}
                      </ThemedText>
                    ) : null}
                    {contact.officePhone.trim() ? (
                      <ThemedText style={styles.footerPreviewPhone} numberOfLines={1}>
                        Office · {contact.officePhone}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              </View>
            </>
          ) : (
            <ThemedText themeColor="textSecondary" style={styles.contactEmpty}>
              Not set — the contact box is left off until you add them.
            </ThemedText>
          )}

          <Button
            title={filled ? 'Edit details' : 'Add details'}
            variant="secondary"
            onPress={openContact}
          />
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
          <ThemedText style={styles.cardTitle}>Diagnostics</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.note}>
            {errors.length
              ? `${pluralize(errors.length, 'problem')} recorded since the app started. Show this list if the app misbehaves.`
              : 'No problems recorded since the app started.'}
          </ThemedText>

          {errors.length ? (
            <>
              <View style={styles.errorList}>
                {errors.slice(0, showAllErrors ? errors.length : 3).map((entry, index) => (
                  <View
                    key={`${entry.at}-${index}`}
                    style={[styles.errorRow, { borderColor: theme.border }]}>
                    <ThemedText style={[styles.errorScope, { color: theme.danger }]}>
                      {entry.scope}
                      {entry.fatal ? ' · fatal' : ''}
                    </ThemedText>
                    <ThemedText themeColor="textSecondary" style={styles.errorMessage}>
                      {entry.message}
                    </ThemedText>
                  </View>
                ))}
              </View>
              <View style={styles.diagActions}>
                {errors.length > 3 ? (
                  <Button
                    title={showAllErrors ? 'Show fewer' : `Show all ${errors.length}`}
                    variant="ghost"
                    onPress={() => setShowAllErrors((v) => !v)}
                    style={{ flex: 1 }}
                  />
                ) : null}
                <Button
                  title="Clear"
                  variant="secondary"
                  onPress={() => {
                    clearErrors();
                    setShowAllErrors(false);
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : null}
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

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Your contact details"
        subtitle="Printed on every catalogue page. Address opens Maps; numbers open WhatsApp.">
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder="Eagle Pharma Distributor"
          autoCapitalize="words"
        />
        <TextField
          label="Address"
          value={draft.address}
          onChangeText={(address) => setDraft((d) => ({ ...d, address }))}
          placeholder="Shop 4, Medicine Market, Lahore"
          multiline
          numberOfLines={2}
          style={styles.multiline}
          hint="Shown as text on the PDF. Pair with a Maps link below to make it tappable."
        />
        <TextField
          label="Google Maps link"
          value={draft.mapsUrl}
          onChangeText={(mapsUrl) => setDraft((d) => ({ ...d, mapsUrl }))}
          placeholder="https://maps.google.com/?q=…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          hint="Paste a Google Maps share link. Only the address text is shown — tap opens this URL."
        />
        <TextField
          label="CEO phone"
          value={draft.ceoPhone}
          onChangeText={(ceoPhone) => setDraft((d) => ({ ...d, ceoPhone }))}
          placeholder="923001234567"
          keyboardType="phone-pad"
          hint="Include country code for WhatsApp (e.g. 92…)."
        />
        <TextField
          label="Office phone"
          value={draft.officePhone}
          onChangeText={(officePhone) => setDraft((d) => ({ ...d, officePhone }))}
          placeholder="924212345678"
          keyboardType="phone-pad"
          hint="Second line on the PDF footer — also opens WhatsApp."
        />
        {error ? (
          <ThemedText style={[styles.sheetError, { color: theme.danger }]}>{error}</ThemedText>
        ) : null}
        <View style={styles.sheetActions}>
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => setSheetOpen(false)}
            style={{ flex: 1 }}
          />
          <Button
            title="Save"
            variant="primary"
            loading={saving}
            onPress={saveContact}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function Card({ children }: { children: ReactNode }) {
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
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
  contactHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  contactHeadText: { flex: 1 },
  contactLines: {
    marginTop: Spacing.three,
    gap: 3,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '700',
  },
  contactLine: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  contactEmpty: {
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: Spacing.three,
  },
  footerPreview: {
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    padding: Spacing.two,
    gap: 6,
  },
  footerPreviewLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    opacity: 0.55,
  },
  footerPreviewRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  footerPreviewName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#101820',
  },
  footerPreviewTip: {
    fontSize: 9,
    marginTop: 2,
  },
  footerPreviewAddr: {
    fontSize: 10,
    textAlign: 'right',
    marginBottom: 2,
  },
  footerPreviewPhone: {
    fontSize: 11,
    fontWeight: '600',
    color: '#101820',
    textAlign: 'right',
  },
  multiline: {
    minHeight: 72,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
  errorList: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  errorRow: {
    borderRadius: Radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 2,
  },
  errorScope: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  errorMessage: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  diagActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  sheetError: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: -8,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
  },
});
