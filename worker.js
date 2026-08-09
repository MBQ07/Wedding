const ALLOWED_ORIGIN = "https://mbq07.github.io";
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Wedding-Passcode",
    "Vary": "Origin"
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), "Content-Type": "application/json; charset=utf-8" }
  });
}
function ext(type) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
function objectUrl(request, key) {
  return new URL("/photo/" + key.split("/").map(encodeURIComponent).join("/"), request.url).toString();
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (request.method === "GET" && url.pathname === "/photos") {
      const listed = await env.PHOTOS.list({ prefix: "approved/", limit: 1000 });
      const photos = listed.objects
        .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
        .map((item) => ({ url: objectUrl(request, item.key), uploaded: item.uploaded }));
      return json({ photos });
    }

    if (request.method === "GET" && url.pathname.startsWith("/photo/")) {
      const key = decodeURIComponent(url.pathname.slice("/photo/".length));
      if (!key.startsWith("approved/")) return new Response("Not found", { status: 404 });
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
          "ETag": object.httpEtag
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      if (request.headers.get("X-Wedding-Passcode") !== env.ALBUM_PASSCODE) {
        return json({ error: "The passcode is not correct." }, 401);
      }
      const type = request.headers.get("Content-Type")?.split(";")[0].toLowerCase();
      const length = Number(request.headers.get("Content-Length") || 0);
      if (!TYPES.has(type)) return json({ error: "Please choose a JPEG, PNG, or WebP image." }, 415);
      if (length && length > MAX_BYTES) return json({ error: "Each photo must be 12 MB or smaller." }, 413);
      const key = "pending/" + new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + "." + ext(type);
      await env.PHOTOS.put(key, request.body, {
        httpMetadata: { contentType: type },
        customMetadata: { submittedAt: new Date().toISOString() }
      });
      return json({ ok: true, message: "Thank you! Your photo is waiting for approval." }, 201);
    }

    return json({ error: "Not found" }, 404);
  }
};
