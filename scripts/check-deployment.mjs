const origin = new URL(
  process.env.APP_ORIGIN ?? "https://discord.michaelfeng.me",
);
if (origin.protocol !== "https:")
  throw new Error("Deployment checks require HTTPS.");
/** @type {[string, number][]} */
const checks = [
  ["/api/health", 200],
  ["/channels/@me", 200],
  ["/api/chat-events", 401],
  ["/api/webhooks/clerk", 405],
];
let failures = 0;
for (const [path, expected] of checks) {
  let passed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, origin), {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
      passed = response.status === expected;
      if (passed && path === "/api/health")
        passed = (await response.json()).status === "ok";
      else await response.body?.cancel();
      if (passed) break;
    } catch {
      // Deliberately omit URLs, payloads, credentials and transport exceptions.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log(`${passed ? "PASS" : "FAIL"} ${path} expected=${expected}`);
  if (!passed) failures++;
}
if (failures) process.exitCode = 1;
