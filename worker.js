export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-db") {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      return new Response(
        JSON.stringify(result),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
