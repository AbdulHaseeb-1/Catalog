import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type { PickerOption };

type Props = {
  label: string;
  placeholder: string;
  options: PickerOption[];
  value?: string;
  onChange: (id: string) => void;
  /** Enables inline creation from the picker, so the form never dead-ends. */
  onCreate?: (name: string) => Promise<{ id: string }>;
  sheetTitle: string;
  sheetSubtitle?: string;
  /** Lower-case noun, e.g. "company". */
  noun: string;
  emptyHint: string;
};

/** Form field that selects one entry from a reference list. */
export function ReferencePicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  onCreate,
  sheetTitle,
  sheetSubtitle,
  noun,
  emptyHint,
}: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <View style={styles.wrap}>
      <ThemedText style={[styles.label, { color: theme.textSecondary }]}>{label}</ThemedText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${selected ? selected.name : placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.bubble,
            borderColor: theme.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}>
        <View style={styles.fieldText}>
          <ThemedText
            style={[styles.value, { color: selected ? theme.text : theme.textSecondary }]}
            numberOfLines={1}>
            {selected ? selected.name : placeholder}
          </ThemedText>
          {selected?.meta ? (
            <ThemedText themeColor="textSecondary" style={styles.valueMeta} numberOfLines={1}>
              {selected.meta}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>⌄</ThemedText>
      </Pressable>

      <PickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle}
        subtitle={sheetSubtitle}
        options={options}
        value={value}
        onSelect={onChange}
        onCreate={onCreate}
        noun={noun}
        emptyHint={emptyHint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginLeft: 4,
  },
  field: {
    minHeight: 52,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  fieldText: { flex: 1, gap: 1 },
  value: {
    fontSize: 16,
    fontWeight: '500',
  },
  valueMeta: {
    fontSize: 12,
  },
  chevron: {
    fontSize: 18,
    marginTop: -6,
  },
});
