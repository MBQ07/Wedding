const ALLOWED_ORIGIN = "https://mbq07.github.io";
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
function objectUrl(request, key, route = "photo") {
  return new URL("/" + route + "/" + key.split("/").map(encodeURIComponent).join("/"), request.url).toString();
}
function authorised(request, env) {
  return request.headers.get("X-Wedding-Passcode") === env.ALBUM_PASSCODE;
}
async function getKey(request) {
  try {
    return (await request.json()).key;
  } catch {
    return null;
  }
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

    if (request.method === "GET" && url.pathname === "/pending") {
      if (!authorised(request, env)) return json({ error: "The passcode is not correct." }, 401);
      const listed = await env.PHOTOS.list({ prefix: "pending/", limit: 1000 });
      const photos = listed.objects
        .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
        .map((item) => ({ key: item.key, url: objectUrl(request, item.key, "pending-photo"), uploaded: item.uploaded }));
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

    if (request.method === "GET" && url.pathname.startsWith("/pending-photo/")) {
      const key = decodeURIComponent(url.pathname.slice("/pending-photo/".length));
      if (!key.startsWith("pending/")) return new Response("Not found", { status: 404 });
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "private, max-age=300",
          "ETag": object.httpEtag
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/upload") {
      if (!authorised(request, env)) return json({ error: "The passcode is not correct." }, 401);
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

    if (request.method === "POST" && url.pathname === "/approve") {
      if (!authorised(request, env)) return json({ error: "The passcode is not correct." }, 401);
      const key = await getKey(request);
      if (typeof key !== "string" || !key.startsWith("pending/")) return json({ error: "Invalid photo." }, 400);
      const object = await env.PHOTOS.get(key);
      if (!object) return json({ error: "This photo is no longer available." }, 404);
      const approvedKey = "approved/" + key.slice("pending/".length);
      await env.PHOTOS.put(approvedKey, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata
      });
      await env.PHOTOS.delete(key);
      return json({ ok: true, url: objectUrl(request, approvedKey) });
    }

    if (request.method === "DELETE" && url.pathname === "/pending") {
      if (!authorised(request, env)) return json({ error: "The passcode is not correct." }, 401);
      const key = await getKey(request);
      if (typeof key !== "string" || !key.startsWith("pending/")) return json({ error: "Invalid photo." }, 400);
      await env.PHOTOS.delete(key);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }
};
