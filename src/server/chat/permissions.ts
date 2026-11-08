export const P = {
  VIEW_CHANNEL: 1,
  SEND_MESSAGES: 2,
  ATTACH_FILES: 4,
  ADD_REACTIONS: 8,
  MANAGE_MESSAGES: 16,
  MANAGE_CHANNELS: 32,
  MANAGE_ROLES: 64,
  KICK_MEMBERS: 128,
  BAN_MEMBERS: 256,
  CREATE_INVITE: 512,
  CONNECT: 1024,
  SPEAK: 2048,
  ADMINISTRATOR: 4096,
  MANAGE_SERVER: 8192,
} as const;
export const ALL_PERMISSIONS = 16383;
export const DEFAULT_PERMISSIONS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.ADD_REACTIONS |
  P.CREATE_INVITE |
  P.CONNECT |
  P.SPEAK;
export type Role = {
  id: string;
  permissions: number;
  position: number;
  isEveryone: boolean;
};
export type Overwrite = {
  roleId: string | null;
  userId: string | null;
  allow: number;
  deny: number;
};
export function permissionsFor(input: {
  userId: string;
  ownerId: string;
  member: boolean;
  banned: boolean;
  roles: Role[];
  assignedRoleIds: string[];
  overwrites?: Overwrite[];
}): number {
  if (!input.member || input.banned) return 0;
  if (input.ownerId === input.userId) return ALL_PERMISSIONS;
  const assigned = new Set(input.assignedRoleIds);
  const effectiveRoles = input.roles.filter(
    (r) => r.isEveryone || assigned.has(r.id),
  );
  let bits = effectiveRoles.reduce((mask, r) => mask | r.permissions, 0);
  if (bits & P.ADMINISTRATOR) return ALL_PERMISSIONS;
  const overwrites = input.overwrites ?? [];
  const everyone = effectiveRoles.find((r) => r.isEveryone);
  const everyoneOverwrite = overwrites.find((o) => o.roleId === everyone?.id);
  if (everyoneOverwrite)
    bits = (bits & ~everyoneOverwrite.deny) | everyoneOverwrite.allow;
  const roleOverwrites = overwrites.filter(
    (o) => o.roleId && assigned.has(o.roleId),
  );
  bits =
    (bits & ~roleOverwrites.reduce((mask, o) => mask | o.deny, 0)) |
    roleOverwrites.reduce((mask, o) => mask | o.allow, 0);
  const memberOverwrite = overwrites.find((o) => o.userId === input.userId);
  if (memberOverwrite)
    bits = (bits & ~memberOverwrite.deny) | memberOverwrite.allow;
  return bits & P.VIEW_CHANNEL ? bits : 0;
}
export function highestRole(roles: Role[], assigned: string[]) {
  return Math.max(
    0,
    ...roles.filter((r) => assigned.includes(r.id)).map((r) => r.position),
  );
}
