import { activityRouter } from "./routers/activity";
import { usersRouter } from "./routers/users";
import { serversRouter } from "./routers/servers";
import { channelsRouter } from "./routers/channels";
import { invitesRouter } from "./routers/invites";
import { moderationRouter } from "./routers/moderation";
import { dmRouter, friendsRouter } from "./routers/social";
import {
  messagesRouter,
  readsRouter,
  searchRouter,
  syncRouter,
  preferencesRouter,
} from "./routers/messages";
import { storageRouter } from "~/server/api/routers/storage";
import { postRouter } from "~/server/api/routers/post";
import { createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  post: postRouter,
  activity: activityRouter,
  users: usersRouter,
  servers: serversRouter,
  channels: channelsRouter,
  invites: invitesRouter,
  moderation: moderationRouter,
  friends: friendsRouter,
  dm: dmRouter,
  messages: messagesRouter,
  reads: readsRouter,
  search: searchRouter,
  sync: syncRouter,
  preferences: preferencesRouter,
  storage: storageRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
