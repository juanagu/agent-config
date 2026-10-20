import { createServer } from "node:http";

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/api/me") {
    return res.end(JSON.stringify({ displayName: "Ada Lovelace", email: "ada@example.com", plan: "pro" }));
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(4000);
