import { Module } from '@nestjs/common';
import { KitchenJobRepository } from './kitchen-job.repository';
import { KitchenSchedulerService } from './kitchen-scheduler.service';

@Module({
  providers: [KitchenSchedulerService, KitchenJobRepository],
  exports: [KitchenSchedulerService],
})
export class SchedulerModule {}
