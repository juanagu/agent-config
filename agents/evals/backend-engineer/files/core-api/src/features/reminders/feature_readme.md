# reminders

Stores reminders a user schedules and emails them when due.

## Exposed interface

- Ports: `ReminderRepository`, `EmailSender` (`ports/`).
- Queue: `reminders` (BullMQ). Jobs named `send-reminder` are enqueued by the scheduler; the processor is not written yet.

## Data flow

Scheduler enqueues `send-reminder` with the reminder id and user id -> processor loads the reminder -> sends the email -> records `sentAt`.
