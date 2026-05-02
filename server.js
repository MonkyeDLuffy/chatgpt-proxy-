const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function abs(url, base) {
  try { return new URL(url, base).href; } catch { return url; }
}

function proxyUrl(u, base, req) {
  const a = abs(u, base);
  return `${req.protocol}://${req.get("host")}/m3u8-proxy?url=${encodeURIComponent(a)}`;
}

function rewriteM3U8(text, base, req) {
  return text.split("\n").map(line => {
    const t = line.trim();

    // Rewrite KEY URIs
    if (t.startsWith("#EXT-X-KEY") && t.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/, (_, u) => `URI="${proxyUrl(u, base, req)}"`);
    }

    // Keep comments
    if (!t || t.startsWith("#")) return line;

    // Rewrite segment/variant URLs
    return proxyUrl(t, base, req);
  }).join("\n");
}

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "HLS proxy running" });
});

app.get("/m3u8-proxy", async (req, res) => {
  try {
    const target = req.query.url;
    if (!target) return res.status(400).send("Missing url");

    const upstream = await axios.get(target, {
      responseType: "stream", // 🔥 stream for speed
      headers: {
        "User-Agent": UA,
        Referer: "https://animepahe.ru/",
        Origin: "https://animepahe.ru",
        Range: req.headers.range || undefined
      },
      timeout: 30000
    });

    const ct = upstream.headers["content-type"] || "";

    // If playlist, buffer small text and rewrite
    if (ct.includes("mpegurl") || target.includes(".m3u8")) {
      let data = "";
      upstream.data.on("data", chunk => (data += chunk.toString("utf8")));
      upstream.data.on("end", () => {
        const out = rewriteM3U8(data, target, req);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.send(out);
      });
      return;
    }

    // Otherwise pipe segments directly
    res.setHeader("Content-Type", ct || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (upstream.headers["content-range"]) {
      res.setHeader("Content-Range", upstream.headers["content-range"]);
    }
    if (upstream.headers["accept-ranges"]) {
      res.setHeader("Accept-Ranges", upstream.headers["accept-ranges"]);
    }

    upstream.data.pipe(res); // 🔥 no buffering, faster
  } catch (e) {
    console.error("Proxy error:", e.message);
    res.status(500).send("Proxy failed");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Proxy running on port " + PORT);
});
