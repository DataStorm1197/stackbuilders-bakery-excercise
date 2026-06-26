import { Test, TestingModule } from '@nestjs/testing';
import { KitchenJobStatus, PriorityLevel } from '@prisma/client';
import { MockTimeProvider } from '../common/time/mock-time.provider';
import { TimeProvider } from '../common/time/time-provider';
import { KitchenJobRepository } from './kitchen-job.repository';
import { KitchenJob } from './entities/kitchen-job.entity';
import { KitchenSchedulerService } from './kitchen-scheduler.service';

const BASE_TIME = new Date('2024-01-01T10:00:00Z').getTime();

function makeJob(
  id: string,
  priorityLevel: PriorityLevel,
  bakeMinutes: number,
): KitchenJob {
  const job = new KitchenJob();
  job.id = id;
  job.orderItemId = `order-item-${id}`;
  job.priorityLevel = priorityLevel;
  job.bakeMinutes = bakeMinutes;
  job.status = KitchenJobStatus.QUEUED;
  job.ovenNumber = null;
  job.slotNumber = null;
  job.enqueuedAt = new Date(0);
  job.bakeStartedAt = null;
  job.estimatedDoneAt = null;
  job.bakeDoneAt = null;
  return job;
}

function makeRepoMock() {
  return {
    createBaking: jest.fn().mockResolvedValue(undefined),
    markDone: jest.fn().mockResolvedValue(undefined),
  };
}

async function buildModule(repoMock: ReturnType<typeof makeRepoMock>, timeProvider: MockTimeProvider) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      KitchenSchedulerService,
      { provide: KitchenJobRepository, useValue: repoMock },
      { provide: TimeProvider, useValue: timeProvider },
    ],
  }).compile();

  return module.get(KitchenSchedulerService);
}

