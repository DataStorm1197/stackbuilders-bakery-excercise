import { Injectable } from '@nestjs/common';
import { TimeProvider } from './time-provider';

@Injectable()
export class RealTimeProvider extends TimeProvider {
  now(): number {
    return Date.now();
  }
}
