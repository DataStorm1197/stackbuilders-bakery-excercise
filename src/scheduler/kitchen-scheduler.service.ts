import { Injectable, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { KitchenJobStatus, PriorityLevel } from '@prisma/client';
import { Mutex } from 'async-mutex';
import { Gauge } from 'prom-client';
import { TimeProvider } from '../common/time/time-provider';
import { KitchenJobRepository } from './kitchen-job.repository';
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
  private readonly ovens: Map<number, Map<number, KitchenJob | null>>;
  private queue: KitchenJob[];
  private readonly mutex: Mutex;

  constructor(
    private readonly kitchenJobRepository: KitchenJobRepository,
    private readonly timeProvider: TimeProvider,
    @Optional() @InjectMetric('kitchen_queue_length') private readonly queueGauge?: Gauge<string>,
    @Optional() @InjectMetric('oven_utilization') private readonly ovenUtilGauge?: Gauge<string>,
  ) {
    this.mutex = new Mutex();
    this.ovens = new Map([
      [1, new Map<number, KitchenJob | null>([[1, null], [2, null], [3, null]])],
      [2, new Map<number, KitchenJob | null>([[1, null], [2, null], [3, null]])],
    ]);
    this.queue = [];
  }

  /**
   * Adds a job to the scheduler. If a free oven slot exists the job starts
   * baking immediately and the returned ETA reflects its own bake_minutes.
   * When all 6 slots are occupied the job is sorted into the priority queue
   * and receives a serial-chain ETA. TIER1 jobs also return `affectedJobs`
   * with the recalculated ETAs of every queued job displaced by the insertion.
   */
  async enqueue(job: KitchenJob): Promise<EtaResult> {
    return this.mutex.runExclusive(async () => {
      job.enqueuedAt = new Date(this.timeProvider.now());
      job.status = KitchenJobStatus.QUEUED;

      const freeSlot = this.findFreeSlot();
      if (freeSlot) {
        const estimatedReadyAt = this.assignJobToSlot(job, freeSlot.ovenNumber, freeSlot.slotNumber);
        await this.persistBakingJob(job);
        this.updateMetrics();
        return { jobId: job.id, estimatedReadyAt };
      }

      this.insertIntoQueue(job);
      const allEtas = this.recalculateAllQueuedEtas();
      const thisEta = allEtas.find(e => e.jobId === job.id)!;

      const result: EtaResult = { jobId: job.id, estimatedReadyAt: thisEta.estimatedReadyAt };
      if (job.priorityLevel === PriorityLevel.TIER1) {
        result.affectedJobs = allEtas.filter(e => e.jobId !== job.id);
      }
      this.updateMetrics();
      return result;
    });
  }

  /**
   * Drains the queue into any currently free oven slots. Safe to call at any
   * time; it is a no-op when either the queue is empty or all slots are full.
   */
  async assignPendingJobs(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.drainQueue();
      this.updateMetrics();
    });
  }

  /**
   * Marks the job occupying `ovenNumber/slotNumber` as DONE, persists the
   * completion timestamp, frees the slot, and immediately pulls the next
   * queued job into that slot (if any).
   */
  async completeBaking(ovenNumber: number, slotNumber: number): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await this.completeBakingInternal(ovenNumber, slotNumber);
      this.updateMetrics();
    });
  }

  /**
   * Completes every slot whose job is due (estimatedDoneAt <= nowMs) under a
   * single lock, draining the queue after each. Replaces callers reaching into
   * the oven grid directly. Returns the number of jobs completed.
   */
  async completeJobsDueBy(nowMs: number): Promise<number> {
    return this.mutex.runExclusive(async () => {
      const due: Array<{ ovenNumber: number; slotNumber: number }> = [];
      for (const [ovenNumber, slots] of this.ovens) {
        for (const [slotNumber, job] of slots) {
          if (job?.estimatedDoneAt && job.estimatedDoneAt.getTime() <= nowMs) {
            due.push({ ovenNumber, slotNumber });
          }
        }
      }

      for (const { ovenNumber, slotNumber } of due) {
        await this.completeBakingInternal(ovenNumber, slotNumber);
      }
      this.updateMetrics();
      return due.length;
    });
  }

  /** Clears all oven slots and the queue. Intended for test setup/teardown. */
  async reset(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      for (const [, slots] of this.ovens) {
        for (const [slotNumber] of slots) slots.set(slotNumber, null);
      }
      this.queue = [];
      this.updateMetrics();
    });
  }

  /** Returns a snapshot of the current oven grid and waiting queue. */
  getKitchenState(): KitchenState {
    return { ovens: this.ovens, queue: [...this.queue] };
  }

  // ── private helpers (no mutex – always called within a locked context) ──────

  private async completeBakingInternal(ovenNumber: number, slotNumber: number): Promise<void> {
    const job = this.ovens.get(ovenNumber)?.get(slotNumber);
    if (!job) return;

    job.status = KitchenJobStatus.DONE;
    job.bakeDoneAt = new Date(this.timeProvider.now());
    this.ovens.get(ovenNumber)!.set(slotNumber, null);

    await this.kitchenJobRepository.markDone(job.orderItemId, job.bakeDoneAt);
    await this.drainQueue();
  }

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
    await this.kitchenJobRepository.createBaking(job);
  }

  private updateMetrics(): void {
    if (!this.queueGauge && !this.ovenUtilGauge) return;
    let usedSlots = 0;
    for (const [, slots] of this.ovens) {
      for (const [, job] of slots) {
        if (job !== null) usedSlots++;
      }
    }
    this.queueGauge?.set(this.queue.length);
    this.ovenUtilGauge?.set(usedSlots / 6);
  }
}
