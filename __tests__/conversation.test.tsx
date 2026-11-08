// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RouterOutputs } from "~/utils/api";
import { Conversation } from "~/components/chat/Conversation";
import type { Profile } from "~/components/chat/AuthGate";

const harness = vi.hoisted(() => ({
  data: undefined as { pages: RouterOutputs["messages"]["list"][] } | undefined,
}));
vi.mock("~/components/chat/useConversationEvents", () => ({
  useConversationEvents: () => ({ connected: true, revoked: false }),
}));
vi.mock("~/utils/api", () => {
  const mutation = { mutate: vi.fn(), isPending: false, error: null };
  const query = { data: undefined, error: null, isPending: false };
  const invalidate = vi.fn();
  const utils = {
    messages: { invalidate },
    search: { invalidate },
    reads: { summary: { invalidate } },
    preferences: { invalidate },
  };
  return {
    api: {
      useUtils: () => utils,
      messages: {
        list: {
          useInfiniteQuery: () => ({
            ...query,
            data: harness.data,
            isPending: !harness.data,
            hasNextPage: false,
          }),
        },
        around: { useQuery: () => query },
        send: { useMutation: () => mutation },
        edit: { useMutation: () => mutation },
        delete: { useMutation: () => mutation },
        react: { useMutation: () => mutation },
      },
      search: { messages: { useInfiniteQuery: () => query } },
      preferences: {
        get: { useQuery: () => query },
        set: { useMutation: () => mutation },
      },
      activity: {
        typists: { useQuery: () => query },
        typing: { useMutation: () => mutation },
      },
      reads: { ack: { useMutation: () => mutation } },
    },
  };
});
afterEach(() => {
  cleanup();
  harness.data = undefined;
});
const profile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  clerkId: "fixture",
  handle: "fixture",
  displayName: "Fixture",
  bio: "",
  status: "online",
  theme: "dark",
  disabledAt: null,
  createdAt: new Date(),
};
it("restores the persisted unread boundary when history and sidebar summaries arrive after mounting", () => {
  const conversationId = "00000000-0000-4000-8000-000000000002";
  const { rerender } = render(
    <Conversation
      conversationId={conversationId}
      name="general"
      profile={profile}
      readSeq="0"
    />,
  );
  const page = {
    items: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        conversationId,
        authorId: profile.id,
        author: {
          id: profile.id,
          displayName: "Fixture",
          handle: "fixture",
          bio: "",
        },
        body: "Previously unread",
        seq: "2",
        version: 1,
        clientNonce: "00000000-0000-4000-8000-000000000004",
        replyToId: null,
        createdAt: new Date(),
        editedAt: null,
        deletedAt: null,
        blocked: false,
        reactions: [],
      },
    ],
    permissions: 3,
    latestSeq: "2",
    eventSeq: "2",
    before: null,
    lastReadSeq: "1",
  };
  harness.data = { pages: [page] };
  rerender(
    <Conversation
      conversationId={conversationId}
      name="general"
      profile={profile}
      readSeq="1"
    />,
  );
  expect(screen.getByText("New messages", { exact: true })).toBeInTheDocument();
});
