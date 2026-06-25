import { Injectable, NotFoundException } from '@nestjs/common';
import { MockTimeProvider } from '../common/time/mock-time.provider';
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

  async advanceTime(minutes: number): Promise<{ advancedMs: number; completedJobs: number }> {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new NotFoundException();
    }

    const mock = this.timeProvider as MockTimeProvider;
    const newNow = mock.now() + minutes * 60_000;
    mock.setNow(newNow);

    const doneSlots: Array<{ ovenNumber: number; slotNumber: number }> = [];
    for (const [ovenNumber, slots] of this.scheduler.ovens) {
      for (const [slotNumber, job] of slots) {
        if (job && job.estimatedDoneAt && job.estimatedDoneAt.getTime() <= newNow) {
          doneSlots.push({ ovenNumber, slotNumber });
        }
      }
    }

    for (const { ovenNumber, slotNumber } of doneSlots) {
      await this.scheduler.completeBaking(ovenNumber, slotNumber);
    }

    return { advancedMs: minutes * 60_000, completedJobs: doneSlots.length };
  }
}
