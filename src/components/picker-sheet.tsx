import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui/sheet';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { matchesQuery, normalizeKey, tidyName } from '@/lib/text';

export type PickerOption = {
  id: string;
  name: string;
  meta?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: PickerOption[];
  /** Currently selected id, ticked in the list. */
  value?: string;
  onSelect: (id: string) => void;
  /** Enables the inline "Add …" row when the search has no exact match. */
  onCreate?: (name: string) => Promise<{ id: string }>;
  /** Lower-case noun, e.g. "company" — used in search and create copy. */
  noun: string;
  /** Plural of `noun`; defaults to a naive "+s", which "company" needs. */
  nounPlural?: string;
  emptyHint: string;
};

/** Searchable single-select list, with optional inline creation. */
export function PickerSheet({
  visible,
  onClose,
  title,
  subtitle,
  options,
  value,
  onSelect,
  onCreate,
  noun,
  nounPlural = `${noun}s`,
  emptyHint,
}: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => options.filter((option) => matchesQuery(option.name, query)),
    [options, query]
  );

  const typed = tidyName(query);
  const hasExactMatch = options.some((option) => normalizeKey(option.name) === normalizeKey(typed));
  const canCreate = !!onCreate && typed.length > 0 && !hasExactMatch;

  const close = () => {
    setQuery('');
    setError(null);
    onClose();
  };

  const select = (id: string) => {
    onSelect(id);
    close();
  };

  const create = async () => {
    if (!onCreate || !typed) return;
    setCreating(true);
    setError(null);
    try {
      const created = await onCreate(typed);
      select(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add that ${noun}.`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title={title} subtitle={subtitle} tall>
      <TextInput
        value={query}
        onChangeText={(next) => {
          setQuery(next);
          setError(null);
        }}
        placeholder={`Search ${nounPlural}`}
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        style={[
          styles.search,
          { color: theme.text, backgroundColor: theme.bubble, borderColor: theme.border },
        ]}
      />

      {error ? <ThemedText style={[styles.error, { color: theme.danger }]}>{error}</ThemedText> : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            {typed ? `No ${noun} matches “${typed}”.` : emptyHint}
          </ThemedText>
        }
        renderItem={({ item }) => {
          const isSelected = item.id === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => select(item.id)}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <View style={styles.optionText}>
                <ThemedText style={styles.optionName} numberOfLines={1}>
                  {item.name}
                </ThemedText>
                {item.meta ? (
                  <ThemedText themeColor="textSecondary" style={styles.optionMeta} numberOfLines={1}>
                    {item.meta}
                  </ThemedText>
                ) : null}
              </View>
              {isSelected ? (
                <ThemedText style={[styles.check, { color: theme.primary }]}>✓</ThemedText>
              ) : null}
            </Pressable>
          );
        }}
      />

      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          disabled={creating}
          onPress={create}
          style={({ pressed }) => [
            styles.create,
            {
              backgroundColor: theme.primaryMuted,
              borderColor: theme.primary,
              opacity: pressed || creating ? 0.85 : 1,
            },
          ]}>
          {creating ? (
            <ActivityIndicator color={theme.primary} />
          ) : (
            <ThemedText style={[styles.createText, { color: theme.primary }]} numberOfLines={1}>
              ＋ Add {noun} “{typed}”
            </ThemedText>
          )}
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 46,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  error: {
    fontSize: 13,
    marginTop: -6,
  },
  // flex:1 (not auto height) so a long list shrinks inside the sheet instead of
  // pushing the create row past its bottom edge.
  list: { flex: 1 },
  listContent: { paddingBottom: Spacing.two },
  separator: { height: StyleSheet.hairlineWidth },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: Radii.sm,
  },
  optionText: { flex: 1, gap: 2 },
  optionName: {
    fontSize: 16,
    fontWeight: '500',
  },
  optionMeta: {
    fontSize: 12,
  },
  check: {
    fontSize: 16,
    fontWeight: '800',
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: Spacing.four,
    textAlign: 'center',
  },
  create: {
    minHeight: 50,
    borderRadius: Radii.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  createText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