describe('KitchenSchedulerService', () => {
  let scheduler: KitchenSchedulerService;
  let repoMock: ReturnType<typeof makeRepoMock>;
  let timeProvider: MockTimeProvider;

  beforeEach(async () => {
    timeProvider = new MockTimeProvider();
    timeProvider.setNow(BASE_TIME);
    repoMock = makeRepoMock();
    scheduler = await buildModule(repoMock, timeProvider);
  });

  function countOccupiedSlots(): number {
    let count = 0;
    for (const [, slots] of scheduler.getKitchenState().ovens) {
      for (const [, job] of slots) {
        if (job !== null) count++;
      }
    }
    return count;
  }

  function findJobInOvens(jobId: string): KitchenJob | null {
    for (const [, slots] of scheduler.getKitchenState().ovens) {
      for (const [, job] of slots) {
        if (job?.id === jobId) return job;
      }
    }
    return null;
  }

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('fills all 6 slots and routes the 7th job to the queue', async () => {
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`job-${i}`, PriorityLevel.TIER2, 30));
    }

    expect(countOccupiedSlots()).toBe(6);
    expect(scheduler.getKitchenState().queue).toHaveLength(0);

    const job7 = makeJob('job-7', PriorityLevel.TIER2, 30);
    await scheduler.enqueue(job7);

    expect(scheduler.getKitchenState().queue).toHaveLength(1);
    expect(scheduler.getKitchenState().queue[0].id).toBe('job-7');
    expect(job7.status).toBe(KitchenJobStatus.QUEUED);
  });

  it('assigns immediately to a slot and returns correct ETA', async () => {
    const job = makeJob('instant', PriorityLevel.TIER2, 45);
    const result = await scheduler.enqueue(job);

    expect(job.status).toBe(KitchenJobStatus.BAKING);
    expect(result.estimatedReadyAt.getTime()).toBe(BASE_TIME + 45 * 60_000);
    expect(repoMock.createBaking).toHaveBeenCalledTimes(1);
  });

  // ── VIP / TIER1 priority ─────────────────────────────────────────────────────

  it('TIER1 job queues ahead of TIER3 and receives the next freed slot; TIER3 ETAs increase', async () => {
    // Fill all 6 slots with 30-min TIER3 baking jobs (all started at BASE_TIME)
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`baking-${i}`, PriorityLevel.TIER3, 30));
    }

    // Queue one TIER3 job and capture its ETA before TIER1 arrives
    const tier3a = makeJob('tier3-a', PriorityLevel.TIER3, 20);
    const result3a = await scheduler.enqueue(tier3a);
    const originalTier3aEta = result3a.estimatedReadyAt.getTime();
    // Serial model: firstSlotFreeAt = BASE+30, ETA = BASE+30+20 = BASE+50

    // Add TIER1 job (10 min) — should jump to front of queue
    const tier1 = makeJob('tier1-vip', PriorityLevel.TIER1, 10);
    const tier1Result = await scheduler.enqueue(tier1);

    // TIER1 is first in queue
    const { queue } = scheduler.getKitchenState();
    expect(queue[0].id).toBe('tier1-vip');

    // Serial model recalculates: TIER1(10)+TIER3a(20) chain from BASE+30
    // TIER3-a new ETA = BASE+30+10+20 = BASE+60 > BASE+50 (original)
    const updated3a = tier1Result.affectedJobs?.find(j => j.jobId === 'tier3-a');
    expect(updated3a).toBeDefined();
    expect(updated3a!.estimatedReadyAt.getTime()).toBeGreaterThan(originalTier3aEta);

    // TIER1 gets the very next freed slot
    await scheduler.completeBaking(1, 1);

    expect(findJobInOvens('tier1-vip')).not.toBeNull();
    expect(scheduler.getKitchenState().queue.some(j => j.id === 'tier1-vip')).toBe(false);
  });

  it('TIER1 returned affectedJobs does not include itself', async () => {
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`slot-${i}`, PriorityLevel.TIER3, 30));
    }
    await scheduler.enqueue(makeJob('tier3-queued', PriorityLevel.TIER3, 20));

    const tier1 = makeJob('tier1', PriorityLevel.TIER1, 10);
    const result = await scheduler.enqueue(tier1);

    expect(result.affectedJobs?.some(j => j.jobId === 'tier1')).toBe(false);
    expect(result.affectedJobs).toHaveLength(1); // only the one TIER3 queued job
  });

  // ── completeBaking / drainQueue ─────────────────────────────────────────────

  it('completeBaking frees slot, persists DONE, and pulls next queued job', async () => {
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`slot-${i}`, PriorityLevel.TIER2, 30));
    }
    const queued = makeJob('next', PriorityLevel.TIER2, 15);
    await scheduler.enqueue(queued);

    expect(queued.status).toBe(KitchenJobStatus.QUEUED);

    await scheduler.completeBaking(1, 1);

    expect(queued.status).toBe(KitchenJobStatus.BAKING);
    expect(findJobInOvens('next')).not.toBeNull();
    expect(repoMock.markDone).toHaveBeenCalledWith('order-item-slot-0', expect.any(Date));
  });

  it('completeBaking on empty slot is a no-op', async () => {
    await expect(scheduler.completeBaking(1, 1)).resolves.not.toThrow();
    expect(repoMock.markDone).not.toHaveBeenCalled();
  });

  // ── Concurrency ──────────────────────────────────────────────────────────────

  it('10 concurrent enqueue calls produce exactly 6 baking jobs with no duplicate slot assignments', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) =>
      makeJob(`concurrent-${i}`, PriorityLevel.TIER2, 30),
    );

    await Promise.all(jobs.map(job => scheduler.enqueue(job)));

    const state = scheduler.getKitchenState();
    expect(state.queue).toHaveLength(4);
    expect(countOccupiedSlots()).toBe(6);

    // No two jobs occupy the same (oven, slot) coordinate
    const slotKeys = new Set<string>();
    for (const [ovenNum, slots] of state.ovens) {
      for (const [slotNum, job] of slots) {
        if (job !== null) {
          const key = `${ovenNum}-${slotNum}`;
          expect(slotKeys.has(key)).toBe(false);
          slotKeys.add(key);
        }
      }
    }
    expect(slotKeys.size).toBe(6);
  });

  // ── Time-provider / ETA accuracy ────────────────────────────────────────────

  it('uses MockTimeProvider.setNow() to produce correct ETA for an immediately assigned job', async () => {
    timeProvider.setNow(BASE_TIME);

    const job = makeJob('time-test-1', PriorityLevel.TIER2, 30);
    const result = await scheduler.enqueue(job);

    expect(result.estimatedReadyAt).toEqual(new Date(BASE_TIME + 30 * 60_000));
  });

  it('computes correct queued ETA using the serial-chain model', async () => {
    timeProvider.setNow(BASE_TIME);

    // Fill all 6 slots with 60-minute jobs (all start at BASE_TIME, done at BASE+60min)
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`baking-${i}`, PriorityLevel.TIER2, 60));
    }

    // First queued job: serial ETA = firstSlotFreeAt(BASE+60) + own(20) = BASE+80min
    const queued = makeJob('queued', PriorityLevel.TIER2, 20);
    const result = await scheduler.enqueue(queued);

    const expectedEta = new Date(BASE_TIME + 60 * 60_000 + 20 * 60_000);
    expect(result.estimatedReadyAt).toEqual(expectedEta);
  });

  it('advancing MockTimeProvider changes ETA for a new job', async () => {
    timeProvider.setNow(BASE_TIME);
    await scheduler.enqueue(makeJob('early', PriorityLevel.TIER2, 30));

    const laterTime = BASE_TIME + 5 * 60_000;
    timeProvider.setNow(laterTime);

    const job = makeJob('later', PriorityLevel.TIER2, 30);
    const result = await scheduler.enqueue(job);

    expect(result.estimatedReadyAt).toEqual(new Date(laterTime + 30 * 60_000));
  });

  // ── Queue ordering ───────────────────────────────────────────────────────────

  it('sorts queue: TIER1 before TIER2 before TIER3, FIFO within tier', async () => {
    // Fill all slots so everything goes to the queue
    for (let i = 0; i < 6; i++) {
      await scheduler.enqueue(makeJob(`slot-${i}`, PriorityLevel.TIER2, 30));
    }

    await scheduler.enqueue(makeJob('t3-first', PriorityLevel.TIER3, 10));
    await scheduler.enqueue(makeJob('t2-first', PriorityLevel.TIER2, 10));
    await scheduler.enqueue(makeJob('t1-first', PriorityLevel.TIER1, 10));
    await scheduler.enqueue(makeJob('t1-second', PriorityLevel.TIER1, 10));
    await scheduler.enqueue(makeJob('t2-second', PriorityLevel.TIER2, 10));

    const { queue } = scheduler.getKitchenState();
    const ids = queue.map(j => j.id);

    expect(ids).toEqual(['t1-first', 't1-second', 't2-first', 't2-second', 't3-first']);
  });
});
