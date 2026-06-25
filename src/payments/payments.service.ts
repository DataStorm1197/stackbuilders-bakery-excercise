import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { TimeProvider } from '../common/time/time-provider';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsRepository } from './payments.repository';

// Strategy hook: inject a PaymentGateway interface here to swap between
// SimulatedGateway (current), PayPhoneAdapter, or StripeAdapter at runtime.

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly timeProvider: TimeProvider,
  ) {}

  async processPayment(dto: CreatePaymentDto) {
    const order = await this.paymentsRepository.findOrderById(dto.orderId);
    if (!order) throw new NotFoundException(`Order ${dto.orderId} not found`);

    if (order.status !== OrderStatus.READY) {
      throw new BadRequestException(
        `Order must be in READY status to accept payment, current status: ${order.status}`,
      );
    }

    const totalPrice = Number(order.totalPrice);
    if (dto.amount < totalPrice) {
      throw new BadRequestException(
        `Amount ${dto.amount} is less than order total ${totalPrice}`,
      );
    }

    const paidAt = this.timeProvider.nowAsDate();
    const payment = await this.paymentsRepository.createPaymentAndMarkPaid({
      orderId: dto.orderId,
      method: dto.method,
      amount: dto.amount,
      paidAt,
    });

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      amount: dto.amount,
      change: Number((dto.amount - totalPrice).toFixed(2)),
      paidAt: payment.paidAt,
    };
  }

  async getPaymentByOrder(orderId: string) {
    const order = await this.paymentsRepository.findOrderById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const payment = await this.paymentsRepository.findPaymentByOrderId(orderId);
    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      amount: Number(payment.amount),
      status: payment.status,
      paidAt: payment.paidAt,
    };
  }
}
