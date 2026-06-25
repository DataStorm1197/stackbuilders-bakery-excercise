import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, SchedulerModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
