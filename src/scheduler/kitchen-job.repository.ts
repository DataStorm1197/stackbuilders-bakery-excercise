import { Injectable } from '@nestjs/common';
import { KitchenJobStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenJob } from './entities/kitchen-job.entity';

/**
 * Persistence gateway for kitchen jobs. Only BAKING and DONE transitions are
 * written — QUEUED jobs live in memory only. Both writes also advance the
 * parent order's lifecycle: the order moves to BAKING when its first item
 * starts baking and to READY once every item has finished.
 */
@Injectable()
export class KitchenJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Persists a job as BAKING and moves a still-PENDING order into BAKING. */
  async createBaking(job: KitchenJob): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.kitchenJob.create({
        data: {
          id: job.id,
          orderItemId: job.orderItemId,
          status: KitchenJobStatus.BAKING,
          ovenNumber: job.ovenNumber!,
          slotNumber: job.slotNumber!,
          bakeStartedAt: job.bakeStartedAt,
        },
      });

      const orderItem = await tx.orderItem.findUnique({
        where: { id: job.orderItemId },
        select: { orderId: true },
      });
      if (!orderItem) return;

      await tx.order.updateMany({
        where: { id: orderItem.orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.BAKING },
      });
    });
  }

  /**
   * Marks a job DONE and, when it was the last item left baking for its order,
   * transitions that order to READY.
   */
  async markDone(orderItemId: string, bakeDoneAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.kitchenJob.update({
        where: { orderItemId },
        data: { status: KitchenJobStatus.DONE, bakeDoneAt },
      });

      const orderItem = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        select: { orderId: true },
      });
      if (!orderItem) return;
      const { orderId } = orderItem;

      const [totalItems, doneJobs] = await Promise.all([
        tx.orderItem.count({ where: { orderId } }),
        tx.kitchenJob.count({
          where: { status: KitchenJobStatus.DONE, orderItem: { orderId } },
        }),
      ]);

      if (totalItems > 0 && totalItems === doneJobs) {
        await tx.order.updateMany({
          where: {
            id: orderId,
            status: { in: [OrderStatus.PENDING, OrderStatus.BAKING] },
          },
          data: { status: OrderStatus.READY },
        });
      }
    });
  }
}
