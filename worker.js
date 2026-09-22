async function getAuthenticatedUser(request, env) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return null;
  }

  const session = await env.DB
    .prepare(
      `SELECT users.id, users.name, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?
         AND sessions.expires_at > ?
       LIMIT 1`
    )
    .bind(
      token,
      new Date().toISOString()
    )
    .first();

  return session || null;
}

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
    // Register a new user
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!name || !email || !password) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Name, email and password are required"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        if (!email.includes("@") || email.length > 254) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Please provide a valid email address"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        if (password.length < 8) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Password must be at least 8 characters"
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
            `SELECT id
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
              error: "An account with this email already exists"
            }),
            {
              status: 409,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const saltBytes = crypto.getRandomValues(
  new Uint8Array(16)
);

console.log("Registration reached password import");

const passwordKey = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"]
);

console.log("Registration password import succeeded");

const hashBuffer = await crypto.subtle.deriveBits(
  {
    name: "PBKDF2",
    salt: saltBytes,
    iterations: 100000,
    hash: "SHA-256"
  },
  passwordKey,
  256
);

const bytesToHex = (bytes) =>
  Array.from(
    bytes,
    byte => byte.toString(16).padStart(2, "0")
  ).join("");

const passwordHash = bytesToHex(
  new Uint8Array(hashBuffer)
);

        const passwordSalt = bytesToHex(saltBytes);

        const result = await env.DB
          .prepare(
            `INSERT INTO users
             (name, email, password_hash, password_salt)
             VALUES (?, ?, ?, ?)`
          )
          .bind(
            name,
            email,
            passwordHash,
            passwordSalt
          )
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
            error: String(error)
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
    // Login an existing user
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();

        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!email || !password) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Email and password are required"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const user = await env.DB
          .prepare(
            `SELECT id, name, email, password_hash, password_salt
             FROM users
             WHERE email = ?
             LIMIT 1`
          )
          .bind(email)
          .first();

        if (!user) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid email or password"
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const hexToBytes = (hex) =>
          new Uint8Array(
            hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
          );

        const saltBytes = hexToBytes(user.password_salt);

        const passwordKey = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(password),
          "PBKDF2",
          false,
          ["deriveBits"]
        );

        const hashBuffer = await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: 100000,
            hash: "SHA-256"
          },
          passwordKey,
          256
        );

        const passwordHash = Array.from(
          new Uint8Array(hashBuffer),
          byte => byte.toString(16).padStart(2, "0")
        ).join("");

        if (passwordHash !== user.password_hash) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid email or password"
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

                const tokenBytes = crypto.getRandomValues(
          new Uint8Array(32)
        );

        const token = Array.from(
          tokenBytes,
          byte => byte.toString(16).padStart(2, "0")
        ).join("");

        const expiresAt = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        await env.DB
          .prepare(
            `INSERT INTO sessions
             (user_id, token, expires_at)
             VALUES (?, ?, ?)`
          )
          .bind(
            user.id,
            token,
            expiresAt
          )
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            user_id: user.id,
            name: user.name,
            email: user.email,
            token
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
            error: String(error)
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

    return env.ASSETS.fetch(request);
  }
};
