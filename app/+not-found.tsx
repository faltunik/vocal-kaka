import { Colors } from '@/constants/Colors';
import { Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>This screen does not exist.</Text>

      <Link href="/" style={styles.link}>
        <Text style={styles.linkText}>Go to home screen!</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    backgroundColor: Colors.light.background,
  },
  title: {
    ...Typography.heading,
    color: Colors.light.text,
    textAlign: 'center',
  },
  link: {
    marginTop: Spacing.lg,
    minHeight: TouchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  linkText: {
    ...Typography.bodyStrong,
    color: Colors.light.tint,
  },
});
