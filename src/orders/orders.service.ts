import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { KitchenJobStatus, OrderStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Counter } from 'prom-client';
import { Role } from '../auth/enums/role.enum';
import { KitchenJob } from '../scheduler/domain/kitchen-job';
import { KitchenSchedulerService } from '../scheduler/kitchen-scheduler.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly kitchenScheduler: KitchenSchedulerService,
    @Optional() @InjectMetric('orders_placed_total') private readonly ordersCounter?: Counter<string>,
  ) {}

  async createOrder(customerId: string, dto: CreateOrderDto) {
    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.ordersRepository.findMenuItemsByIds(menuItemIds);

    if (menuItems.length !== menuItemIds.length) {
      const foundIds = new Set(menuItems.map((m) => m.id));
      const missing = menuItemIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `Menu items not found or unavailable: ${missing.join(', ')}`,
      );
    }

    const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));
    const totalPrice = dto.items.reduce((sum, item) => {
      return sum + Number(menuItemMap.get(item.menuItemId)!.price) * item.quantity;
    }, 0);

    const order = await this.ordersRepository.createOrderWithItems({
      customerId,
      priorityLevel: dto.priorityLevel,
      totalPrice,
      items: dto.items,
    });

    let maxEta: Date | null = null;
    for (const orderItem of order.items) {
      const menuItem = menuItemMap.get(orderItem.menuItemId)!;
      const job = new KitchenJob();
      job.id = randomUUID();
      job.orderItemId = orderItem.id;
      job.priorityLevel = dto.priorityLevel;
      job.bakeMinutes = menuItem.bake_minutes;
      job.status = KitchenJobStatus.QUEUED;
      job.ovenNumber = null;
      job.slotNumber = null;
      job.enqueuedAt = new Date();
      job.bakeStartedAt = null;
      job.estimatedDoneAt = null;
      job.bakeDoneAt = null;

      const etaResult = await this.kitchenScheduler.enqueue(job);
      if (maxEta === null || etaResult.estimatedReadyAt > maxEta) {
        maxEta = etaResult.estimatedReadyAt;
      }
    }

    this.ordersCounter?.inc({ priority_level: dto.priorityLevel });

    if (maxEta) {
      await this.ordersRepository.updateEstimatedReadyAt(order.id, maxEta);
    }

    return {
      orderId: order.id,
      totalPrice,
      estimatedReadyAt: maxEta,
      priorityLevel: dto.priorityLevel,
      items: order.items.map((item) => ({
        menuItemId: item.menuItemId,
        menuItemName: item.menuItem.name,
        quantity: item.quantity,
        unitPrice: Number(item.menuItem.price),
      })),
    };
  }

  async getOrder(id: string, requesterId: string, requesterRole: Role) {
    const order = await this.ordersRepository.findById(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    if (requesterRole === Role.CUSTOMER && order.customerId !== requesterId) {
      throw new ForbiddenException('You can only view your own orders');
    }

    return {
      orderId: order.id,
      status: order.status,
      estimatedReadyAt: order.estimatedReadyAt,
      totalPrice: Number(order.totalPrice),
      priorityLevel: order.priorityLevel,
      items: order.items.map((item) => ({
        menuItemId: item.menuItemId,
        menuItemName: item.menuItem.name,
        quantity: item.quantity,
        unitPrice: Number(item.menuItem.price),
      })),
    };
  }

  async markAsReady(id: string) {
    const order = await this.ordersRepository.findById(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return this.ordersRepository.updateStatus(id, OrderStatus.READY);
  }
}
