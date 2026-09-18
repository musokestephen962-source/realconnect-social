export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test D1 connection
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

    // Create a connection request
    if (url.pathname === "/api/connection-request" && request.method === "POST") {
      try {
        const body = await request.json();

        const senderId = Number(body.sender_id);
        const receiverId = Number(body.receiver_id);

        if (!senderId || !receiverId) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "sender_id and receiver_id are required"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        if (senderId === receiverId) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "A user cannot send a connection request to themselves"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const result = await env.DB
          .prepare(
            `INSERT INTO connection_requests
             (sender_id, receiver_id, status)
             VALUES (?, ?, 'pending')`
          )
          .bind(senderId, receiverId)
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            request_id: result.meta.last_row_id
          }),
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid request"
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
