import { routes } from "./routes";

Bun.serve({ port: 3000, fetch: routes });
