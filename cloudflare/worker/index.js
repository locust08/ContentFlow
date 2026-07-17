import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createMediaStore } from "./media.js";
import { createRepository } from "./repository.js";

export default {
  fetch(request, env) {
    const repository = createRepository(env.DB);
    return createApp({
      auth: createAuth(env, repository),
      repository,
      media: createMediaStore(env.MEDIA),
      assets: env.ASSETS,
      internalToken: env.CONTENTFLOW_PRODUCTION_TOKEN || ""
    }).fetch(request);
  }
};
