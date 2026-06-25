import { Injectable } from '@nestjs/common';
import { TimeProvider } from './time-provider';

@Injectable()
export class MockTimeProvider extends TimeProvider {
  private currentTime: number = Date.now();

  setNow(ms: number): void {
    this.currentTime = ms;
  }

  now(): number {
    return this.currentTime;
  }
}
