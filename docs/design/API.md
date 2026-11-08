# API interfaces

Proposed v1 contracts; none of these chat routers exist yet. Keep the repository's tRPC transport at `/api/trpc`, existing SuperJSON transformer, Clerk session context and Zod validation. Method names below are tRPC procedure names, not REST paths. Q means query, M means mutation. All methods require authentication except `invites.preview` and provider-authenticated webhook endpoints.

## 1. Common types and conventions

```ts
type ID = string; // UUID, validated at runtime
type UInt64 = string; // unsigned decimal bigint; never JS number
type ISODate = string; // UTC ISO-8601
type Cursor = string; // opaque signed cursor, bound to scope and recovery epoch
type Page<T> = { items: T[]; nextCursor: Cursor | null };
type ListInput = { cursor?: Cursor; limit?: number }; // default 50, max 100
type Ack = { ok: true };
type Versioned = { expectedVersion: number };
type PermissionMask = UInt64;

type User = {
  id: ID;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  status: "online" | "idle" | "dnd" | "offline";
};
type Server = {
  id: ID;
  name: string;
  iconUrl: string | null;
  ownerId: ID;
  authRevision: UInt64;
};
type Channel = {
  id: ID;
  serverId: ID;
  categoryId: ID | null;
  kind: "text" | "voice";
  name: string;
  topic: string;
  position: number;
  conversationId: ID | null;
  effectivePermissions: PermissionMask;
};
type Role = {
  id: ID;
  name: string;
  position: number;
  permissions: PermissionMask;
  color: string | null;
  isEveryone: boolean;
};
type Member = {
  user: User;
  nickname: string | null;
  roleIds: ID[];
  joinedAt: ISODate;
};
type Attachment = {
  id: ID;
  filename: string;
  sizeBytes: number;
  contentType: string;
};
type Message = {
  id: ID;
  conversationId: ID;
  seq: UInt64;
  author: User;
  clientNonce: ID;
  body: string;
  replyToId: ID | null;
  version: number;
  createdAt: ISODate;
  editedAt: ISODate | null;
  deletedAt: ISODate | null;
  attachments: Attachment[];
  mentions: ID[];
  reactions: { emoji: string; count: number; reactedByMe: boolean }[];
};
type Conversation = {
  id: ID;
  kind: "channel" | "dm";
  channelId: ID | null;
  peer: User | null;
};
type ReadSummary = {
  conversationId: ID;
  lastReadSeq: UInt64;
  unreadCount: number;
  mentionCount: number;
};
type Invite = {
  id: ID;
  serverId: ID;
  expiresAt: ISODate | null;
  maxUses: number | null;
  uses: number;
  revokedAt: ISODate | null;
};
type Upload = {
  id: ID;
  state:
    | "pending"
    | "uploaded"
    | "scanning"
    | "ready"
    | "attached"
    | "rejected"
    | "expired";
  failureCode: string | null;
};
```

These are documentation interfaces, not generated SDK code. UUID validation, limits and enum checks use Zod at the boundary. Body length is measured in Unicode code points. Missing optional fields leave values unchanged; explicit null clears nullable fields. IDs are application UUIDs, never client-supplied Clerk identity substitutes. Dates and bigint fields retain the above wire representation even through SuperJSON.

Return only public/profile-safe fields: no clerk_id, object keys, invite hashes or internal provider IDs. `User.status` is viewer-specific; invisible serializes as offline, while `users.me` also returns the owner's saved status preference. Deleted messages serialize empty body/attachments/mentions/reactions.

Queries are side-effect-free except ordinary access telemetry. Mutations derive actor identity from context. Each authenticated query filters authorization before pagination/counting. Foreign/private resource IDs return NOT_FOUND rather than confirming existence; an action forbidden on a visible resource returns FORBIDDEN. Cross-origin mutations fail Origin/CSRF policy. Cursor from a different resource fails BAD_REQUEST.

## 2. Identity and navigation

