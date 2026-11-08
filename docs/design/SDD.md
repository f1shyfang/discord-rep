# Software Design Document

Version 1.0 · Proposed · 8 November 2026

## 1. Objective

Build a responsive community chat app whose basic flows feel familiar to Discord users: authenticate, find friends, create/join a server, navigate channels, exchange messages, start direct conversations, and join voice. Prioritize coherent end-to-end behavior over an exhaustive feature clone.

Personas: visitor receiving an invite; member participating in chat; owner arranging a community; moderator managing channels and members. Owners are members with additional authority, not a separate account type.

## 2. Scope and requirements

P0 is the text-chat foundation. P1 completes the basic replica, including voice; the full baseline is not complete until both ship. P2 is explicitly excluded from this baseline.

| ID          | Priority | Requirement and acceptance criterion                                                                                                                                                        |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01     | P0       | Clerk sign-up/sign-in/sign-out and recovery; successful auth returns to a validated local destination, including a pending invite. Anonymous access never loads private content.            |
| PROFILE-01  | P0       | Unique lowercase handle, display name, avatar and status preference; profile setup completes before entering chat. Invalid/duplicate handles show inline errors.                            |
| SERVER-01   | P0       | Create server atomically with owner membership, everyone role, general text channel and Lounge voice channel. New server opens general.                                                     |
| INVITE-01   | P0       | Create, preview, revoke and accept invitations; expiration, ban and maximum-use checks are authoritative; concurrent final-use joins admit at most one new member. Rejoining is idempotent. |
| NAV-01      | P0       | Home/server rail, categorized channel list, chat pane, optional member list, settings. Deep links restore the selected authorized destination.                                              |
| CHAT-01     | P0       | Send, paginate, reply, edit own messages, delete own messages and Unicode react in server text channels and 1:1 DMs. Refresh preserves acknowledged messages; retries do not duplicate.     |
| FILE-01     | P0       | Attach up to 4 files per message, each at most 10 MiB. Show upload/scanning/error states; only validated clean attachments can be sent/downloaded.                                          |
| SOCIAL-01   | P0       | Exact-handle friend request, accept/decline/cancel/remove, block/unblock, and a reusable 1:1 DM. New DM creation requires friendship. Blocking prevents further sends in both directions.   |
| LIVE-01     | P0       | New/edited/deleted messages, reactions, membership and permission changes synchronize across authorized clients; typing expires; disconnected clients reconcile durable state.              |
| READ-01     | P0       | Per-conversation read position, unread indicators and user-mention badges. Read state advances only while visible and at the latest loaded messages.                                        |
| ADMIN-01    | P0       | Owner creates/reorders categories and text/voice channels, manages roles and channel overwrites; authorized moderators remove messages and kick/ban lower-ranked members.                   |
| SEARCH-01   | P1       | Search text within one authorized text channel or DM, with cursor paging and jump to result. Deleted and inaccessible messages never appear.                                                |
| PRESENCE-01 | P1       | Online/idle/DND/invisible preference and multi-device presence; invisible appears offline to others. Blocked users receive no presence updates.                                             |
| VOICE-01    | P1       | Drop into server voice channel, choose microphone/output where supported, mute/deafen, see speakers, disconnect; permission denial and failed media connection are recoverable.             |
| SETTINGS-01 | P1       | Profile, appearance, notification preference, audio device controls and logout; per-channel mute and mention-only notifications persist.                                                    |
| ACCESS-01   | P0       | All core flows support keyboard and screen reader operation, visible focus, reduced motion, readable contrast, and narrow/mobile layouts.                                                   |

P2: video, screenshare, DM/group calls, group DMs, threads/forums, stages, bots, slash commands, webhooks for third parties, custom emoji, rich external link previews, public server discovery, subscriptions, boosts, native mobile/desktop apps and push/email notifications. Channel categories organize navigation but do not inherit permissions in v1; each channel owns its overwrites. No user @everyone or role mentions in v1.

## 3. End-to-end journeys

