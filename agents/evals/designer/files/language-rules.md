# Postwise: language rules (product docs, section 3)

UI language and content language are two independent settings, never one toggle.

- **UI language** (Settings > Language, English or Spanish): the language of every label, button, error and notice in the app.
- **Content language** (per brand, on the brand page): the language the brand's posts are written in. It can be English, Spanish, Portuguese or French.
- A draft's text is always shown in the brand's content language, whatever the UI language is. The text is the product, not interface copy, and is never translated for display.
- If a brand has no content language set, drafts use the default brand's content language; if that is unset too, English.

## Feature to design: draft review card

Calendar > tap a scheduled post opens the draft review screen. It shows the draft (text, optional image), the brand it belongs to, the publish date and time, and three actions: **Approve**, **Edit text**, **Reschedule**. Approve is the primary action.

Drafts can be long (up to 2,200 characters for some networks). A draft can be loading (the AI is still writing), empty (the AI failed to produce text), or failed to load.

The product owner has not decided how, or whether, the screen tells the user which language a draft is in.
