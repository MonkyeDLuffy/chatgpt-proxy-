const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function proxifyUrl(targetUrl, baseUrl, req) {
  const absoluteUrl = new URL(targetUrl, baseUrl).href;
  return `${req.protocol}://${req.get("host")}/m3u8-proxy?url=${encodeURIComponent(absoluteUrl)}`;
}

function rewriteM3U8(content, baseUrl, req) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      if (trimmed.startsWith("#EXT-X-KEY") && trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/, (_, uri) => {
          return `URI="${proxifyUrl(uri, baseUrl, req)}"`;
        });
      }

      if (!trimmed || trimmed.startsWith("#")) return line;

      return proxifyUrl(trimmed, baseUrl, req);
    })
    .join("\n");
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "AnimePahe proxy running",
  });
});

app.get("/m3u8-proxy", async (req, res) => {
  try {
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send("Missing url");
    }

    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://animepahe.ru/",
        Origin: "https://animepahe.ru",
        Range: req.headers.range || undefined,
      },
      timeout: 30000,
    });

    const contentType = response.headers["content-type"] || "";

    if (
      contentType.includes("mpegurl") ||
      targetUrl.includes(".m3u8")
    ) {
      const text = Buffer.from(response.data).toString("utf8");
      const rewritten = rewriteM3U8(text, targetUrl, req);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(rewritten);
    }

    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (response.headers["content-range"]) {
      res.setHeader("Content-Range", response.headers["content-range"]);
    }

    if (response.headers["accept-ranges"]) {
      res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
    }

    res.status(response.status).send(response.data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Proxy failed");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
