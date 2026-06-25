import { Injectable } from '@nestjs/common';
import { KitchenJobStatus, PriorityLevel } from '@prisma/client';
import { Mutex } from 'async-mutex';
import { TimeProvider } from '../common/time/time-provider';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenJob } from './entities/kitchen-job.entity';
import { EtaResult } from './interfaces/eta-result.interface';
import { KitchenState } from './interfaces/kitchen-state.interface';

const TIER_ORDER: Record<PriorityLevel, number> = {
  [PriorityLevel.TIER1]: 0,
  [PriorityLevel.TIER2]: 1,
  [PriorityLevel.TIER3]: 2,
};

@Injectable()
export class KitchenSchedulerService {
  readonly ovens: Map<number, Map<number, KitchenJob | null>>;
  private queue: KitchenJob[];
  private readonly mutex: Mutex;

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeProvider: TimeProvider,
  ) {
    this.mutex = new Mutex();
    this.ovens = new Map([
      [1, new Map<number, KitchenJob | null>([[1, null], [2, null], [3, null]])],
      [2, new Map<number, KitchenJob | null>([[1, null], [2, null], [3, null]])],
    ]);
    this.queue = [];
  }

  async enqueue(job: KitchenJob): Promise<EtaResult> {
    return this.mutex.runExclusive(async () => {
      job.enqueuedAt = new Date(this.timeProvider.now());
      job.status = KitchenJobStatus.QUEUED;

      const freeSlot = this.findFreeSlot();
      if (freeSlot) {
        const estimatedReadyAt = this.assignJobToSlot(job, freeSlot.ovenNumber, freeSlot.slotNumber);
        await this.persistBakingJob(job);
        return { jobId: job.id, estimatedReadyAt };
      }

      this.insertIntoQueue(job);
      const allEtas = this.recalculateAllQueuedEtas();
      const thisEta = allEtas.find(e => e.jobId === job.id)!;

      const result: EtaResult = { jobId: job.id, estimatedReadyAt: thisEta.estimatedReadyAt };
      if (job.priorityLevel === PriorityLevel.TIER1) {
        result.affectedJobs = allEtas.filter(e => e.jobId !== job.id);
      }
      return result;
    });
  }

  async assignPendingJobs(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.drainQueue();
    });
  }

  async completeBaking(ovenNumber: number, slotNumber: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const job = this.ovens.get(ovenNumber)?.get(slotNumber);
      if (!job) return;

      job.status = KitchenJobStatus.DONE;
      job.bakeDoneAt = new Date(this.timeProvider.now());
      this.ovens.get(ovenNumber)!.set(slotNumber, null);

      await this.prisma.kitchenJob.update({
        where: { orderItemId: job.orderItemId },
        data: { status: KitchenJobStatus.DONE, bakeDoneAt: job.bakeDoneAt },
      });

      await this.drainQueue();
    });
  }

  getKitchenState(): KitchenState {
    return { ovens: this.ovens, queue: [...this.queue] };
  }

  // ── private helpers (no mutex – always called within a locked context) ──────

  private findFreeSlot(): { ovenNumber: number; slotNumber: number } | null {
    for (const [ovenNumber, slots] of this.ovens) {
      for (const [slotNumber, job] of slots) {
        if (job === null) return { ovenNumber, slotNumber };
      }
    }
    return null;
  }

  private assignJobToSlot(job: KitchenJob, ovenNumber: number, slotNumber: number): Date {
    const now = this.timeProvider.now();
    job.status = KitchenJobStatus.BAKING;
    job.ovenNumber = ovenNumber;
    job.slotNumber = slotNumber;
    job.bakeStartedAt = new Date(now);
    job.estimatedDoneAt = new Date(now + job.bakeMinutes * 60_000);
    this.ovens.get(ovenNumber)!.set(slotNumber, job);
    return job.estimatedDoneAt;
  }

  private insertIntoQueue(job: KitchenJob): void {
    this.queue.push(job);
    this.queue.sort((a, b) => {
      const tierDiff = TIER_ORDER[a.priorityLevel] - TIER_ORDER[b.priorityLevel];
      if (tierDiff !== 0) return tierDiff;
      return a.enqueuedAt.getTime() - b.enqueuedAt.getTime();
    });
  }

  /**
   * Serial-queue ETA model: queued jobs form a chain starting from when the
   * earliest occupied slot frees up. Each job's ETA = firstSlotFreeAt +
   * sum(bakeMinutes of all jobs ahead in queue) + own bakeMinutes.
   *
   * This matches the spec: "sum of bake_minutes of all jobs that will finish
   * before it". TIER1 jobs inserted ahead of lower-priority jobs increase
   * those jobs' ETAs because their bakeMinutes are added to the chain.
   */
  private recalculateAllQueuedEtas(): Array<{ jobId: string; estimatedReadyAt: Date }> {
    let firstSlotFreeAt = Infinity;
    for (const [, slots] of this.ovens) {
      for (const [, job] of slots) {
        if (job !== null && job.estimatedDoneAt) {
          firstSlotFreeAt = Math.min(firstSlotFreeAt, job.estimatedDoneAt.getTime());
        }
      }
    }
    if (firstSlotFreeAt === Infinity) firstSlotFreeAt = this.timeProvider.now();

    let runningTime = firstSlotFreeAt;
    const results: Array<{ jobId: string; estimatedReadyAt: Date }> = [];

    for (const queuedJob of this.queue) {
      runningTime += queuedJob.bakeMinutes * 60_000;
      const eta = new Date(runningTime);
      queuedJob.estimatedDoneAt = eta;
      results.push({ jobId: queuedJob.id, estimatedReadyAt: eta });
    }

    return results;
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const freeSlot = this.findFreeSlot();
      if (!freeSlot) break;
      const job = this.queue.shift()!;
      this.assignJobToSlot(job, freeSlot.ovenNumber, freeSlot.slotNumber);
      await this.persistBakingJob(job);
    }
  }

  private async persistBakingJob(job: KitchenJob): Promise<void> {
    await this.prisma.kitchenJob.create({
      data: {
        id: job.id,
        orderItemId: job.orderItemId,
        status: KitchenJobStatus.BAKING,
        ovenNumber: job.ovenNumber!,
        slotNumber: job.slotNumber!,
        bakeStartedAt: job.bakeStartedAt,
      },
    });
  }
}
