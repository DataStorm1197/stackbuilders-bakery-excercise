import { KitchenJobStatus, PriorityLevel } from '@prisma/client';

export class KitchenJob {
  id!: string;
  orderItemId!: string;
  priorityLevel!: PriorityLevel;
  bakeMinutes!: number;
  status!: KitchenJobStatus;
  ovenNumber!: number | null;
  slotNumber!: number | null;
  enqueuedAt!: Date;
  bakeStartedAt!: Date | null;
  estimatedDoneAt!: Date | null;
  bakeDoneAt!: Date | null;
}
