import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Only ciphertext is written to the output directory. The decryption key must
// stay outside GitHub Actions; this job receives the public encryption key only.
const url = process.env.DIRECT_DATABASE_URL;
const publicKey = process.env.BACKUP_GPG_PUBLIC_KEY;
const recipient = process.env.BACKUP_GPG_RECIPIENT;
if (!url || !publicKey || !recipient || !/^[A-F0-9]{40}$/.test(recipient))
  throw new Error(
    "Backup database and public encryption key configuration are required.",
  );
const connection = new URL(url);
if (
  !/^postgres(ql)?:$/.test(connection.protocol) ||
  connection.hostname.includes("-pooler.")
)
  throw new Error("Backups require a direct PostgreSQL connection.");
const keyDirectory = await mkdtemp(
  join(tmpdir(), "discord-backup-public-key-"),
);
await chmod(keyDirectory, 0o700);
const directory = resolve(process.env.BACKUP_DIRECTORY ?? "backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = join(
  directory,
  `discord-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.gpg`,
);
const gpgEnv = { ...process.env, GNUPGHOME: keyDirectory };
let completed = false;
try {
  const imported = spawnSync("gpg", ["--batch", "--import"], {
    env: gpgEnv,
    input: publicKey,
    encoding: "utf8",
  });
  if (imported.status !== 0)
    throw new Error("Public encryption key import failed.");
  const dump = spawn(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "--schema=drizzle",
    ],
    {
      env: {
        ...process.env,
        PGHOST: connection.hostname,
        PGPORT: connection.port || "5432",
        PGDATABASE: connection.pathname.slice(1),
        PGUSER: decodeURIComponent(connection.username),
        PGPASSWORD: decodeURIComponent(connection.password),
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "/etc/ssl/certs/ca-certificates.crt",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const encryption = spawn(
    "gpg",
    [
      "--batch",
      "--yes",
      "--trust-model",
      "always",
      "--recipient",
      recipient,
      "--cipher-algo",
      "AES256",
      "--compress-algo",
      "none",
      "--encrypt",
      "--output",
      output,
    ],
    {
      env: gpgEnv,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  /** @param {import("node:child_process").ChildProcess} child */
  const successful = (child) =>
    new Promise((resolveExit) => {
      child.once("error", () => resolveExit(false));
      child.once("close", (code) => resolveExit(code === 0));
    });
  const exits = [successful(dump), successful(encryption)];
  encryption.once("error", () => dump.kill());
  dump.once("error", () => encryption.kill());
  encryption.once("exit", (code) => {
    if (code !== 0) dump.kill();
  });
  // Consume diagnostics without logging connection strings or database content.
  dump.stderr.resume();
  encryption.stderr.resume();
  encryption.stdin.on("error", () => {});
  dump.stdout.pipe(encryption.stdin);
  const results = await Promise.all(exits);
  if (!results.every(Boolean)) throw new Error("Backup pipeline failed.");
  await chmod(output, 0o600);
  completed = true;
  console.log("Encrypted application database backup created.");
} catch {
  console.error("Encrypted backup failed. No plaintext backup was written.");
  process.exitCode = 1;
} finally {
  if (!completed) await rm(output, { force: true });
  await rm(keyDirectory, { recursive: true, force: true });
}
