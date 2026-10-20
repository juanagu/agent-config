import { createServer } from "node:http";

const MAX_BODY_BYTES = 10_000;

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      if (raw.length < MAX_BODY_BYTES) raw += chunk;
    });
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/api/me") {
    return res.end(JSON.stringify({ displayName: "Ada Lovelace", email: "ada@example.com" }));
  }
  if (req.method === "PUT" && req.url === "/api/me/profile") {
    const body = await readJson(req);
    if (!body.displayName?.trim()) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ error: "validation" }));
    }
    return res.end(JSON.stringify({ displayName: body.displayName }));
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(4000);
