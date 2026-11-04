import { ProductActionModal } from '@/components/scanner/ProductActionModal';
import { ScannerOverlay } from '@/components/scanner/ScannerOverlay';
import { Colors } from '@/constants/Colors';
import { Spacing, Radius, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { useStoreScope } from '@/hooks/useStoreScope';
import { BarcodeScannerService, ScanResolution } from '@/services/BarcodeScannerService';
import { useAuth } from '@/services/AuthContext';
import { container } from '@/services/Container';
import { useRecentActivity } from '@/services/RecentActivityContext';
import { formatCurrency, formatTransactionTitle } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ScannerScreen() {
    const router = useRouter();
    const isFocused = useIsFocused();
    const [permission, requestPermission] = useCameraPermissions();
    const insets = useSafeAreaInsets();
    const { user, isGuest } = useAuth();
    const { currentScope } = useStoreScope();
    const { addActivity, refresh } = useRecentActivity();

    // Product Scan State
    const [modalVisible, setModalVisible] = useState(false);
    const [scannedProduct, setScannedProduct] = useState<InventoryItem | null>(null);
    const [scannedBarcode, setScannedBarcode] = useState('');
    const [prefilledData, setPrefilledData] = useState<{ name: string; unit: string } | null>(null);
    const [scanMessage, setScanMessage] = useState<string | null>(null);

    const scanLockRef = useRef(false);
    const isMountedRef = useRef(true);
    const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const schedule = useCallback((task: () => void, delayMs: number) => {
        const timer = setTimeout(() => {
            timersRef.current.delete(timer);
            task();
        }, delayMs);
        timersRef.current.add(timer);
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        const timers = timersRef.current;
        return () => {
            isMountedRef.current = false;
            for (const timer of timers) {
                clearTimeout(timer);
            }
            timers.clear();
        };
    }, []);

    const scannerService = useMemo(
        () => new BarcodeScannerService({
            inventoryService: container.inventoryService,
            scope: currentScope,
            userId: user?.id ?? null,
            isGuest,
        }),
        [currentScope, user?.id, isGuest]
    );

    const handleClose = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    if (!permission) {
        return <View />;
    }

    if (!permission.granted) {
        return (
            <View style={[styles.container, styles.permissionContainer]}>
                <Ionicons name="camera-outline" size={64} color={Colors.light.icon} />
                <Text style={styles.permissionText}>
                    {permission.canAskAgain
                        ? 'We need your permission to show the camera'
                        : 'Camera access is disabled. Enable it in Settings to scan products.'}
                </Text>
                {permission.canAskAgain ? (
                    <TouchableOpacity onPress={requestPermission} style={styles.btn}>
                        <Text style={styles.btnText}>Grant Permission</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity
                        onPress={() => {
                            void Linking.openSettings().catch(() => {
                                Alert.alert('Settings unavailable', 'Open Settings and enable camera access manually.');
                            });
                        }}
                        style={styles.btn}
                    >
                        <Text style={styles.btnText}>Open Settings</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity onPress={handleClose} style={styles.permissionCloseButton}>
                    <Text style={styles.permissionCloseText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const applyResolution = (resolution: ScanResolution, barcode: string) => {
        setScannedProduct(resolution.product);
        setScannedBarcode(barcode);
        setPrefilledData(resolution.prefilled);

        if (resolution.message) {
            setScanMessage(resolution.message);
            schedule(() => {
                if (isMountedRef.current) setScanMessage(null);
                scanLockRef.current = false;
            }, 2000);
            return;
        }

        setModalVisible(true);
        setScanMessage(null);
    };

    const handleBarcodeScanned = async ({ data }: { data: string; type: string }) => {
        // Refs are synchronous guards: state updates are too slow to stop rapid re-scans
        if (scanLockRef.current) return;
        scanLockRef.current = true;

        try {
            const resolution = await scannerService.resolveBarcode(data);

            if (!isMountedRef.current) {
                scanLockRef.current = false;
                return;
            }

            applyResolution(resolution, data);
        } catch (error) {
            console.error('[Scanner] scan failed', error);
            if (!isMountedRef.current) return;
            setScanMessage('Scan failed. Please try again');
            schedule(() => {
                if (isMountedRef.current) setScanMessage(null);
                scanLockRef.current = false;
            }, 2000);
        }
    };

    const handleCloseModal = () => {
        setModalVisible(false);
        setScannedProduct(null);
        setScannedBarcode('');
        setPrefilledData(null);
        // Delay re-enabling scan to prevent double scan
        schedule(() => {
            scanLockRef.current = false;
        }, 1500);
    };

    const handleAddStock = async (qty: number, prod: InventoryItem): Promise<boolean> => {
        if (!user?.id) {
            if (isGuest) {
                Alert.alert('Guest mode', 'Stock changes are not saved in guest mode.');
            }
            return false;
        }

        const applied = await scannerService.addStock(prod, qty);
        if (!applied) {
            Alert.alert('Stock not added', 'The entry could not be saved. Please try again.');
            return false;
        }

        addActivity({
            intent: 'PURCHASE',
            item: prod.name,
            quantity: qty,
            unit: prod.base_unit || prod.unit || 'pcs',
            timestamp: Date.now(),
            title: formatTransactionTitle('PURCHASE', qty, prod.base_unit || prod.unit || 'pcs', prod.name),
            subtitle: 'Scanned',
            amount: formatCurrency(0),
            needsReview: false
        });
        refresh();
        return true;
    };

    const handleRecordSale = async (qty: number, prod: InventoryItem): Promise<boolean> => {
        if (!user?.id) {
            if (isGuest) {
                Alert.alert('Guest mode', 'Sales are not saved in guest mode.');
            }
            return false;
        }

        const { applied, coldStart } = await scannerService.recordSale(prod, qty);
        if (!applied) {
            Alert.alert('Sale not recorded', 'The sale could not be saved. Please try again.');
            return false;
        }

        addActivity({
            intent: 'SALE',
            item: prod.name,
            quantity: qty,
            unit: prod.base_unit || prod.unit || 'pcs',
            timestamp: Date.now(),
            title: formatTransactionTitle('SALE', qty, prod.base_unit || prod.unit || 'pcs', prod.name),
            subtitle: coldStart ? 'Scanned (Cold-Start)' : 'Scanned',
            amount: formatCurrency((prod.selling_price ?? 0) * qty),
            needsReview: false
        });
        refresh();
        return true;
    };

    const handleCreateProduct = async (name: string, qty: number, unit: string, barcode: string): Promise<boolean> => {
        if (!user?.id) {
            if (isGuest) {
                addActivity({
                    intent: 'PURCHASE',
                    item: name,
                    quantity: qty,
                    unit: unit,
                    timestamp: Date.now(),
                    title: `Created ${name}`,
                    subtitle: 'Via Scanner (Guest)',
                    amount: formatCurrency(0),
                    needsReview: false
                });
                Alert.alert('Guest mode', 'Product creation simulated.');
                return true;
            }
            return false;
        }

        try {
            const newItem = await scannerService.createProduct(name, qty, unit, barcode);

            if (!newItem) {
                Alert.alert('Create failed', 'The product could not be saved. Please try again.');
                return false;
            }

            addActivity({
                intent: 'PURCHASE',
                item: name,
                quantity: qty,
                unit: unit,
                timestamp: Date.now(),
                title: `Created ${name}`,
                subtitle: 'Via Scanner',
                amount: formatCurrency(0),
                needsReview: false
            });
            refresh();
            Alert.alert('Product created', `"${name}" was added to inventory.`);
            return true;
        } catch (error) {
            console.error('[Scanner] Create Product Error:', error);
            Alert.alert('Create failed', 'Unexpected error while creating the product.');
            return false;
        }
    };

    return (
        <View style={styles.container}>
            {isFocused && (
                <CameraView
                    style={styles.camera}
                    facing="back"
                    onBarcodeScanned={handleBarcodeScanned}
                    barcodeScannerSettings={{
                        barcodeTypes: ["ean13", "ean8", "pdf417", "aztec", "datamatrix", "code39", "code93", "itf14", "codabar", "code128", "upc_a", "upc_e"],
                    }}
                />
            )}

            {/* Header Actions */}
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity
                    onPress={handleClose}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Close scanner"
                >
                    <Ionicons name="close" size={28} color="white" />
                </TouchableOpacity>
                <View style={styles.modeBadge}>
                    <Text style={styles.modeText}>Scan Product</Text>
                </View>
                <TouchableOpacity
                    onPress={() => router.push('/quick-counter')}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Open quick counter"
                >
                    <Ionicons name="calculator-outline" size={24} color="white" />
                </TouchableOpacity>
            </View>

            {/* Overlays */}
            <ScannerOverlay />

            {/* Scan Toast Message */}
            {scanMessage && (
                <View style={styles.toast}>
                    <Text style={styles.toastText}>{scanMessage}</Text>
                </View>
            )}

            <ProductActionModal
                visible={modalVisible}
                product={scannedProduct}
                scannedBarcode={scannedBarcode}
                prefilledData={prefilledData}
                onClose={handleCloseModal}
                onAddStock={handleAddStock}
                onRecordSale={handleRecordSale}
                onCreateProduct={handleCreateProduct}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    camera: {
        flex: 1,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.xl,
        zIndex: 10,
    },
    iconButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.overlay,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modeBadge: {
        backgroundColor: Colors.light.overlay,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.pill,
        justifyContent: 'center',
    },
    modeText: {
        ...Typography.bodyStrong,
        color: '#FFFFFF',
    },
    permissionContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: Spacing.lg,
        gap: Spacing.lg,
        backgroundColor: Colors.light.background,
    },
    permissionText: {
        ...Typography.body,
        textAlign: 'center',
        color: Colors.light.text,
    },
    permissionCloseButton: {
        minHeight: TouchTarget.min,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.sm,
    },
    permissionCloseText: {
        ...Typography.bodyStrong,
        color: Colors.light.icon,
    },
    btn: {
        minHeight: TouchTarget.min,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.light.tint,
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.md,
    },
    btnText: {
        ...Typography.bodyStrong,
        color: Colors.light.onTint,
    },
    toast: {
        position: 'absolute',
        top: '50%',
        alignSelf: 'center',
        backgroundColor: Colors.light.overlay,
        padding: Spacing.xl,
        borderRadius: Radius.lg,
        zIndex: 20,
        maxWidth: '80%',
    },
    toastText: {
        ...Typography.heading,
        color: '#FFFFFF',
        textAlign: 'center',
    },
});
