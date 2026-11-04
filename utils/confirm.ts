import { Alert } from 'react-native';

/** Standard destructive confirmation dialog (Cancel + destructive action). */
export function confirmDestructive(
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void | Promise<void>
): void {
    Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
            text: confirmLabel,
            style: 'destructive',
            onPress: () => {
                void onConfirm();
            },
        },
    ]);
}
