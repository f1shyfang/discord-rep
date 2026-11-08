# UI/UX specification

The intended experience is a dense, familiar chat workspace: persistent server navigation, contextual channels, a dominant conversation pane and optional member context. The dimensions below are implementation targets. Product behavior is defined in [SDD](SDD.md).

## 1. Information architecture

| Route                                  | Screen                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `/sign-in`, `/sign-up`                 | Clerk authentication framed by original app branding                       |
| `/onboarding`                          | Handle, display name and avatar setup                                      |
| `/channels/@me`                        | Home: Friends tabs (Online, All, Pending, Blocked), Add Friend, recent DMs |
| `/channels/@me/:conversationId`        | 1:1 DM history and composer                                                |
| `/channels/:serverId/:channelId`       | Text conversation or voice participant view                                |
| `/invite/:token`                       | Minimal server preview and join action                                     |
| `/settings/:section`                   | Profile, appearance, notifications, voice/audio                            |
| `/servers/:serverId/settings/:section` | Overview, channels, roles, members, invites and bans                       |

Settings open as full-height views with a clear close/back target that restores focus. Server creation, invitation, channel editing and confirmations use accessible dialogs. Profile viewing uses a popover on desktop and sheet on mobile.

## 2. Desktop composition (≥1,024 px)

```text
┌────────┬──────────────────────┬──────────────────────────────────┬──────────────────┐
│ Home   │ Server name    ▾     │ # general   topic   search   ☷  │ Members          │
│────────│──────────────────────│──────────────────────────────────│                  │
│ server │ Category          ▾  │ Date / unread divider            │ Online           │
│ icons  │ # general            │ Avatar  Name · timestamp         │ avatar name      │
│        │ # projects           │         message / reply / file   │                  │
│   +    │ 🔊 Lounge            │                                  │ Offline          │
│        │   voice members      │            New messages ↓        │ avatar name      │
│        │                      │                                  │                  │
│        │ Voice connected      │ Reply / attachment preview       │                  │
│        │ Me   mic  audio  ⚙   │ + Message #general        emoji  │                  │
└────────┴──────────────────────┴──────────────────────────────────┴──────────────────┘
  72 px       240 px                 flexible, min 360 px              240 px
```

Header height 48 px. Server icons 48 px with 8 px gaps; current server has a clear left indicator and accessible selected state. Sidebar channel rows 32 px; conversation padding 16 px; message avatars 40 px. Member panel can be toggled and hidden at smaller widths. Bottom user panel stays visible; voice status appears above it while connected. Friends Home replaces server channels with DM navigation and the main pane with friend rows.

## 3. Visual system

| Token      | Default dark theme                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Background | Rail `#1E1F22`, sidebar `#2B2D31`, main `#313338`, composer `#383A40`                               |
| Text       | Primary `#F2F3F5`, secondary `#B5BAC1`; placeholders must meet required contrast                    |
| Action     | Accent `#5865F2`; destructive `#DA373C`; success `#23A55A`; validate actual foreground combinations |
| Type       | System sans; body 16/22 px, navigation 14/20, metadata 12/16, heading 20/28                         |
| Spacing    | 4 px base; 4, 8, 12, 16, 24, 32 px scale                                                            |
| Corners    | Controls 4–8 px; dialogs 12 px; avatars circular                                                    |
| Motion     | 120–180 ms opacity/transform; reduced-motion removes nonessential animation                         |

Theme colors are semantic CSS variables; light mode uses the same hierarchy and independently checked contrast. Presence uses a shape/label in addition to color. Original icons and generic seeded avatars replace proprietary artwork.

## 4. Message behavior

Group consecutive messages by the same author within five minutes unless separated by a day, unread divider, reply or system event. First row shows avatar/name/time; continuation reveals timestamp on hover and keyboard focus. Hover/focus toolbar offers react, reply and more; more contains edit/delete only when allowed. Touch uses an explicit menu button, not hover alone.

Enter sends; Shift+Enter inserts newline; composition events prevent sending during IME entry. Empty composer + ArrowUp edits the most recent editable own message. Escape cancels reply/edit before dismissing the view. Editing shows Save/Cancel and an edited marker after success. Delete opens confirmation. Render sanitized Markdown subset: emphasis, inline/fenced code, lists and links; no raw HTML or automatic remote link preview fetching.

Optimistic sends display pending status, then reconcile by client nonce. Failed messages retain text and attachments and expose Retry/Remove. Retry reuses the nonce; editing a failed draft creates a new nonce. Avoid duplicate rows when the websocket event arrives before the mutation response.

At bottom, incoming messages keep the viewport pinned. When reading older content, preserve scroll anchor and show a new-message button. Loading older pages preserves the first visible message's offset. Search jump loads a page around the result, highlights it temporarily and offers return to latest. If unread position predates retained history, show the earliest available point.

## 5. State inventory

| Surface      | Loading/empty                                         | Error/restricted                                             |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| App shell    | Stable column skeleton; first-run create/join actions | Session expired → sign-in; service outage → retry banner     |
| Channel list | Skeleton rows; no visible channels explanation        | Removed membership routes Home; private channel omitted      |
| Conversation | Message skeleton; “Start the conversation”            | Read-only composer with reason; failed page retry in place   |
| Friends/DMs  | Empty tab action; pending indicator                   | Request unavailable without leaking block status             |
| Upload       | Progress, cancel and scanning state                   | Size/type/scan error beside file; preserve other attachments |
| Invite       | Preview skeleton                                      | Invalid/expired/full message; already joined → Open server   |
| Voice        | Connecting and permission prompt                      | No microphone, network failure, disconnected/retry           |
| Search       | Searching/zero-results                                | Query error retry; inaccessible result removed               |

Avoid showing error toasts as the only explanation. Field errors stay beside controls; network state stays visible. Toasts announce successful ephemeral actions such as “Invite copied”. Browser notifications are not part of v1; in-app badges are.

## 6. Responsive behavior

At 768–1,023 px, hide the member panel by default; it opens as a right sheet. At <768 px show one main pane: Home/server navigation → channel list → conversation. A top-left Back button restores the previous pane without leaving voice. Navigation opens a drawer; members open a sheet. Minimum support width is 320 px; no horizontal page scrolling. Composer stays above the software keyboard using dynamic viewport sizing. Touch controls have at least 44×44 px hit areas even if their icon is smaller.

## 7. Accessibility and interaction

Use landmarks for server navigation, channel navigation, conversation and member list. Channel/server rows have text labels and selected state. Dialogs trap focus, provide a title, close on Escape where safe, and restore the invoking control. Do not steal focus when a message arrives. A polite live region announces incoming messages only for the active conversation and avoids flooding during history loads. Keyboard users can reach every hover action and attachment removal control.

Ctrl/Cmd+K opens a switcher over authorized servers/channels/DMs; Ctrl/Cmd+F focuses conversation search when chat owns focus. Skip shortcuts while typing unless explicitly scoped to the composer. Warn before discarding a changed settings form. All icon buttons include names; decorative avatars have empty alt text when adjacent names duplicate them. Files expose filename, size and status.

## 8. Design verification

Capture Home empty/populated, server chat, DM, role/channel settings, invite states, voice connected/failed, and mobile navigation at 1440, 1024, 768 and 390 px. Test 320 px overflow. Compare hierarchy, density, navigation order and interaction behavior with the reference; do not claim pixel accuracy without a supplied screenshot baseline. Check keyboard-only journeys, screen reader message announcements, 200% zoom, reduced motion and both themes.
