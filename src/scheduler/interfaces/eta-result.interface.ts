export interface EtaResult {
  jobId: string;
  estimatedReadyAt: Date;
  affectedJobs?: Array<{ jobId: string; estimatedReadyAt: Date }>;
}
