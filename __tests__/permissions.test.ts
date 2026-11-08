import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, P, permissionsFor } from "~/server/chat/permissions";
const everyone = {
  id: "everyone",
  permissions: P.VIEW_CHANNEL | P.SEND_MESSAGES,
  position: 0,
  isEveryone: true,
};
const role = {
  id: "writer",
  permissions: P.ADD_REACTIONS,
  position: 1,
  isEveryone: false,
};
const base = {
  userId: "member",
  ownerId: "owner",
  member: true,
  banned: false,
  roles: [everyone, role],
  assignedRoleIds: ["writer"],
};
describe("layered channel permissions", () => {
  it("requires membership even for owners and administrators", () => {
    expect(permissionsFor({ ...base, userId: "owner", member: false })).toBe(0);
    expect(
      permissionsFor({
        ...base,
        roles: [{ ...everyone, permissions: ALL_PERMISSIONS }],
        banned: true,
      }),
    ).toBe(0);
  });
  it("grants active owners and administrators access through overwrites", () => {
    const overwrites = [
      { userId: "owner", roleId: null, allow: 0, deny: ALL_PERMISSIONS },
    ];
    expect(permissionsFor({ ...base, userId: "owner", overwrites })).toBe(
      ALL_PERMISSIONS,
    );
    expect(
      permissionsFor({
        ...base,
        roles: [{ ...everyone, permissions: P.ADMINISTRATOR }],
        overwrites,
      }),
    ).toBe(ALL_PERMISSIONS);
  });
  it("applies everyone deny then combined role allows then member deny", () => {
    const overwrites = [
      { roleId: "everyone", userId: null, allow: 0, deny: P.SEND_MESSAGES },
      { roleId: "writer", userId: null, allow: P.SEND_MESSAGES, deny: 0 },
    ];
    expect(permissionsFor({ ...base, overwrites }) & P.SEND_MESSAGES).toBe(
      P.SEND_MESSAGES,
    );
    expect(
      permissionsFor({
        ...base,
        overwrites: [
          ...overwrites,
          { roleId: null, userId: "member", allow: 0, deny: P.SEND_MESSAGES },
        ],
      }) & P.SEND_MESSAGES,
    ).toBe(0);
  });
  it("aggregates role denies before role allows regardless of role order", () => {
    const other = { ...role, id: "other" };
    const overwrites = [
      { roleId: "writer", userId: null, allow: P.SEND_MESSAGES, deny: 0 },
      { roleId: "other", userId: null, allow: 0, deny: P.SEND_MESSAGES },
    ];
    const input = {
      ...base,
      roles: [...base.roles, other],
      assignedRoleIds: ["writer", "other"],
      overwrites,
    };
    expect(permissionsFor(input) & P.SEND_MESSAGES).toBe(P.SEND_MESSAGES);
    expect(permissionsFor({ ...input, overwrites: overwrites.reverse() })).toBe(
      permissionsFor(input),
    );
  });
  it("removes every channel action without VIEW_CHANNEL and ignores unrelated overwrites", () => {
    expect(
      permissionsFor({
        ...base,
        overwrites: [
          {
            roleId: null,
            userId: "member",
            deny: P.VIEW_CHANNEL,
            allow: P.SEND_MESSAGES,
          },
        ],
      }),
    ).toBe(0);
    expect(
      permissionsFor({
        ...base,
        overwrites: [
          { roleId: null, userId: "stranger", deny: ALL_PERMISSIONS, allow: 0 },
        ],
      }),
    ).toBe(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ADD_REACTIONS);
  });
});
