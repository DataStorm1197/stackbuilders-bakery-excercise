import { Global, Module } from '@nestjs/common';
import { RealTimeProvider } from './real-time.provider';
import { TimeProvider } from './time-provider';

@Global()
@Module({
  providers: [
    {
      provide: TimeProvider,
      useClass: RealTimeProvider,
    },
  ],
  exports: [TimeProvider],
})
export class TimeProviderModule {}
