export abstract class TimeProvider {
  abstract now(): number;
  nowAsDate(): Date {
    return new Date(this.now());
  }
}
