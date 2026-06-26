import { KitchenJob } from '../domain/kitchen-job';

export interface KitchenState {
  ovens: Map<number, Map<number, KitchenJob | null>>;
  queue: KitchenJob[];
}
