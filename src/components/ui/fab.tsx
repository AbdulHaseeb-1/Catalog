import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Elevation, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  icon: string;
  label?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  variant?: 'primary' | 'secondary' | 'danger';
  accessibilityLabel?: string;
};

export function Fab({
  icon,
  label,
  onPress,
  style,
  variant = 'primary',
  accessibilityLabel,
}: Props) {
  const theme = useTheme();
  const bg =
    variant === 'danger' ? theme.danger : variant === 'secondary' ? theme.surfaceElevated : theme.fab;
  const color = variant === 'secondary' ? theme.text : theme.fabIcon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? icon}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        Elevation.fab,
        {
          backgroundColor: bg,
          opacity: pressed ? 0.9 : 1,
          paddingHorizontal: label ? 20 : 0,
          width: label ? undefined : 56,
        },
        style,
      ]}>
      <Text style={[styles.icon, { color }]}>{icon}</Text>
      {label ? <Text style={[styles.label, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    height: 56,
    minWidth: 56,
    borderRadius: Radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 22,
    fontWeight: '600',
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
});
