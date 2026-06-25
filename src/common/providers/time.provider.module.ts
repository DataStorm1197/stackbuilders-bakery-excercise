import { Global, Module } from '@nestjs/common';
import { RealTimeProvider } from '../time/real-time.provider';
import { TimeProvider } from '../time/time-provider';

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