| Procedure            | Input                                                                  | Output / authorization                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users.me Q           | `{}`                                                                   | `{user:User,statusPreference,theme,onboardingComplete}`; ensure profile projection before onboarding                                                                                                    |
| users.update M       | `{handle?,displayName?,bio?,avatarUploadId?,statusPreference?,theme?}` | `User`; own profile only, handle uniqueness enforced                                                                                                                                                    |
| users.findByHandle Q | `{handle}`                                                             | `{user:User                                                                                                                                                                                             | null}`; exact lookup, rate limited; blocked/unavailable → null |
| bootstrap.get Q      | `{}`                                                                   | `{me:User,servers:Server[],initialDmPage:Page<Conversation>,readSummaries:ReadSummary[],recoveryEpoch:string}`; joined-server ceiling bounds server list, read summaries only for visible conversations |

Avatar/icon uploads use the separate asset contract below, not conversation attachments. Authentication sign-in/recovery uses Clerk's UI/SDK rather than new password endpoints.

## 3. Servers, channels and moderation

| Procedure                  | Input                                                        | Output / authorization                                                            |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| servers.list Q             | `ListInput`                                                  | `Page<Server>`; memberships only                                                  |
| servers.create M           | `{requestId:ID,name,iconUploadId?}`                          | `{server:Server,defaultChannel:Channel}`                                          |
| servers.get Q              | `{serverId}`                                                 | `{server:Server,categories:Category[],channels:Channel[]}`; visible channels only |
| servers.update M           | `{serverId,name?,iconUploadId?,expectedAuthRevision:UInt64}` | `Server`; MANAGE_SERVER                                                           |
| servers.transferOwner M    | `{serverId,userId,expectedAuthRevision}`                     | `Server`; owner only, existing member                                             |
| servers.leave M            | `{serverId}`                                                 | `Ack`; not owner                                                                  |
| servers.delete M           | `{serverId,confirmationName}`                                | `Ack`; owner, soft-delete then purge                                              |
| categories.create M        | `{requestId,serverId,name}`                                  | `Category`; MANAGE_CHANNELS                                                       |
| categories.update M        | `{categoryId,name,expectedAuthRevision}`                     | `Category`; MANAGE_CHANNELS                                                       |
| categories.delete M        | `{categoryId,expectedAuthRevision}`                          | `Ack`; move children to uncategorized atomically                                  |
| channels.create M          | `{requestId,serverId,categoryId?,name,kind}`                 | `Channel`; MANAGE_CHANNELS                                                        |
| channels.update M          | `{channelId,name?,topic?,categoryId?,expectedAuthRevision}`  | `Channel`; cannot change kind                                                     |
| channels.reorder M         | `{serverId,orderedCategoryIds:ID[],groups:{categoryId:ID     | null,channelIds:ID[]}[],expectedAuthRevision}`                                    | `Ack`; exact full set with no duplicate/foreign IDs; MANAGE_CHANNELS        |
| channels.delete M          | `{channelId,expectedAuthRevision}`                           | `Ack`; MANAGE_CHANNELS, revoke immediately                                        |
| members.list Q             | `{serverId,...ListInput}`                                    | `Page<Member>`; membership required                                               |
| members.setRoles M         | `{serverId,userId,roleIds:ID[],expectedAuthRevision}`        | `Member`; MANAGE_ROLES and hierarchy                                              |
| members.kick M             | `{serverId,userId,reason?}`                                  | `Ack`; KICK_MEMBERS and hierarchy                                                 |
| members.ban M              | `{serverId,userId,reason?}`                                  | `Ack`; BAN_MEMBERS and hierarchy                                                  |
| bans.list Q                | `{serverId,...ListInput}`                                    | `Page<{user:User,reason:string                                                    | null,createdAt:ISODate}>`; BAN_MEMBERS                                      |
| bans.remove M              | `{serverId,userId}`                                          | `Ack`; BAN_MEMBERS                                                                |
| roles.list Q               | `{serverId}`                                                 | `Role[]`; member; capped 20                                                       |
| roles.create M             | `{requestId,serverId,name,permissions,color?}`               | `Role`; MANAGE_ROLES, no escalation                                               |
| roles.update M             | `{roleId,name?,permissions?,color?,expectedAuthRevision}`    | `Role`; MANAGE_ROLES and hierarchy                                                |
| roles.reorder M            | `{serverId,roleIds:ID[],expectedAuthRevision}`               | `Ack`; exact role list, everyone remains lowest, cannot move roles above actor    |
| roles.delete M             | `{roleId,expectedAuthRevision}`                              | `Ack`; MANAGE_ROLES/hierarchy; everyone protected                                 |
| channels.setOverwrite M    | `{channelId,target:{kind:'role'                              | 'member',id:ID},allow:PermissionMask,deny:PermissionMask,expectedAuthRevision}`   | `Ack`; MANAGE_ROLES plus MANAGE_CHANNELS, no escalation; same-server target |
| channels.removeOverwrite M | `{channelId,target,expectedAuthRevision}`                    | `Ack`; same authorization as set                                                  |
| audit.list Q               | `{serverId,...ListInput}`                                    | `Page<AuditEvent>`; MANAGE_SERVER                                                 |

