export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test D1 connection
    if (url.pathname === "/api/test-db") {
      const result = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

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
        const users = await env.DB
          .prepare(
            `SELECT id FROM users
             WHERE id IN (?, ?)`
          )
          .bind(senderId, receiverId)
          .all();

        if (users.results.length !== 2) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "One or both users do not exist"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }
            const existingRequest = await env.DB
          .prepare(
            `SELECT id FROM connection_requests
             WHERE sender_id = ?
             AND receiver_id = ?
             AND status = 'pending'
             LIMIT 1`
          )
          .bind(senderId, receiverId)
          .first();

        if (existingRequest) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "A pending connection request already exists"
            }),
            {
              status: 409,
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
    // Register a new user
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();

        if (!name || !email) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Name and email are required"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const existingUser = await env.DB
          .prepare(
            `SELECT id, name, email
             FROM users
             WHERE email = ?
             LIMIT 1`
          )
          .bind(email)
          .first();

        if (existingUser) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "An account with this email already exists",
              user_id: existingUser.id
            }),
            {
              status: 409,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const result = await env.DB
          .prepare(
            `INSERT INTO users (name, email)
             VALUES (?, ?)`
          )
          .bind(name, email)
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            user_id: result.meta.last_row_id,
            name,
            email
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
            error: "Invalid registration request"
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
