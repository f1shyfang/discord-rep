import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "~/server/api/root";
import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

test.describe("multi-user community and DM journeys", () => {
  const suffix = randomUUID().slice(0, 8);
  const accounts: {
    id: string;
    email: string;
    handle: string;
    name: string;
  }[] = [];
  let backend: ReturnType<typeof createClerkClient>;
  test.beforeAll(async () => {
    if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
      throw new Error("Development Clerk keys required.");
    await clerkSetup();
    backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    for (const role of ["owner", "member", "outsider"]) {
      const email = `gather_${role}_${suffix}+clerk_test@example.com`;
      const user = await backend.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
      });
      accounts.push({
        id: user.id,
        email,
        handle: `${role}_${suffix}`,
        name: `Test ${role}`,
      });
    }
  });
  test.afterAll(async () => {
    for (const account of accounts) await backend.users.deleteUser(account.id);
  });
  async function signIn(
    browser: Browser,
    index: number,
    mobile = false,
  ): Promise<{ page: Page; context: BrowserContext }> {
    const context = await browser.newContext({
      baseURL: "http://localhost:3107",
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 960 },
    });
    const page = await context.newPage();
    await setupClerkTestingToken({ page });
    await page.goto("/channels/@me");
    await clerk.signIn({ page, emailAddress: accounts[index]!.email });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Make yourself at home" }),
    ).toBeVisible();
    await page.getByLabel("Display name").fill(accounts[index]!.name);
    await page.getByLabel("Unique handle").fill(accounts[index]!.handle);
    await page.getByRole("button", { name: "Continue to Gather" }).click();
    await expect(
      page.getByRole("heading", { name: "Friends", exact: true }),
    ).toBeVisible();
    return { page, context };
  }
  function browserApi(page: Page) {
    return createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "http://localhost:3107/api/trpc",
          transformer: superjson,
          fetch: async (url, init) => {
            const response = await page.request.fetch(String(url), {
              method: init?.method,
              headers: Object.fromEntries(new Headers(init?.headers)),
              data: init?.body as string | undefined,
            });
            return new Response(await response.text(), {
              status: response.status(),
              headers: response.headers(),
            });
          },
        }),
      ],
    });
  }
  test("creates, invites, chats, recovers, moderates and exchanges blocked DMs", async ({
    browser,
  }, testInfo) => {
    const contexts: BrowserContext[] = [];
    try {
      const a = await signIn(browser, 0);
      contexts.push(a.context);
      const b = await signIn(browser, 1);
      contexts.push(b.context);
      const outsider = await signIn(browser, 2);
      contexts.push(outsider.context);
      await a.page
        .getByRole("button", { name: "Create a server", exact: true })
        .click();
      await a.page
        .getByLabel("Server name")
        .fill(`Browser community ${suffix}`);
      const streamReady = a.page.waitForResponse(
        (r) => r.url().includes("/api/chat-events?") && r.status() === 200,
      );
      await a.page
        .getByRole("button", { name: "Create server", exact: true })
        .click();
      await expect(
        a.page.getByRole("heading", { name: "general", exact: true }),
      ).toBeVisible();
      await streamReady;
      await a.page.getByRole("button", { name: "Toggle member list" }).click();
      await expect(
        a.page.getByRole("complementary", { name: "Members", exact: true }),
      ).toBeVisible();
      await a.page.getByRole("button", { name: "Toggle member list" }).click();
      await expect(
        a.page.getByRole("complementary", { name: "Members", exact: true }),
      ).toHaveCount(0);
      const channelUrl = a.page.url();
      // Exercise polling recovery on one client while the owner uses SSE.
      await b.page.route("**/api/chat-events?*", (route) => route.abort());
      await a.page.getByRole("button", { name: "Invite people" }).click();
      await a.page.getByRole("button", { name: "Create invite link" }).click();
      const invite = await a.page.getByLabel("Invitation link").inputValue();
      await a.page.getByRole("button", { name: "Close dialog" }).click();
      await b.page.goto(invite);
      await b.page
        .getByRole("button", { name: "Join server", exact: true })
        .click();
      await expect(
        b.page.getByRole("heading", { name: "general", exact: true }),
      ).toBeVisible();
      await a.page
        .getByRole("textbox", { name: "Message general", exact: true })
        .fill("Hello from the owner");
      await a.page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        b.page
          .getByRole("log")
          .getByText("Hello from the owner", { exact: true }),
      ).toBeVisible();
      await b.page
        .getByRole("textbox", { name: "Message general", exact: true })
        .fill("A member’s reply");
      await b.page.getByRole("button", { name: "Send", exact: true }).click();
      const reply = b.page
        .getByRole("article")
        .filter({ hasText: "A member’s reply" });
      await reply.hover();
      await reply.getByRole("button", { name: "Edit", exact: true }).click();
      await b.page
        .getByRole("textbox", { name: "Message general", exact: true })
        .fill("A member’s edited reply");
      await b.page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        a.page
          .getByRole("log")
          .getByText("A member’s edited reply", { exact: true }),
      ).toBeVisible();
      await b.context.setOffline(true);
      await expect(
        b.page.getByText("You’re offline.", { exact: false }),
      ).toBeVisible();
      await a.page
        .getByRole("textbox", { name: "Message general", exact: true })
        .fill("Delivered during disconnection");
      await a.page.getByRole("button", { name: "Send", exact: true }).click();
      await b.context.setOffline(false);
      await expect(
        b.page
          .getByRole("log")
          .getByText("Delivered during disconnection", { exact: true }),
      ).toBeVisible();
      await b.page.reload();
      await expect(
        b.page
          .getByRole("log")
          .getByText("A member’s edited reply", { exact: true }),
      ).toBeVisible();
      // Search must stop exposing text removed by another client.
      await a.page
        .getByRole("searchbox", { name: "Search this conversation" })
        .fill("edited");
      await a.page.getByRole("button", { name: "Search", exact: true }).click();
      const results = a.page.getByRole("region", { name: "Search results" });
      await expect(
        results
          .getByRole("button")
          .filter({ hasText: "A member’s edited reply" }),
      ).toBeVisible();
      const editedReply = b.page
        .getByRole("article")
        .filter({ hasText: "A member’s edited reply" });
      await editedReply.hover();
      await editedReply
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await b.page
        .getByRole("button", { name: "Delete message", exact: true })
        .click();
      await expect(
        results.getByText("No messages found.", { exact: true }),
      ).toBeVisible({ timeout: 8000 });
      await a.page.getByRole("button", { name: "Clear", exact: true }).click();
      // A cold deep link must retain the persisted unread boundary while the
      // separately requested sidebar summaries are still loading.
      const apiForMember = browserApi(b.page);
      const serverId = new URL(channelUrl).pathname.split("/")[2]!;
      const selectedChannelId = new URL(channelUrl).pathname.split("/")[3]!;
      const server = await apiForMember.servers.get.query({ serverId });
      const conversationId = server.channels.find(
        (c) => c.id === selectedChannelId,
      )!.conversationId!;
      const latest = await apiForMember.messages.list.query({ conversationId });
      await apiForMember.reads.ack.mutate({
        conversationId,
        seq: latest.latestSeq,
      });
      await b.page.goto("/channels/@me");
      await a.page
        .getByRole("textbox", { name: "Message general", exact: true })
        .fill("Unread after returning");
      await a.page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        a.page
          .getByRole("log")
          .getByText("Unread after returning", { exact: true }),
      ).toBeVisible();
      await b.page.goto(channelUrl);
      await expect(
        b.page.getByText("New messages", { exact: true }),
      ).toBeVisible({ timeout: 8000 });
      await outsider.page.goto(channelUrl);
      await expect(
        outsider.page.getByRole("heading", {
          name: "This server is unavailable",
        }),
      ).toBeVisible();
      await expect(
        outsider.page.getByText("Hello from the owner", { exact: true }),
      ).toHaveCount(0);
      await a.page.screenshot({
        path: testInfo.outputPath("community-desktop.png"),
        fullPage: true,
      });
      for (const width of [320, 390, 768, 1024]) {
        await b.page.setViewportSize({ width, height: 844 });
        expect(
          await b.page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      await b.page.setViewportSize({ width: 390, height: 844 });
      await expect(
        b.page.getByRole("button", { name: "Open navigation" }),
      ).toBeVisible();
      expect(
        await b.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await b.page.screenshot({
        path: testInfo.outputPath("community-mobile.png"),
        fullPage: true,
      });
      await b.page.setViewportSize({ width: 1440, height: 960 });
      // Friend request, acceptance and a canonical direct conversation.
      await a.page.goto("/channels/@me");
      await b.page.goto("/channels/@me");
      await a.page
        .getByRole("button", { name: "Add friend", exact: true })
        .click();
      await a.page.getByLabel("Friend’s handle").fill(accounts[1]!.handle);
      await a.page.getByRole("button", { name: "Send friend request" }).click();
      await b.page.getByRole("button", { name: /^Pending/ }).click();
      await b.page.getByRole("button", { name: "Accept", exact: true }).click();
      await a.page.getByRole("button", { name: "All", exact: true }).click();
      await a.page
        .getByRole("button", { name: "Message", exact: true })
        .click();
      await a.page
        .getByRole("textbox", { name: "Message Test member", exact: true })
        .fill("Our private conversation");
      await a.page.getByRole("button", { name: "Send", exact: true }).click();
      await b.page.getByRole("link", { name: /Test owner/ }).click();
      await expect(
        b.page
          .getByRole("log")
          .getByText("Our private conversation", { exact: true }),
      ).toBeVisible();
      await b.page.goto("/channels/@me");
      await b.page.getByLabel("Actions for Test owner").click();
      await b.page.getByRole("button", { name: "Block", exact: true }).click();
      await expect(
        a.page.getByRole("textbox", {
          name: "Message Test member",
          exact: true,
        }),
      ).toBeDisabled({ timeout: 8000 });
      await expect(
        a.page
          .getByRole("log")
          .getByText("Our private conversation", { exact: true }),
      ).toBeVisible();
      await b.page
        .getByRole("button", { name: "Blocked", exact: true })
        .click();
      await b.page
        .getByRole("button", { name: "Unblock", exact: true })
        .click();
      // Permission change removes another active client's channel and history.
      await a.page.goto(channelUrl);
      await b.page.goto(channelUrl);
      await a.page.getByRole("button", { name: "Server settings" }).click();
      await a.page
        .getByRole("button", { name: "Permissions", exact: true })
        .click();
      const options = await a.page
        .getByLabel("Role or member")
        .locator("option")
        .all();
      let target = "";
      for (const option of options)
        if ((await option.textContent()) === "Test member")
          target = (await option.getAttribute("value")) ?? "";
      await a.page.getByLabel("Role or member").selectOption(target);
      const denyGrid = a.page
        .getByRole("heading", { name: "Deny", exact: true })
        .locator("+ .permission-grid");
      await denyGrid.getByLabel("view channel").check();
      await a.page
        .getByRole("button", { name: "Save channel permissions" })
        .click();
      await expect(a.page.getByText("Saved.", { exact: true })).toBeVisible();
      await expect(
        b.page.getByRole("heading", { name: "Conversation unavailable" }),
      ).toBeVisible();
      await expect(
        b.page.getByText("Hello from the owner", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  });
});