`Category = {id,serverId,name,position}`. `AuditEvent = {id,actorId:ID|null,action,targetId:ID|null,metadata:Record<string,unknown>,createdAt}`; metadata is allowlisted per action and excludes sensitive content. All configuration changes bump authRevision; expectedAuthRevision protects full-list/replacement operations against lost updates.

## 4. Invitations and social

| Procedure         | Input                                      | Output / authorization                                                                                           |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| invites.create M  | `{requestId,serverId,expiresInSeconds:3600 | 86400                                                                                                            | 604800                            | null,maxUses:number      | null}`                                | `{invite:Invite,url:string | null}`; CREATE_INVITE; raw token returned only for initial creation, retry returns invite metadata with `url:null` |
| invites.preview Q | `{token}`                                  | `{serverName,iconUrl,memberCount,expiresAt}`; public, minimal, generic invalid for banned/private-state failures |
| invites.accept M  | `{token}`                                  | `{server:Server,channelId:ID                                                                                     | null}`; authenticated, not banned |
| invites.list Q    | `{serverId,...ListInput}`                  | `Page<Invite>`; MANAGE_SERVER                                                                                    |
| invites.revoke M  | `{inviteId}`                               | `Ack`; creator or MANAGE_SERVER                                                                                  |
| friends.list Q    | `{tab:'online'                             | 'all'                                                                                                            | 'pending'                         | 'blocked',...ListInput}` | `Page<{user:User,direction:'incoming' | 'outgoing'                 | null,status:'pending'                                                                                              | 'accepted' | 'blocked'}>` |
| friends.request M | `{handle}`                                 | `Ack`; no self/block; existing pending/accepted idempotent; reverse pending requires explicit accept             |
| friends.respond M | `{userId,action:'accept'                   | 'decline'}`                                                                                                      | `Ack`; only request recipient     |
| friends.remove M  | `{userId}`                                 | `Ack`; removes accepted friendship or cancels own outgoing request                                               |
| blocks.set M      | `{userId,blocked:boolean}`                 | `Ack`; block removes friendship/pending, revokes DM send and presence                                            |
| dm.open M         | `{userId}`                                 | `Conversation`; existing accessible DM or new friend-only canonical pair                                         |
| dm.list Q         | `ListInput`                                | `Page<Conversation>`; own DMs, most recent activity first                                                        |

Invite tokens are sensitive; redact inputs from logs. A banned authenticated user cannot accept, but public preview is deliberately minimal and not an authorization check. `maxUses` is 1–1000 or null. Decline/cancel deletes the pending row. Removing a friend does not delete the conversation.

## 5. Messaging, reads and search

