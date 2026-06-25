import { Injectable } from '@nestjs/common';
import { MenuItem, Order, OrderItem, OrderStatus, PriorityLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type OrderWithItems = Order & { items: Array<OrderItem & { menuItem: MenuItem }> };

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMenuItemsByIds(ids: string[]): Promise<MenuItem[]> {
    return this.prisma.menuItem.findMany({
      where: { id: { in: ids }, available: true },
    });
  }

  async createOrderWithItems(params: {
    customerId: string;
    priorityLevel: PriorityLevel;
    totalPrice: number;
    items: Array<{ menuItemId: string; quantity: number }>;
  }): Promise<OrderWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          customerId: params.customerId,
          priorityLevel: params.priorityLevel,
          totalPrice: params.totalPrice,
          items: {
            create: params.items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: { include: { menuItem: true } } },
      });
      return order as OrderWithItems;
    });
  }

  updateEstimatedReadyAt(orderId: string, estimatedReadyAt: Date): Promise<Order> {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { estimatedReadyAt },
    });
  }

  findById(id: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { menuItem: true } } },
    });
  }

  updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status },
    });
  }
}
