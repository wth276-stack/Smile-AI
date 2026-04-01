import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  async process(job: Job<{ reminderId: string }>) {
    this.logger.log(`Processing reminder: ${job.data.reminderId}`);

    // TODO: Implement reminder sending logic
    // 1. Fetch reminder from DB
    // 2. Determine delivery channel (push notification, email, etc.)
    // 3. Send notification
    // 4. Update reminder status to SENT
  }
}
