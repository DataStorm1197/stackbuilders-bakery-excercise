import { KitchenJob } from '../entities/kitchen-job.entity';

export interface KitchenState {
  ovens: Map<number, Map<number, KitchenJob | null>>;
  queue: KitchenJob[];
}
