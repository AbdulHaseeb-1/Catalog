import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LibraryCard } from '@/components/library-card';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { FabLayout, Screen, TabBar } from '@/constants/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { pluralize } from '@/lib/text';
import { useLibraryStore } from '@/stores/library-store';

type Kind = 'company' | 'formula';

type Entry = {
  id: string;
  name: string;
  meta: string;
  productCount: number;
  address?: string | null;
  phone?: string | null;
};

const COPY = {
  company: {
    kicker: 'Reference list',
    title: 'Companies',
    noun: 'company',
    icon: '⬢',
    placeholder: 'e.g. Eagle Pharma',
    addTitle: 'Add company',
    addSubtitle: 'Companies you build catalogues for.',
    editTitle: 'Edit company',
    emptyTitle: 'No companies yet',
    emptyDescription:
      'Add the companies you carry. Each product you add is tied to one of them, and every company can be exported as its own catalogue.',
    lead: 'Tap a company to see its products and export its catalogue.',
  },
  formula: {
    kicker: 'Reference list',
    title: 'Formulas',
    noun: 'formula',
    icon: '◆',
    placeholder: 'e.g. Paracetamol 500mg',
    addTitle: 'Add formula',
    addSubtitle: 'Compositions shared across companies.',
    editTitle: 'Rename formula',
    emptyTitle: 'No formulas yet',
    emptyDescription:
      'Add the compositions you work with. A formula is shared across companies, so you can export every brand of one formula in a single PDF.',
    lead: 'Tap a formula to see every company that markets it.',
  },
} as const;

/**
 * Companies and formulas behave identically — one list of named references,
 * each of which owns products and can be exported. This screen backs both tabs.
 */
export function ReferenceListScreen({ kind }: { kind: Kind }) {
  const theme = useTheme();
  const router = useRouter();
  const copy = COPY[kind];

  const companies = useLibraryStore((s) => s.companies);
  const formulas = useLibraryStore((s) => s.formulas);
  const addCompany = useLibraryStore((s) => s.addCompany);
  const addFormula = useLibraryStore((s) => s.addFormula);
  const editCompany = useLibraryStore((s) => s.editCompany);
  const renameFormula = useLibraryStore((s) => s.renameFormula);
  const removeCompany = useLibraryStore((s) => s.removeCompany);
  const removeFormula = useLibraryStore((s) => s.removeFormula);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Companies carry contact details; formulas are just a name.
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries: Entry[] = useMemo(() => {
    if (kind === 'company') {
      return companies.map((company) => ({
        id: company.id,
        name: company.name,
        productCount: company.productCount,
        address: company.address,
        phone: company.phone,
        meta: company.productCount
          ? `${pluralize(company.productCount, 'product')} · ${pluralize(
              company.formulaCount,
              'formula'
            )}`
          : 'No products yet',
      }));
    }
    return formulas.map((formula) => ({
      id: formula.id,
      name: formula.name,
      productCount: formula.productCount,
      meta: formula.productCount
        ? `${pluralize(formula.productCount, 'product')} · ${pluralize(
            formula.companyCount,
            'company',
            'companies'
          )}`
        : 'No products yet',
    }));
  }, [kind, companies, formulas]);

  const covers = useMemo(() => {
    const map = new Map<string, string | null>();
    const source = kind === 'company' ? companies : formulas;
    for (const item of source) map.set(item.id, item.coverUri);
    return map;
  }, [kind, companies, formulas]);

  const openAdd = () => {
    setEditingId(null);
    setName('');
    setAddress('');
    setPhone('');
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setName(entry.name);
    setAddress(entry.address ?? '');
    setPhone(entry.phone ?? '');
    setError(null);
    setSheetOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        if (kind === 'company') await editCompany(editingId, { name, address, phone });
        else await renameFormula(editingId, name);
      } else if (kind === 'company') {
        await addCompany({ name, address, phone });
      } else {
        await addFormula(name);
      }
      setSheetOpen(false);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not save that ${copy.noun}.`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: Entry) => {
    const detail = entry.productCount
      ? `This also deletes ${pluralize(entry.productCount, 'product')} and their images.`
      : 'This cannot be undone.';
    const ok = await confirmAction(`Delete “${entry.name}”?`, detail);
    if (!ok) return;
    try {
      if (kind === 'company') await removeCompany(entry.id);
      else await removeFormula(entry.id);
    } catch (e) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const openActions = (entry: Entry) => {
    Alert.alert(entry.name, entry.meta, [
      { text: kind === 'company' ? 'Edit details' : 'Rename', onPress: () => openEdit(entry) },
      { text: 'Delete', style: 'destructive', onPress: () => remove(entry) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const listBottomPad = TabBar.contentInset + FabLayout.listClearance;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.container}>
        <View style={{ paddingHorizontal: Screen.padX }}>
          <ScreenHeader
            kicker={copy.kicker}
            title={copy.title}
            subtitle={entries.length ? copy.lead : undefined}
          />
        </View>

        {entries.length === 0 ? (
          <View style={{ paddingHorizontal: Screen.padX, flex: 1, justifyContent: 'center' }}>
            <EmptyState
              emoji={copy.icon}
              title={copy.emptyTitle}
              description={copy.emptyDescription}
              actionLabel={copy.addTitle}
              onAction={openAdd}
            />
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingHorizontal: Screen.padX,
              paddingBottom: listBottomPad,
            }}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <LibraryCard
                title={item.name}
                meta={item.meta}
                coverUri={covers.get(item.id) ?? null}
                fallbackIcon={copy.icon}
                onPress={() =>
                  router.push(
                    kind === 'company'
                      ? `/library/company/${item.id}`
                      : `/library/formula/${item.id}`
                  )
                }
                onLongPress={() => openActions(item)}
              />
            )}
          />
        )}
      </View>

      <View
        style={[styles.fabSlot, { right: FabLayout.right, bottom: FabLayout.aboveTabBar }]}
        pointerEvents="box-none">
        <Fab
          icon="＋"
          label={copy.noun === 'company' ? 'Company' : 'Formula'}
          onPress={openAdd}
          accessibilityLabel={copy.addTitle}
        />
      </View>

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingId ? copy.editTitle : copy.addTitle}
        subtitle={editingId ? undefined : copy.addSubtitle}>
        <TextField
          label="Name"
          value={name}
          onChangeText={(next) => {
            setName(next);
            setError(null);
          }}
          placeholder={copy.placeholder}
          autoFocus
          autoCapitalize="words"
        />
        {kind === 'company' ? (
          <>
            <TextField
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Street, city"
              multiline
              numberOfLines={2}
              style={styles.multiline}
            />
            <TextField
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="0300 1234567"
              keyboardType="phone-pad"
              hint="Separate several numbers with a comma."
            />
          </>
        ) : null}
        {error ? (
          <ThemedText style={[styles.error, { color: theme.danger }]}>{error}</ThemedText>
        ) : null}
        <View style={styles.actions}>
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => setSheetOpen(false)}
            style={{ flex: 1 }}
          />
          <Button
            title={editingId ? 'Save' : 'Add'}
            variant="primary"
            loading={saving}
            disabled={!name.trim()}
            onPress={submit}
            style={{ flex: 1 }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: Screen.maxWidth,
    alignSelf: 'center',
  },
  fabSlot: {
    position: 'absolute',
  },
  error: {
    fontSize: 13,
    marginTop: -8,
  },
  multiline: {
    minHeight: 72,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
