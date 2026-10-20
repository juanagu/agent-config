export interface Reminder {
  id: string;
  userId: string;
  message: string;
  sentAt: Date | null;
}

export interface ReminderRepository {
  findById(id: string): Promise<Reminder | null>;
  markSent(id: string, sentAt: Date): Promise<void>;
}
