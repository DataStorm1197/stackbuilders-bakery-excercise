import { Global, Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  PrometheusModule,
} from '@willsoto/nestjs-prometheus';

@Global()
@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
  ],
  providers: [
    makeCounterProvider({
      name: 'orders_placed_total',
      help: 'Total number of orders placed, labelled by priority level',
      labelNames: ['priority_level'],
    }),
    makeGaugeProvider({
      name: 'kitchen_queue_length',
      help: 'Current number of jobs waiting in the kitchen queue',
    }),
    makeGaugeProvider({
      name: 'oven_utilization',
      help: 'Fraction of oven slots currently in use (occupied slots / 6)',
    }),
  ],
  exports: [
    'PROM_METRIC_ORDERS_PLACED_TOTAL',
    'PROM_METRIC_KITCHEN_QUEUE_LENGTH',
    'PROM_METRIC_OVEN_UTILIZATION',
  ],
})
export class MetricsModule {}
