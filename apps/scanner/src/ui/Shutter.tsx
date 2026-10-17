import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { colors } from './theme';

interface Props {
  /** 0–1 while capturing, null when idle. */
  progress: number | null;
  busy: boolean;
  failed: boolean;
  onPress: () => void;
}

const SIZE = 76;

export function Shutter({ progress, busy, failed, onPress }: Props) {
  const capturing = progress !== null;
  return (
    <Pressable
      onPress={onPress}
      disabled={capturing || busy}
      style={[styles.ring, failed && styles.failed]}
      hitSlop={12}
    >
      {busy ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <View style={[styles.core, capturing && { transform: [{ scale: progress }] }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 3,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: { borderColor: colors.error },
  core: {
    width: SIZE - 16,
    height: SIZE - 16,
    borderRadius: (SIZE - 16) / 2,
    backgroundColor: colors.ink,
  },
});
