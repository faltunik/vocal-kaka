import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { devLog, devWarn } from '@/utils/devLog';
import { errorMessage, isNetworkError } from '@/utils/network';

export { isNetworkError } from '@/utils/network';

export interface ParsedActionLite {
    intent: string;
    item?: string | null;
    quantity?: number | null;
    unit?: string | null;
    amount?: number | null;
    original_text?: string;
}

export interface VoiceAnswer {
    intent: string;
    text: string;
}

export type QueuedReason = 'offline' | 'server';

export interface VoiceCommandResult {
    transcript: string;
    actions: ParsedActionLite[];
    applied: number;
    answers: VoiceAnswer[];
    queued?: boolean;
    queuedReason?: QueuedReason;
    error?: string;
}

interface PendingRecording {
    recordingId: string;
    userId: string;
    storeId?: string | null;
    uri: string;
    durationMs?: number;
    createdAt: number;
    attempts?: number;
}

const QUEUE_KEY = 'vocalstock:pending-recordings';
const MAX_QUEUE = 50;
const MAX_RETRY_ATTEMPTS = 5;
const PENDING_RECORDINGS_DIR = 'pending-recordings';

/** Local recording could not be read (retrying will not help). */
export class RecordingFileError extends Error {}

function createRecordingId(): string {
    return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function httpStatus(error: unknown): number | undefined {
    const candidate = error as { context?: { status?: number }; status?: number; statusCode?: number };
    return candidate?.context?.status ?? candidate?.status ?? candidate?.statusCode;
}

/** Slices a typed array view down to a plain ArrayBuffer. */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function loadQueue(): Promise<PendingRecording[]> {
    let raw: string | null = null;
    try {
        raw = await AsyncStorage.getItem(QUEUE_KEY);
    } catch {
        return [];
    }
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error('queue payload is not an array');
        }
        return parsed as PendingRecording[];
    } catch (error) {
        // Never silently discard pending voice commands: keep the raw value
        // under a recovery key before resetting the live queue.
        devWarn('[VoiceCommand] Corrupt recording queue preserved for recovery', error);
        try {
            await AsyncStorage.setItem(`${QUEUE_KEY}:corrupt-${Date.now()}`, raw);
            await AsyncStorage.removeItem(QUEUE_KEY);
            // Keep only the two newest recovery snapshots.
            const keys = await AsyncStorage.getAllKeys();
            const snapshots = keys
                .filter(key => key.startsWith(`${QUEUE_KEY}:corrupt-`))
                .sort();
            for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - 2))) {
                await AsyncStorage.removeItem(stale);
            }
        } catch {
            // Recovery copy is best-effort
        }
        return [];
    }
}

/** Persists the queue and deletes durable copies of evicted recordings. */
async function saveQueue(items: PendingRecording[]): Promise<boolean> {
    const capped = items.slice(-MAX_QUEUE);
    const evicted = items.slice(0, Math.max(0, items.length - capped.length));
    for (const recording of evicted) {
        deletePersistedRecording(recording.uri);
    }

    try {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(capped));
        return true;
    } catch {
        return false;
    }
}

/**
 * Serializes queue read-modify-write phases so a concurrent enqueue and flush
 * can never overwrite each other and silently drop a recording.
 */
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
    const run = queueLock.then(task, task);
    queueLock = run.catch(() => undefined);
    return run;
}

async function enqueueRecording(recording: PendingRecording): Promise<boolean> {
    return withQueueLock(async () => {
        const queue = await loadQueue();
        queue.push(recording);
        return await saveQueue(queue);
    });
}

/**
 * Copies a cache-directory recording into durable app storage before queueing,
 * so an app crash, cache eviction or device reboot cannot drop the command.
 */
