# Notes from the founder: "ClassSpot" (boutique fitness class booking)

Idea: a booking app for independent yoga / pilates / spin studios in mid-size Spanish cities. Studios currently take bookings by WhatsApp and a spreadsheet. Founder is a former studio owner, bootstrapped, launching alone with one part-time developer, wants paying studios within 4 months.

## "MVP" must-haves (founder's list)

1. Studio sign-up and profile page
2. Class schedule builder (recurring classes, instructors, rooms)
3. Customer sign-up / login (email + Google)
4. Customers browse classes and book a spot
5. Waitlist with auto-promote when someone cancels
6. Cancellation with a 12h cutoff and late-cancel fee
7. Class packs and monthly memberships (Stripe Connect payouts to studios)
8. Instructor app with check-in by QR code
9. Push notifications and email reminders
10. Studio dashboard: revenue, attendance, retention
11. Discount codes and referral rewards
12. Reviews and ratings for classes and instructors
13. Gift cards
14. Multi-location studios and staff roles
15. Public marketplace page where customers discover studios by city
16. Live spot availability (the dev wants WebSockets for this)

## Other things the founder said

- Studios pay a monthly SaaS fee; founder is open to a small per-booking cut too but is unsure.
- Main competitor the studios mention: a big international booking platform that they find expensive and English-first.
- "Customers must be able to book in under a minute, otherwise they go back to WhatsApp."
- The dev says he'd build it as one Next.js app with MongoDB to go fast; founder wants to know if that is fine.
