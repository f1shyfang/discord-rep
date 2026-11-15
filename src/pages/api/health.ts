import type { NextApiRequest, NextApiResponse } from "next";

// Liveness only. Public probes must not open a database connection per request.
// Authenticated browser journeys separately verify identity and persistence.
export default function health(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).end();
    return;
  }
  if (req.method === "HEAD") res.status(200).end();
  else res.status(200).json({ status: "ok" });
}