function persistRecording(recording: PendingRecording): PendingRecording {
    try {
        const pendingDir = new Directory(Paths.document, PENDING_RECORDINGS_DIR);
        if (!pendingDir.exists) {
            pendingDir.create({ intermediates: true });
        }
        const destination = new File(pendingDir, `${recording.recordingId}.m4a`);
        new File(recording.uri).copy(destination);
        devLog(`[VoiceCommand] persisted offline recording to ${destination.uri}`);
        return { ...recording, uri: destination.uri };
    } catch (error) {
        devWarn('[VoiceCommand] could not persist recording for offline retry', errorMessage(error));
        return recording;
    }
}

/** Removes the durable copy once the recording is uploaded or dropped. */
function deletePersistedRecording(uri: string): void {
    if (!uri.includes(`/${PENDING_RECORDINGS_DIR}/`)) return;
    try {
        new File(uri).delete();
    } catch {
        // Cleanup is best-effort; the OS will reclaim the file eventually
    }
}

/**
 * Reads the recording as raw bytes through the new expo-file-system API.
 * (SDK 54's main export has no legacy `readAsStringAsync`.)
 */
async function readRecordingBytes(uri: string): Promise<ArrayBuffer> {
    try {
        const file = new File(uri);
        const bytes = await file.bytes();
        if (!bytes || bytes.byteLength === 0) {
            throw new Error('recording file is empty');
        }
        devLog(`[VoiceCommand] read ${bytes.byteLength} bytes from ${uri}`);
        return bytesToArrayBuffer(bytes);
    } catch (error) {
        throw new RecordingFileError(`could not read ${uri}: ${errorMessage(error)}`);
    }
}

async function uploadRecording(path: string, recording: PendingRecording): Promise<void> {
    devLog(`[VoiceCommand] uploading ${path}`);
    try {
        // Preferred: native multipart upload via the RN file descriptor (no file read)
        const formData = new FormData();
        formData.append('file', {
            uri: recording.uri,
            name: 'recording.m4a',
            type: 'audio/m4a',
        } as unknown as Blob);
        const { error } = await supabase.storage.from('recordings').upload(path, formData, { upsert: true });
        if (error) throw error;
        devLog('[VoiceCommand] upload ok (multipart)');
        return;
    } catch (error) {
        devWarn('[VoiceCommand] multipart upload failed, falling back to bytes', {
            message: errorMessage(error),
            status: httpStatus(error),
        });
    }

    const bytes = await readRecordingBytes(recording.uri);
    const { error } = await supabase.storage
        .from('recordings')
        .upload(path, bytes, { contentType: 'audio/m4a', upsert: true });
    if (error) throw error;
    devLog('[VoiceCommand] upload ok (bytes)');
}

async function uploadAndProcess(recording: PendingRecording): Promise<VoiceCommandResult> {
    const path = `${recording.userId}/${recording.recordingId}.m4a`;
    await uploadRecording(path, recording);

    const startedAt = Date.now();
    const { data, error } = await supabase.functions.invoke('process-recording', {
        body: {
            recording_id: recording.recordingId,
            audio_path: path,
            duration_ms: recording.durationMs,
            ...(recording.storeId ? { store_id: recording.storeId } : {}),
        },
    });
    if (error) {
        console.error('[VoiceCommand] invoke failed', {
            message: errorMessage(error),
            status: httpStatus(error),
        });
        throw error;
    }

    const result = data as VoiceCommandResult;
    devLog(`[VoiceCommand] processed in ${Date.now() - startedAt}ms`, {
        applied: result?.applied,
        transcript: result?.transcript,
    });
    return result;
}

/**
 * Uploads a recording and processes it server-side (ASR + LLM + ledger).
 * Network/server-5xx failures are queued for retry; 4xx rejections and local
 * file errors are surfaced instead of being retried forever.
 */
