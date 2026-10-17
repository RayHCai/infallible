import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Page } from '../src/ui/Page';
import { colors } from '../src/ui/theme';

const SHOW_MS = 1500;

export default function SentScreen() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.dismissTo('/'), SHOW_MS);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <Page>
      <Text style={styles.check}>✓</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  check: { color: colors.ink, fontSize: 72, fontWeight: '200' },
});