| Procedure         | Input                                                                       | Output / authorization                                                                                 |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| messages.list Q   | `{conversationId,cursor?,limit?}`                                           | `Page<Message>`; VIEW_CHANNEL or DM participant; latest/backward pages                                 |
| messages.around Q | `{conversationId,messageId}`                                                | `{items:Message[],beforeCursor:Cursor                                                                  | null,afterCursor:Cursor   | null}`; max 51 |
| messages.send M   | `{conversationId,clientNonce:ID,body:string,replyToId?:ID,uploadIds?:ID[]}` | `Message`; SEND_MESSAGES or unblocked DM participant                                                   |
| messages.edit M   | `{messageId,body,expectedVersion}`                                          | `Message`; author, undeleted; keeps attachments and reparses mentions                                  |
| messages.delete M | `{messageId,expectedVersion}`                                               | `Message`; author or MANAGE_MESSAGES; tombstone                                                        |
| reactions.set M   | `{messageId,emoji:string,present:boolean}`                                  | `{messageId,version:number,reactions:Message['reactions']}`; ADD_REACTIONS or unblocked DM participant |
| reads.ack M       | `{conversationId,seq:UInt64}`                                               | `ReadSummary`; monotonic, bounded visible message                                                      |
| reads.summary Q   | `{conversationIds:ID[]}`                                                    | `ReadSummary[]`; max 100, authorized IDs only                                                          |
| search.messages Q | `{conversationId,query:string,cursor?,limit?}`                              | `Page<Message>`; query 2–200 code points, authorization in query                                       |
| preferences.set M | `{conversationId,notificationMode:'all'                                     | 'mentions'                                                                                             | 'none',mutedUntil:ISODate | null}`         | `Ack`; own authorized conversation |
| preferences.get Q | `{conversationId}`                                                          | `{notificationMode,mutedUntil}`                                                                        |

Mutation response and subsequent event refer to the same message ID/version. `clientNonce` uniqueness is conversation + author; identical retry returns original committed row; changed payload using same nonce returns CONFLICT. Opaque history cursors encode direction. Search ordering is descending sequence, not changing relevance scores. Mention syntax is `<@UUID>`; server parses only accessible users. Unknown targets render plain text and create no badge.

Example logical send input/output (shown without tRPC transport envelope):

```json
{
  "conversationId": "00000000-0000-4000-8000-000000000001",
  "clientNonce": "00000000-0000-4000-8000-000000000002",
  "body": "Hello everyone",
  "uploadIds": []
}
```

Response includes assigned `id`, `seq: "42"`, `version: 1`, the same `clientNonce`, server timestamp and normalized body. Browser renders pending until this acknowledgement or an authorized delta supplies that row.

## 6. Files and assets

| Procedure          | Input                                                                | Output                                                                          |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| uploads.reserve M  | `{requestId,conversationId,filename,contentType,sizeBytes,checksum}` | `{upload:Upload,putUrl:string,headers:Record<string,string>,expiresAt:ISODate}` |
| uploads.complete M | `{uploadId}`                                                         | `Upload`; verifies actual bytes, starts scan; repeated call safe                |
| uploads.get Q      | `{uploadId}`                                                         | `Upload`; uploader only until attached, then authorized readers                 |
| uploads.cancel M   | `{uploadId}`                                                         | `Ack`; uploader, only unattached                                                |
| uploads.download Q | `{uploadId}`                                                         | `{url:string,expiresAt:ISODate}`; visible undeleted attached message only       |
| assets.reserve M   | `{requestId,purpose:'avatar'                                         | 'serverIcon',serverId?:ID,filename,contentType,sizeBytes,checksum}`             | `{assetUploadId:ID,putUrl,headers,expiresAt}`; owner for avatar, MANAGE_SERVER for icon |
| assets.complete M  | `{assetUploadId}`                                                    | `{assetUploadId,state:'scanning'                                                | 'ready'                                                                                 | 'rejected',failureCode:string | null}` |
| assets.get Q       | `{assetUploadId}`                                                    | Same state response; creator/authorized server manager                          |

