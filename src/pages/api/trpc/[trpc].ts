import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

// export API handler
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError: ({ path, error, ctx }) => {
    if (error.code !== "INTERNAL_SERVER_ERROR") return;
    console.error(
      JSON.stringify({
        event: "api_error",
        route: path && /^[a-zA-Z.]+$/.test(path) ? path : "unknown",
        code: error.code,
        requestId: ctx?.requestId,
      }),
    );
  },
});
