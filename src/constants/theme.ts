/**
 * Design tokens — Gemini / ChatGPT inspired soft surfaces + Material floating chrome.
 */

import '@/global.css';

import { Platform } from 'react-native';

import { Screen, TabBar } from '@/constants/layout';

export const Colors = {
  light: {
    text: '#1F1F1F',
    background: '#F7F7F8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8F0FE',
    textSecondary: '#5F6368',
    primary: '#1A73E8',
    primaryMuted: '#E8F0FE',
    accent: '#1A73E8',
    accentSoft: '#D2E3FC',
    danger: '#D93025',
    success: '#188038',
    border: '#E8EAED',
    cardShadow: 'rgba(60, 64, 67, 0.12)',
    white: '#FFFFFF',
    fab: '#1A73E8',
    fabIcon: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    bubble: '#F0F4F9',
    tabBar: 'rgba(255,255,255,0.94)',
  },
  dark: {
    text: '#E8EAED',
    background: '#131314',
    backgroundElement: '#1E1F20',
    backgroundSelected: '#2A2B2D',
    textSecondary: '#9AA0A6',
    primary: '#8AB4F8',
    primaryMuted: '#1A2B45',
    accent: '#8AB4F8',
    accentSoft: '#1A2B45',
    danger: '#F28B82',
    success: '#81C995',
    border: '#3C4043',
    cardShadow: 'rgba(0,0,0,0.45)',
    white: '#FFFFFF',
    fab: '#8AB4F8',
    fabIcon: '#202124',
    surfaceElevated: '#1E1F20',
    bubble: '#2A2B2D',
    tabBar: 'rgba(30,31,32,0.94)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const Elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  fab: {
    shadowColor: '#1A73E8',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  bar: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
} as const;

/** @deprecated prefer TabBar.contentInset from layout.ts */
export const BottomTabInset = TabBar.contentInset;
export const MaxContentWidth = Screen.maxWidth;
