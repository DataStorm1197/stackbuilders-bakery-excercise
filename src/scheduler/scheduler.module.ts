import { Module } from '@nestjs/common';
import { KitchenSchedulerService } from './kitchen-scheduler.service';

@Module({
  providers: [KitchenSchedulerService],
  exports: [KitchenSchedulerService],
})
export class SchedulerModule {}
