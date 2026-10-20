export interface EmailSender {
  /** Throws when the provider rejects or is unreachable. */
  send(input: { userId: string; subject: string; body: string }): Promise<void>;
}
