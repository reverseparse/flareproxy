import { handle } from "./router";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  }
} satisfies ExportedHandler<Env>;
