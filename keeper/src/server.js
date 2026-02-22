import http from "http";

export function startServer({ metrics, logger }) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("OK");
      return;
    }

    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(metrics.get()));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(3000, () => {
    logger.info("Metrics server running on port 3000");
  });
}