Asset persistence is `asset_uploads` in schema.sql, separate from conversation files. Limit assets to 2 MiB JPEG/PNG/WebP; decode and re-encode before ready. Profile/server updates consume ready assets reserved for the correct purpose and server. Serve approved asset derivatives from private storage through authorized short-lived URLs; no arbitrary client URLs or keys. Assets use the same staging/final-key immutability rule and 24-hour orphan cleanup. Attachments allow raster images, text, PDF and ZIP subject to scan; default download disposition for non-images. Production must provision a working scanner before enabling uploads.

## 7. Realtime protocol

`realtime.ticket M {}` returns `{ticket:string,expiresAt:ISODate,websocketUrl:string}`. Client upgrades only to configured `wss:` gateway and sends an auth frame. Initial auth deadline 5 seconds. Ticket: one use, TTL 60 seconds, bound to session/origin. Tickets are never stored in browser persistent storage.

```ts
type ClientFrame =
  | { op: "authenticate"; ticket: string; protocolVersion: 1 }
  | { op: "subscribe"; conversationIds: ID[] } // max 10, independently authorized
  | { op: "unsubscribe"; conversationIds: ID[] }
  | { op: "typing"; conversationId: ID; active: boolean }
  | { op: "heartbeat"; at: ISODate };

type Change = {
  eventId: ID;
  conversationId: ID;
  eventSeq: UInt64;
  type:
    | "message.created"
    | "message.updated"
    | "message.deleted"
    | "reaction.updated";
  entityId: ID;
  entityVersion: number;
};
type ServerFrame =
  | { op: "ready"; connectionId: ID; heartbeatSeconds: 25 }
  | { op: "changed"; change: Change }
  | {
      op: "refresh";
      scope: "servers" | "friends" | "reads" | "profile" | "voice";
      resourceId?: ID;
    }
  | { op: "typing"; conversationId: ID; userId: ID; expiresAt: ISODate }
  | { op: "presence"; userId: ID; status: User["status"] }
  | { op: "access.revoked"; conversationId: ID }
  | { op: "heartbeat.ack"; at: ISODate }
  | { op: "error"; code: string; retryable: boolean };
```

Gateway frames are hints; durable message bodies arrive through authorized API reads. Permission-sensitive typing/presence require current recipient authorization, not only subscribe-time authorization. Conversation events have ordered durable sequences; personal/server refresh hints are not ordered and never used as authoritative state. On reconnect always refetch bootstrap, read summaries and active conversation snapshot/delta; this recovers missed personal updates. Gateway delivery is at least once and may be out of order.

| Procedure       | Input                                         | Output                                                                                                  |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| sync.snapshot Q | `{conversationId}`                            | `{conversation:Conversation,messages:Message[],read:ReadSummary,eventCursor:Cursor,historyCursor:Cursor | null}`; one consistent DB snapshot                   |
| sync.delta Q    | `{conversationId,after:Cursor,limit?:number}` | `{changes:{event:Change,message:Message                                                                 | null}[],nextCursor:Cursor,hasMore:boolean}`; max 100 |

Delta materializes the **current** authorized entity version, not historical deleted bodies. Tombstones are included. A cursor older than seven-day retention or with wrong recovery epoch returns RESET_REQUIRED. Start by buffering subscription hints, load snapshot, replay after its watermark, then follow hints. All access checks run again for snapshot/delta. Use poll fallback when sockets fail.

## 8. Voice and external adapters

