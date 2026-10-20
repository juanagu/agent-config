# Postwise: current app structure

Postwise helps small shops plan and write their social posts with an AI assistant. Web app (Next.js), mobile-first.

## Navigation today

- Bottom tabs on phone, left rail on desktop: **Home**, **Calendar**, **Brands**.
- Top-right avatar menu: **Settings**, **Help**, **Sign out**.

## Screens

- **Brands** lists the user's brands. A brand page holds: name, logo, content language (the language its posts are written in), and its connected social accounts.
- **Settings** is a hub of rows, each opening a focused page:
  - Login & security
  - Notifications
  - Language (the language of the app interface, English or Spanish)
  - Billing
  - Privacy
- **Calendar** shows scheduled posts; tapping one opens the draft review screen.

## Ticket #212 (from the product owner)

> **Brand voice.** Each brand gets a voice the AI writes in: tone (friendly / formal / playful), target audience (free text), up to 3 sample posts the brand liked, words to avoid, and the writing language. Add this as a new "Brand voice" section in Settings, since Settings is where configuration lives. Nothing else about the screen is decided.

## Notes

- A user with several brands has a different voice per brand.
- Users have said in interviews: "I want the posts to sound like me", "where do I tell it about my shop?"
- Existing primitives in `src/shared/ui/`: Button, Field, FormErrorMessage, SummaryRow (label, value, explicit Edit), PageHeader, Chip.
