import { Platform } from 'react-native';

/**
 * Shared layout metrics so screens, FABs, and the floating tab bar align.
 */
export const Screen = {
  /** Horizontal padding for page content */
  padX: 20,
  /** Top padding under safe area */
  padTop: 12,
  /** Vertical gap between major sections */
  sectionGap: 20,
  /** Gap between cards / list items */
  listGap: 14,
  /** Max content width (tablet/web) */
  maxWidth: 840,
} as const;

/** Floating tab bar geometry (must match tabs/_layout.tsx) */
export const TabBar = {
  height: 64,
  bottom: Platform.select({ ios: 20, default: 14 }) ?? 14,
  side: 16,
  /** Space content needs so it clears the floating bar */
  contentInset: Platform.select({ ios: 20 + 64 + 16, default: 14 + 64 + 16 }) ?? 94,
} as const;

/** Floating action buttons */
export const FabLayout = {
  size: 56,
  gap: 10,
  right: 20,
  /** Bottom offset above tab bar on tab screens */
  aboveTabBar: TabBar.contentInset + 8,
  /** Bottom offset on stack screens (no tab bar) */
  stackBottom: 24,
  /** Extra list padding so last rows clear FABs */
  listClearance: 56 + 24 + 16,
} as const;
