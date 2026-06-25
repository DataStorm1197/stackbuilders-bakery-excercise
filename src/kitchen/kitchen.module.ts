import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

@Module({
  imports: [SchedulerModule],
  controllers: [KitchenController],
  providers: [KitchenService],
})
export class KitchenModule {}
