import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gutter } from './theme';

export function Page({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.page,
        { paddingTop: insets.top + gutter, paddingBottom: insets.bottom + gutter },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: gutter,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
});
