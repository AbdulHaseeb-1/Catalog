import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  icon: string;
  onPress: () => void;
  size?: number;
  variant?: 'ghost' | 'filled' | 'tonal';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  disabled?: boolean;
};

export function IconButton({
  icon,
  onPress,
  size = 40,
  variant = 'ghost',
  style,
  accessibilityLabel,
  disabled,
}: Props) {
  const theme = useTheme();
  const bg =
    variant === 'filled'
      ? theme.primary
      : variant === 'tonal'
        ? theme.primaryMuted
        : 'transparent';
  const color = variant === 'filled' ? theme.fabIcon : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: Radii.pill,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text style={{ fontSize: size * 0.42, color, fontWeight: '600' }}>{icon}</Text>
    </Pressable>
  );
}
