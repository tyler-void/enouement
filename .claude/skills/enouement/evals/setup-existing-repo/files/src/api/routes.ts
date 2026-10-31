import { listNotes, addNote } from "../db/notes";

export function routes(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/notes" && req.method === "GET") return Response.json(listNotes());
  if (url.pathname === "/notes" && req.method === "POST") return Response.json(addNote("new"));
  return new Response("not found", { status: 404 });
}
