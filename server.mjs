import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(root, "public");
const dataDir = resolve(root, "data");
const plansPath = join(dataDir, "plans.json");
const port = Number(process.env.PORT ?? 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

async function ensurePlansFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await stat(plansPath);
  } catch {
    await writeFile(plansPath, "[]\n", "utf8");
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readPlans() {
  await ensurePlansFile();
  return readJson(plansPath);
}

async function savePlans(plans) {
  await ensurePlansFile();
  await writeFile(plansPath, `${JSON.stringify(plans, null, 2)}\n`, "utf8");
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function planSummary(plan) {
  return {
    id: plan.id,
    name: plan.name,
    curriculum: plan.curriculum,
    curriculumKey: plan.curriculumKey,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/data") {
    const [programs, curricula, catalog, lists] = await Promise.all([
      readJson(join(dataDir, "programs.json")),
      readJson(join(dataDir, "curricula.json")),
      readJson(join(dataDir, "course-catalog.json")),
      readJson(join(dataDir, "course-lists.json")),
    ]);
    send(res, 200, { programs, curricula, catalog, lists });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/plans") {
    const plans = await readPlans();
    send(res, 200, plans.map(planSummary));
    return true;
  }

  const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
  if (req.method === "GET" && planMatch) {
    const plans = await readPlans();
    const plan = plans.find((item) => item.id === planMatch[1]);
    if (!plan) send(res, 404, { error: "Plan not found" });
    else send(res, 200, plan);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/plans") {
    const body = await readRequestBody(req);
    const now = new Date().toISOString();
    const plan = {
      id: randomUUID(),
      version: "0.1.0",
      name: String(body?.name || "Plan local").slice(0, 120),
      curriculum: body?.curriculum ?? null,
      curriculumKey: body?.curriculumKey ?? "",
      semesters: Array.isArray(body?.semesters) ? body.semesters : [],
      createdAt: now,
      updatedAt: now,
    };
    const plans = await readPlans();
    plans.push(plan);
    await savePlans(plans);
    send(res, 201, plan);
    return true;
  }

  if (req.method === "PUT" && planMatch) {
    const body = await readRequestBody(req);
    const plans = await readPlans();
    const index = plans.findIndex((item) => item.id === planMatch[1]);
    if (index === -1) {
      send(res, 404, { error: "Plan not found" });
      return true;
    }
    plans[index] = {
      ...plans[index],
      name: String(body?.name || plans[index].name).slice(0, 120),
      curriculum: body?.curriculum ?? plans[index].curriculum ?? null,
      curriculumKey: body?.curriculumKey ?? plans[index].curriculumKey,
      semesters: Array.isArray(body?.semesters) ? body.semesters : plans[index].semesters,
      updatedAt: new Date().toISOString(),
    };
    await savePlans(plans);
    send(res, 200, plans[index]);
    return true;
  }

  if (req.method === "DELETE" && planMatch) {
    const plans = await readPlans();
    const next = plans.filter((item) => item.id !== planMatch[1]);
    if (next.length === plans.length) {
      send(res, 404, { error: "Plan not found" });
      return true;
    }
    await savePlans(next);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const candidate = normalize(join(publicDir, rawPath));
  if (!candidate.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = extname(candidate).toLowerCase();
    res.writeHead(200, { "content-type": mimeTypes[ext] ?? "application/octet-stream" });
    createReadStream(candidate).pipe(res);
  } catch {
    send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) send(res, 404, { error: "Unknown API route" });
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Planner local listo en http://localhost:${port}`);
});