| Procedure            | Input                                           | Output                                                                                           |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| voice.join M         | `{channelId,listenOnly:boolean,requestId:ID}`   | `{sessionId:ID,roomId:string,endpoint:string,token:string,expiresAt:ISODate,canPublish:boolean}` |
| voice.state M        | `{sessionId,selfMute:boolean,selfDeaf:boolean}` | `{selfMute,selfDeaf,serverMute:boolean}`                                                         |
| voice.heartbeat M    | `{sessionId}`                                   | `{leaseExpiresAt:ISODate}`; every 25 s; expires after 75 s                                       |
| voice.leave M        | `{sessionId}`                                   | `Ack`; idempotent own-session revoke                                                             |
| voice.participants Q | `{channelId}`                                   | `{user:User,selfMute:boolean,selfDeaf:boolean,serverMute:boolean}[]`                             |
| voice.serverMute M   | `{sessionId,muted:boolean}`                     | `Ack`; MANAGE_CHANNELS plus hierarchy                                                            |

```ts
interface VoiceProvider {
  issueCredential(input: {
    userId: ID;
    channelId: ID;
    sessionId: ID;
    canPublish: boolean;
    expiresAt: ISODate;
    participantLimit: 25;
  }): Promise<{ endpoint: string; roomId: string; token: string }>;
  revokeSession(sessionId: ID): Promise<void>;
  setPublishAllowed(sessionId: ID, allowed: boolean): Promise<void>;
}
interface FileScanner {
  scan(input: { objectKey: string; checksum: string }): Promise<{
    verdict: "clean" | "rejected";
    detectedType: string;
    reasonCode?: string;
  }>;
}
```

Provider endpoints: `POST /api/webhooks/clerk` (verified raw-body signature, event dedupe/event-time checks); `POST /api/webhooks/voice` (provider signature, timestamp and replay checks); internal scanner callback/worker invocation (service authentication, immutable object checksum binding). Return 2xx only once processing is durably recorded or safely queued; retryable failures return 5xx. Never trust a browser to assert provider session status or scan verdict. Provider signing formats are chosen with the actual integration, not invented here.

## 9. Errors, quotas and versioning

Use standard tRPC errors plus `data.appCode`, `data.requestId`, optional `data.fieldErrors`, `data.retryAfterMs`, and `data.currentVersion`. Do not return SQL/internal exception text.

| tRPC code             | appCode examples                                                               | Client behavior                                  |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| UNAUTHORIZED          | SESSION_EXPIRED                                                                | Reauthenticate, retain safe local draft          |
| FORBIDDEN             | MISSING_PERMISSION, DM_UNAVAILABLE                                             | Disable action, refresh capabilities             |
| NOT_FOUND             | RESOURCE_NOT_FOUND, INVITE_UNAVAILABLE                                         | Remove stale navigation or show invite failure   |
| BAD_REQUEST           | VALIDATION_FAILED, INVALID_CURSOR, FILE_TOO_LARGE                              | Inline field/action error                        |
| CONFLICT              | VERSION_CONFLICT, NONCE_REUSED, INVITE_EXHAUSTED, RESET_REQUIRED, HANDLE_TAKEN | Refetch/resolve; reset snapshot for stale replay |
| TOO_MANY_REQUESTS     | RATE_LIMITED, QUOTA_EXCEEDED                                                   | Honor retryAfterMs; preserve input               |
| INTERNAL_SERVER_ERROR | TEMPORARY_FAILURE                                                              | Generic retry UI; correlate requestId            |

Initial product rate limits: 5 sends/sec/user burst 10, 30 sends/min/conversation/user; 10 friend requests/hour; 10 invite attempts/min/IP and user; 20 searches/min/user; 5 upload reservations/min/user; websocket typing once/3 s/conversation. Apply shared atomic rate limits, not per-process counters. Start with 100 MiB/day/user upload reservation quota and 500 MiB retained storage/user; release reservations on reject/cancel/expiry and decrement retained usage on purge. These are adjustable product defaults, not provider limits.

tRPC HTTP envelopes, batching, transformer and error handling remain the installed library's responsibility. Client/server ship together for v1; websocket uses protocolVersion=1. Add optional response fields compatibly; version breaking input/event changes and keep old gateway protocol during rollout. Export runtime Zod DTOs and infer client types from the implemented router instead of maintaining a second hand-written SDK.
