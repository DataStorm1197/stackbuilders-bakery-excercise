import { Injectable } from '@nestjs/common';
import { Order, OrderStatus, PaymentMethod, PaymentRecord, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOrderById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  findPaymentByOrderId(orderId: string): Promise<PaymentRecord | null> {
    return this.prisma.paymentRecord.findUnique({ where: { orderId } });
  }

  createPaymentAndMarkPaid(params: {
    orderId: string;
    method: PaymentMethod;
    amount: number;
    paidAt: Date;
  }): Promise<PaymentRecord> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRecord.create({
        data: {
          orderId: params.orderId,
          method: params.method,
          amount: params.amount,
          status: PaymentStatus.COMPLETED,
          paidAt: params.paidAt,
        },
      });

      await tx.order.update({
        where: { id: params.orderId },
        data: { status: OrderStatus.PAID },
      });

      return payment;
    });
  }
}
