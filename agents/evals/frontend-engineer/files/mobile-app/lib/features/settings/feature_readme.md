# settings

Purpose: administrative preferences (language, privacy) reached from the profile tab.

Exposed interface: `SettingsFeature.screen()`; the screen takes callbacks, it never navigates.

Data flow: tiles are `AppListTile`s from `application/ui`; each row is a label plus a chevron. Sign-out and account deletion are out of scope here (no session port exists in this app yet).
