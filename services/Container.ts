import { IInventoryRepository } from '@/core/interfaces/IInventoryRepository';
import { SupabaseInventoryRepository } from '@/data/repositories/SupabaseInventoryRepository';
import { InventoryService } from './InventoryService';
import { OfflineQueueService } from './offline/OfflineQueueService';

class ServiceContainer {
    private static instance: ServiceContainer;

    public inventoryService: InventoryService;
    public inventoryRepository: IInventoryRepository;
    public offlineQueue: OfflineQueueService;

    private constructor() {
        this.inventoryRepository = new SupabaseInventoryRepository();
        this.offlineQueue = new OfflineQueueService();
        this.inventoryService = new InventoryService(this.inventoryRepository, this.offlineQueue);
    }

    public static getInstance(): ServiceContainer {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer();
        }
        return ServiceContainer.instance;
    }
}

export const container = ServiceContainer.getInstance();