| Flow                | Main steps                                                                                                | Alternate outcomes                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| First session       | Sign up → verify identity → choose profile → Home empty state → create server or enter invite             | Auth error retains local return path; duplicate handle suggests editing it; cancelled setup resumes later                                 |
| Create community    | Rail + → create dialog → name/icon → submit → general channel → invite dialog → copy link                 | Retry with same request ID returns original server; upload failure does not discard name                                                  |
| Join community      | Open invite → preview name/icon/member count → authenticate if needed → join → first visible text channel | Invalid/expired/full invite explains failure; already member navigates directly; no visible channel shows authorized empty state          |
| Chat                | Select channel → latest 50 messages → type/attach/reply → send → optimistic row → acknowledgement         | Failed send retains draft/retry; permission removal disables send and clears inaccessible cache; deleted reply target renders unavailable |
| Direct conversation | Home → Friends → Add Friend → request → recipient accepts → Message → DM                                  | Unknown handle yields generic not-available response; blocked relationship prevents requests/sends; duplicate opens same DM               |
| Moderate            | Member menu → kick/ban or role editor; message menu → delete                                              | Owner cannot be kicked; actor cannot moderate equal/higher role; failure retains dialog and explains permitted action                     |
| Voice               | Select voice channel → microphone permission → connect → speaking indicators → mute/deafen → disconnect   | Denied microphone allows listen-only with explanation; connection failure offers retry; leaving server terminates session                 |
| Return/reconnect    | Restore last authorized channel → fetch snapshot → subscribe/reconcile → render unread divider            | Expired replay window forces fresh snapshot; inaccessible remembered route returns to Home                                                |

## 4. Product rules

Server names: 2–100 characters; channel/category names: 1–100; handle: 3–32 ASCII lowercase letters/digits/underscore; display name: 1–80; bio: 0–190. Message body: 0–2,000 Unicode code points, nonempty text or at least one ready attachment. Server/channel topics: 0–1,024. Names and message text are never evaluated as HTML.

Proposed v1 ceilings: 100 joined servers/user, 100 channels/server, 20 roles/server, 1,000 members/server and 25 simultaneous participants/voice channel. Enforce limits in serialized transactions where concurrent additions could exceed them. These are our product limits, not Discord's limits.

DM history remains available after removing friendship; sending continues unless either side blocks. Blocking removes friendship/pending requests, prevents new DMs and sends, hides presence, and collapses shared-server messages locally; it does not remove shared-server access. Ban removes server membership, blocks rejoin and ends voice/realtime access. Unban permits a future invite; it does not restore membership.

Owner must transfer ownership to an existing member before leaving. Server deletion requires confirmation by name. Deleted channels and servers immediately become inaccessible and enter asynchronous purge. Deleted messages retain a tombstone with body removed and attachments inaccessible. No visible read receipts for other users in v1.

## 5. Quality targets

Targets are proposed acceptance budgets, not measured capabilities. Test with 1,000 concurrent clients, 100 aggregate messages/sec for 10 minutes, 1 million seeded messages and a 1,000-member server. Region-local measurements exclude user network transit unless stated.

| Quality       | Release target                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Durability    | No acknowledged write lost during worker failure; exactly one stored send per client nonce          |
| Latency       | p95 message acknowledgement ≤500 ms; authorized fanout ≤1 s after commit; latest-page query ≤300 ms |
| Web UX        | Interactive app shell ≤3 s on defined mid-range mobile/4G test profile; optimistic row ≤100 ms      |
| Voice         | p95 connection ≤5 s on supported network; establish audio through TURN when peer connectivity fails |
| Availability  | Design goal 99.9% monthly for text operations; measure separately from voice                        |
| Recovery      | Proposed RPO ≤15 min and RTO ≤4 h, contingent on verified backup plan and restore drill             |
| Accessibility | WCAG 2.2 AA target, keyboard journeys and screen reader review before release                       |

## 6. Delivery and traceability

| Stage                  | Requirements                      | Build and verification gate                                                                          |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1: shell and identity  | AUTH, PROFILE, NAV, ACCESS        | Responsive routes, Clerk return flow, local user projection, empty/loading/error states              |
| 2: communities         | SERVER, INVITE, ADMIN             | Schema, membership/permission evaluator, concurrency and cross-server access tests                   |
| 3: messaging           | CHAT, FILE, SOCIAL                | Transactional send, upload validation, friends/DM lifecycle; two-browser persisted chat              |
| 4: synchronization     | LIVE, READ                        | Outbox/gateway, reconnection, revocation, unread and mention reconciliation under injected failures  |
| 5: baseline completion | SEARCH, PRESENCE, VOICE, SETTINGS | Search authorization, audio integration, device failures, blocked-user behavior and performance gate |

Service ownership, transactions and test cases are in [LLD](LLD.md). Schema and API changes must be reviewed against these requirement IDs. Release requires multi-user browser verification: owner, ordinary member, outsider, blocked friend and moderator; desktop and mobile viewport coverage.

## 7. Assumptions and risks

This is a standalone application with its own accounts/data, not a client for Discord accounts or servers. Single primary write region is sufficient for the baseline. Voice hosting/provider and final app name remain open. Permissions and reconnect correctness carry more risk than static UI fidelity; test them before expanding feature scope. Provider outages must show truthful degraded states without falsely acknowledging writes.