export async function processRecording(
    uri: string,
    userId: string,
    storeId?: string | null,
    durationMs?: number
): Promise<VoiceCommandResult> {
    const recording: PendingRecording = {
        recordingId: createRecordingId(),
        userId,
        storeId: storeId ?? null,
        uri,
        durationMs,
        createdAt: Date.now(),
        attempts: 0,
    };

    try {
        return await uploadAndProcess(recording);
    } catch (error) {
        console.error('[VoiceCommand] processRecording failed', {
            name: error instanceof Error ? error.name : typeof error,
            message: errorMessage(error),
            status: httpStatus(error),
            stack: error instanceof Error ? error.stack : undefined,
        });

        if (error instanceof RecordingFileError) {
            return {
                transcript: '',
                actions: [],
                applied: 0,
                answers: [],
                error: `Could not read the recording. ${errorMessage(error)}`,
            };
        }

        const status = httpStatus(error);
        // 429 (rate limit) and 408 (timeout) are retryable, matching the
        // flush semantics; other 4xx are surfaced instead of queued.
        if (status != null && status >= 400 && status < 500 && status !== 429 && status !== 408) {
            return {
                transcript: '',
                actions: [],
                applied: 0,
                answers: [],
                error: errorMessage(error),
            };
        }

        const queued = await enqueueRecording(persistRecording(recording));
        if (!queued) {
            return {
                transcript: '',
                actions: [],
                applied: 0,
                answers: [],
                error: 'Could not save the recording for retry. Please try again.',
            };
        }

        return {
            transcript: '',
            actions: [],
            applied: 0,
            answers: [],
            queued: true,
            queuedReason: isNetworkError(error) ? 'offline' : 'server',
            error: errorMessage(error),
        };
    }
}

/**
 * Retries queued recordings for one user; returns the results that succeeded.
 * Recordings belonging to other users are left untouched.
 */
export async function flushPendingRecordings(userId?: string): Promise<VoiceCommandResult[]> {
    // Serialized with enqueueRecording so a recording queued mid-flush is kept.
    return withQueueLock(async () => {
        const queue = await loadQueue();
        if (queue.length === 0) return [];

        const mine = userId ? queue.filter(recording => recording.userId === userId) : queue;
        const others = userId ? queue.filter(recording => recording.userId !== userId) : [];
        if (mine.length === 0) return [];

        const remaining: PendingRecording[] = [];
        const processed: VoiceCommandResult[] = [];

        for (const recording of mine) {
            try {
                processed.push(await uploadAndProcess(recording));
                deletePersistedRecording(recording.uri);
            } catch (error) {
                // Drop unrecoverable poison pills: missing local file or non-retryable 4xx
                if (error instanceof RecordingFileError) {
                    devWarn('[VoiceCommand] Dropping unreadable recording from retry queue:', recording.recordingId);
                    deletePersistedRecording(recording.uri);
                    continue;
                }
                const status = httpStatus(error);
                if (status != null && status >= 400 && status < 500 && status !== 429 && status !== 408) {
                    devWarn(`[VoiceCommand] Dropping non-retryable ${status} error from queue:`, recording.recordingId);
                    deletePersistedRecording(recording.uri);
                    continue;
                }

                const retryableServer = status != null && (status >= 500 || status === 429 || status === 408);
                if (retryableServer) {
                    const attempts = (recording.attempts ?? 0) + 1;
                    if (attempts >= MAX_RETRY_ATTEMPTS) {
                        devWarn(
                            `[VoiceCommand] Dropping recording after ${attempts} server failures:`,
                            recording.recordingId
                        );
                        deletePersistedRecording(recording.uri);
                        continue;
                    }
                    remaining.push({ ...recording, attempts });
                    continue;
                }

                // Network/offline failures are never penalized: the recording is
                // kept until connectivity returns (zero-loss offline resilience).
                remaining.push(recording);
            }
        }

        await saveQueue([...others, ...remaining]);
        return processed;
    });
}

export async function pendingRecordingCount(userId?: string): Promise<number> {
    const queue = await loadQueue();
    return userId ? queue.filter(recording => recording.userId === userId).length : queue.length;
}
