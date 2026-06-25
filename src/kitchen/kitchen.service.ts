import { Injectable } from '@nestjs/common';
import { TimeProvider } from '../common/time/time-provider';
import { KitchenSchedulerService } from '../scheduler/kitchen-scheduler.service';

@Injectable()
export class KitchenService {
  constructor(
    private readonly scheduler: KitchenSchedulerService,
    private readonly timeProvider: TimeProvider,
  ) {}

  getMonitorState() {
    const { ovens, queue } = this.scheduler.getKitchenState();
    const now = this.timeProvider.now();

    let totalBaking = 0;

    const ovensResult = Array.from(ovens.entries()).map(([ovenNumber, slots]) => ({
      ovenNumber,
      slots: Array.from(slots.entries()).map(([slotNumber, job]) => {
        if (job === null) {
          return { slotNumber, status: 'EMPTY' };
        }
        totalBaking++;
        const bakeMinutesRemaining = job.estimatedDoneAt
          ? Math.max(0, Math.ceil((job.estimatedDoneAt.getTime() - now) / 60_000))
          : 0;
        return {
          slotNumber,
          status: 'BAKING',
          job: {
            id: job.id,
            orderItemId: job.orderItemId,
            bakeStartedAt: job.bakeStartedAt,
            bakeMinutesRemaining,
          },
        };
      }),
    }));

    const queueResult = queue.map((job, index) => ({
      position: index + 1,
      job: {
        id: job.id,
        orderItemId: job.orderItemId,
        priorityLevel: job.priorityLevel,
        estimatedReadyAt: job.estimatedDoneAt,
      },
    }));

    return {
      ovens: ovensResult,
      queue: queueResult,
      totalQueued: queue.length,
      totalBaking,
    };
  }
}
