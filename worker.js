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

    // Temporary session authentication test
    if (url.pathname === "/api/test-session") {
      const user = await getAuthenticatedUser(request, env);

      if (!user) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Not authenticated"
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          user_id: user.id,
          name: user.name,
          email: user.email
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

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
            `SELECT id, name, email, password_hash, password_salt, membership
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
            hex.match(/.{1,2}/g).map(
              byte => parseInt(byte, 16)
            )
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
membership: user.membership,
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

    // Create or update the authenticated user's profile
    if (url.pathname === "/api/profile" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Not authenticated"
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const body = await request.json();

        const location = String(body.location || "").trim();
        const age = Number(body.age);
        const interests = String(body.interests || "").trim();
        const bio = String(body.bio || "").trim();
        const religion = String(body.religion || "").trim();

        if (
          !location ||
          !Number.isInteger(age) ||
          age < 18 ||
          age > 120
        ) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Location and a valid age are required"
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const existing = await env.DB
          .prepare(
            "SELECT id FROM profiles WHERE user_id = ? LIMIT 1"
          )
          .bind(user.id)
          .first();

        if (existing) {
          await env.DB
            .prepare(
              `UPDATE profiles
               SET location = ?, age = ?, interests = ?, bio = ?, religion = ?
               WHERE user_id = ?`
            )
            .bind(
              location,
              age,
              interests,
              bio,
              religion,
              user.id
            )
            .run();
        } else {
          await env.DB
            .prepare(
              `INSERT INTO profiles
               (user_id, location, age, interests, bio, religion)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(
              user.id,
              location,
              age,
              interests,
              bio,
              religion
            )
            .run();
        }

              return new Response(
          JSON.stringify({
            success: true,
            message: "Profile saved"
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
            error: "Unable to save profile"
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    }
        // Send an authenticated connection request
    if (url.pathname === "/api/connection-request" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Not authenticated"
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        const body = await request.json();
        const senderId = user.id;
        const receiverId = Number(body.receiver_id);

        if (!senderId || !receiverId) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "receiver_id is required"
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

    // Get profiles for Discover

    // Get incoming connection requests for the logged-in member
    if (url.pathname === "/api/connection-requests" && request.method === "GET") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Not authenticated" },
            { status: 401 }
          );
        }

        const result = await env.DB.prepare(`
          SELECT
            cr.id AS request_id,
            cr.sender_id,
            cr.created_at,
            u.name AS sender_name,
            p.location,
            p.age,
            p.interests,
            p.bio
          FROM connection_requests cr
          JOIN users u ON u.id = cr.sender_id
          LEFT JOIN profiles p ON p.user_id = cr.sender_id
          WHERE cr.receiver_id = ?
            AND cr.status = 'pending'
          ORDER BY cr.created_at DESC
        `).bind(user.id).all();

        return Response.json({
          success: true,
          requests: result.results
        });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to load requests" },
          { status: 500 }
        );
      }
    }

    // Accept or decline an incoming connection request
    if (url.pathname === "/api/connection-request/respond" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Not authenticated" },
            { status: 401 }
          );
        }

        const body = await request.json();
        const requestId = Number(body.request_id);
        const action = body.action;

        if (!Number.isInteger(requestId) || requestId < 1 ||
            !["accept", "decline"].includes(action)) {
          return Response.json(
            { success: false, error: "Invalid request ID or action" },
            { status: 400 }
          );
        }

        const connectionRequest = await env.DB.prepare(`
          SELECT id, sender_id, receiver_id
          FROM connection_requests
          WHERE id = ?
            AND receiver_id = ?
            AND status = 'pending'
          LIMIT 1
        `).bind(requestId, user.id).first();

        if (!connectionRequest) {
          return Response.json(
            { success: false, error: "Request not found or already handled" },
            { status: 404 }
          );
        }

        if (action === "decline") {
          await env.DB.prepare(`
            UPDATE connection_requests
            SET status = 'declined'
            WHERE id = ?
              AND receiver_id = ?
              AND status = 'pending'
          `).bind(requestId, user.id).run();

          return Response.json({ success: true, status: "declined" });
        }

        const senderId = Number(connectionRequest.sender_id);
        const receiverId = Number(connectionRequest.receiver_id);

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO connections (user_id, connected_user_id)
            SELECT ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM connections
              WHERE user_id = ? AND connected_user_id = ?
            )
          `).bind(senderId, receiverId, senderId, receiverId),

          env.DB.prepare(`
            INSERT INTO connections (user_id, connected_user_id)
            SELECT ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM connections
              WHERE user_id = ? AND connected_user_id = ?
            )
          `).bind(receiverId, senderId, receiverId, senderId),

          env.DB.prepare(`
            UPDATE connection_requests
            SET status = 'accepted'
            WHERE id = ?
              AND receiver_id = ?
              AND status = 'pending'
          `).bind(requestId, user.id)
        ]);

        return Response.json({ success: true, status: "accepted" });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to respond to request" },
          { status: 500 }
        );
      }
    }
        if (url.pathname === "/api/connections" && request.method === "GET") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Please log in" },
            { status: 401 }
          );
        }

        const result = await env.DB.prepare(`
          SELECT
            u.id AS user_id,
            u.name,
            p.location,
            p.age,
            p.interests,
            p.bio,
            CASE
              WHEN p.avatar_key IS NOT NULL
              THEN '/api/profile-photo/' || u.id
              ELSE NULL
            END AS photo_url
          FROM connections c
          JOIN users u ON u.id = c.connected_user_id
          LEFT JOIN profiles p ON p.user_id = u.id
          WHERE c.user_id = ?
          ORDER BY u.name
        `).bind(user.id).all();

        return Response.json({
          success: true,
          connections: result.results || []
        });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to load connections" },
          { status: 500 }
        );

      }
    }

    // Load messages between accepted connections
    if (url.pathname === "/api/messages" && request.method === "GET") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Please log in" },
            { status: 401 }
          );
        }

        const receiverId = Number(url.searchParams.get("with"));

        if (!Number.isInteger(receiverId) || receiverId <= 0 || receiverId === user.id) {
          return Response.json(
            { success: false, error: "Invalid connection" },
            { status: 400 }
          );
        }

        const connected = await env.DB.prepare(`
          SELECT 1
          FROM connections a
          JOIN connections b
            ON b.user_id = a.connected_user_id
           AND b.connected_user_id = a.user_id
          WHERE a.user_id = ? AND a.connected_user_id = ?
          LIMIT 1
        `).bind(user.id, receiverId).first();

        if (!connected) {
          return Response.json(
            { success: false, error: "Messages are only available to accepted connections" },
            { status: 403 }
          );
        }

        const result = await env.DB.prepare(`
          SELECT id, sender_id, receiver_id, body, created_at
          FROM messages
          WHERE (sender_id = ? AND receiver_id = ?)
             OR (sender_id = ? AND receiver_id = ?)
          ORDER BY id DESC
          LIMIT 100
        `).bind(user.id, receiverId, receiverId, user.id).all();

        return Response.json({
          success: true,
          messages: (result.results || []).reverse()
        });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to load messages" },
          { status: 500 }
        );
      }
    }

    // Send a message to an accepted connection
    if (url.pathname === "/api/messages" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Please log in" },
            { status: 401 }
          );
        }

        const data = await request.json();
        const receiverId = Number(data.receiver_id);
        const body = typeof data.body === "string" ? data.body.trim() : "";

        if (!Number.isInteger(receiverId) || receiverId <= 0 || receiverId === user.id) {
          return Response.json(
            { success: false, error: "Invalid connection" },
            { status: 400 }
          );
        }

        if (!body || body.length > 2000) {
          return Response.json(
            { success: false, error: "Message must be between 1 and 2000 characters" },
            { status: 400 }
          );
        }

        const connected = await env.DB.prepare(`
          SELECT 1
          FROM connections a
          JOIN connections b
            ON b.user_id = a.connected_user_id
           AND b.connected_user_id = a.user_id
          WHERE a.user_id = ? AND a.connected_user_id = ?
          LIMIT 1
        `).bind(user.id, receiverId).first();

        if (!connected) {
          return Response.json(
            { success: false, error: "You can only message accepted connections" },
            { status: 403 }
          );
        }

        const result = await env.DB.prepare(`
          INSERT INTO messages (sender_id, receiver_id, body)
          VALUES (?, ?, ?)
        `).bind(user.id, receiverId, body).run();

        return Response.json({
          success: true,
          message_id: result.meta?.last_row_id
        });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to send message" },
          { status: 500 }
        );
      }
    }
    
    
    // Remove the authenticated member's profile photo
    if (url.pathname === "/api/profile/photo" && request.method === "DELETE") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Please log in first" },
            { status: 401 }
          );
        }

        const profile = await env.DB
          .prepare("SELECT avatar_key FROM profiles WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first();

        if (profile?.avatar_key) {
          await env.DB
            .prepare("UPDATE profiles SET avatar_key = NULL WHERE user_id = ?")
            .bind(user.id)
            .run();

          await env.PHOTOS.delete(profile.avatar_key);
        }

        return Response.json({ success: true });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to remove profile photo" },
          { status: 500 }
        );
      }
    }

    // Upload a profile photo for the authenticated member

    if (url.pathname === "/api/profile/photo" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Please log in to upload a photo"
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const profile = await env.DB
          .prepare("SELECT avatar_key FROM profiles WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first();

        if (!profile) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Please save your profile before uploading a photo"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const formData = await request.formData();
        const photo = formData.get("photo");

        if (!photo || typeof photo.arrayBuffer !== "function") {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Choose an image file"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" }
            }
          );
        }

        if (photo.size === 0 || photo.size > 5 * 1024 * 1024) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Photo must be larger than 0 bytes and no more than 5 MB"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const imageBuffer = await photo.arrayBuffer();
        const bytes = new Uint8Array(imageBuffer);
        let extension = "";
        let contentType = "";
        if (
          bytes.length >= 3 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff
        ) {
          extension = "jpg";
          contentType = "image/jpeg";
        } else if (
          bytes.length >= 8 &&
          bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47 &&
          bytes[4] === 0x0d &&
          bytes[5] === 0x0a &&
          bytes[6] === 0x1a &&
          bytes[7] === 0x0a
        ) {
          extension = "png";
          contentType = "image/png";
        } else if (
          bytes.length >= 12 &&
          bytes[0] === 0x52 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x46 &&
          bytes[8] === 0x57 &&
          bytes[9] === 0x45 &&
          bytes[10] === 0x42 &&
          bytes[11] === 0x50
        ) {
          extension = "webp";
          contentType = "image/webp";
        }

        if (!contentType || photo.type !== contentType) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Use a valid JPEG, PNG, or WebP image"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" }
            }
          );
        }

        const avatarKey =
          `avatars/${user.id}/${crypto.randomUUID()}.${extension}`;

        await env.PHOTOS.put(avatarKey, imageBuffer, {
          httpMetadata: { contentType }
        });

        try {
          await env.DB
            .prepare("UPDATE profiles SET avatar_key = ? WHERE user_id = ?")
            .bind(avatarKey, user.id)
            .run();
        } catch (databaseError) {
          await env.PHOTOS.delete(avatarKey);
          throw databaseError;
        }

        if (profile.avatar_key) {
          await env.PHOTOS.delete(profile.avatar_key);
        }

        return new Response(
          JSON.stringify({
            success: true,
            photo_url: `/api/profile-photo/${user.id}`
          }),
          {
            headers: { "content-type": "application/json" }
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
          success: false,
error: "Unable to upload profile photo"
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" }
          }
        );
      }
    }
    
    // Upload an additional gallery photo
    if (url.pathname === "/api/profile/photos" && request.method === "POST") {
      try {
        const user = await getAuthenticatedUser(request, env);

        if (!user) {
          return Response.json(
            { success: false, error: "Please log in first" },
            { status: 401 }
          );
        }

        const profile = await env.DB
          .prepare("SELECT id FROM profiles WHERE user_id = ? LIMIT 1")
          .bind(user.id)
          .first();

        if (!profile) {
          return Response.json(
            { success: false, error: "Please save your profile first" },
            { status: 400 }
          );
        }

        const count = await env.DB
          .prepare("SELECT COUNT(*) AS total FROM profile_photos WHERE user_id = ?")
          .bind(user.id)
          .first();

        if (count.total >= 10) {
          return Response.json(
            { success: false, error: "You can upload up to 10 gallery photos" },
            { status: 400 }
          );
        }

        const formData = await request.formData();
        const photo = formData.get("photo");

        if (!photo || typeof photo.arrayBuffer !== "function" ||
            photo.size === 0 || photo.size > 5 * 1024 * 1024) {
          return Response.json(
            { success: false, error: "Choose an image up to 5 MB" },
            { status: 400 }
          );
        }

        const imageBuffer = await photo.arrayBuffer();
        const bytes = new Uint8Array(imageBuffer);
        let extension = "";
        let contentType = "";

        if (bytes.length >= 3 && bytes[0] === 0xff &&
            bytes[1] === 0xd8 && bytes[2] === 0xff) {
          extension = "jpg";
          contentType = "image/jpeg";
        } else if (bytes.length >= 8 && bytes[0] === 0x89 &&
            bytes[1] === 0x50 && bytes[2] === 0x4e &&
            bytes[3] === 0x47 && bytes[4] === 0x0d &&
            bytes[5] === 0x0a && bytes[6] === 0x1a &&
            bytes[7] === 0x0a) {
          extension = "png";
          contentType = "image/png";
        } else if (bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 &&
            bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 &&
            bytes[10] === 0x42 && bytes[11] === 0x50) {
          extension = "webp";
          contentType = "image/webp";
        }

        if (!contentType || photo.type !== contentType) {
          return Response.json(
            { success: false, error: "Use a valid JPEG, PNG, or WebP image" },
            { status: 400 }
          );
        }

        const photoKey = `gallery/${user.id}/${crypto.randomUUID()}.${extension}`;

        await env.PHOTOS.put(photoKey, imageBuffer, {
          httpMetadata: { contentType }
        });

        try {
          await env.DB
            .prepare(
              "INSERT INTO profile_photos (user_id, photo_key, content_type) VALUES (?, ?, ?)"
            )
            .bind(user.id, photoKey, contentType)
            .run();
        } catch (error) {
          await env.PHOTOS.delete(photoKey);
          throw error;
        }

        return Response.json({ success: true });
      } catch (error) {
        return Response.json(
          { success: false, error: "Unable to upload gallery photo" },
          { status: 500 }
        );
      }
    }

    // List gallery photos for a member
    if (url.pathname === "/api/profile-photos" && request.method === "GET") {
      const userId = Number(url.searchParams.get("user_id"));

      if (!Number.isInteger(userId) || userId < 1) {
        return Response.json(
          { success: false, error: "A valid member ID is required" },
          { status: 400 }
        );
      }

      const result = await env.DB
        .prepare(
          "SELECT id, created_at FROM profile_photos WHERE user_id = ? ORDER BY id DESC"
        )
        .bind(userId)
        .all();

      return Response.json({
        success: true,
        photos: result.results.map(photo => ({
          id: photo.id,
          url: `/api/gallery-photo/${photo.id}`,
          created_at: photo.created_at
        }))
      });
    }

    // Serve one gallery photo
    const galleryPhotoMatch = url.pathname.match(/^\/api\/gallery-photo\/(\d+)$/);

    if (galleryPhotoMatch && request.method === "GET") {
      const photoId = Number(galleryPhotoMatch[1]);

      const record = await env.DB
        .prepare("SELECT photo_key, content_type FROM profile_photos WHERE id = ?")
        .bind(photoId)
        .first();

      if (!record) {
        return new Response("Photo not found", { status: 404 });
      }

      const photo = await env.PHOTOS.get(record.photo_key);

      if (!photo) {
        return new Response("Photo not found", { status: 404 });
      }

      return new Response(photo.body, {
        headers: {
          "content-type": record.content_type,
          "cache-control": "public, max-age=3600",
          "x-content-type-options": "nosniff"
        }
      });
    }

    // Delete one gallery photo belonging to the authenticated member
    const deleteGalleryMatch = url.pathname.match(/^\/api\/profile\/photos\/(\d+)$/);

    if (deleteGalleryMatch && request.method === "DELETE") {
      const user = await getAuthenticatedUser(request, env);

      if (!user) {
        return Response.json(
          { success: false, error: "Please log in first" },
          { status: 401 }
        );
      }

      const photoId = Number(deleteGalleryMatch[1]);

      const record = await env.DB
        .prepare("SELECT photo_key FROM profile_photos WHERE id = ? AND user_id = ?")
        .bind(photoId, user.id)
        .first();

      if (!record) {
        return Response.json(
          { success: false, error: "Photo not found" },
          { status: 404 }
        );
      }

      await env.DB
        .prepare("DELETE FROM profile_photos WHERE id = ? AND user_id = ?")
        .bind(photoId, user.id)
        .run();

      await env.PHOTOS.delete(record.photo_key);

      return Response.json({ success: true });
    }

    // Serve a member's profile photo from private R2 storage
    const photoMatch = url.pathname.match(/^\/api\/profile-photo\/(\d+)$/);

    if (photoMatch && request.method === "GET") {
      try {
        const memberId = Number(photoMatch[1]);

        const profile = await env.DB
          .prepare("SELECT avatar_key FROM profiles WHERE user_id = ? LIMIT 1")
          .bind(memberId)
          .first();

        if (!profile || !profile.avatar_key) {
          return new Response("Photo not found", { status: 404 });
        }

        const photo = await env.PHOTOS.get(profile.avatar_key);

        if (!photo) {
          return new Response("Photo not found", { status: 404 });
        }

        const contentType = photo.httpMetadata?.contentType;

        if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          return new Response("Invalid photo type", { status: 415 });
        }

        return new Response(photo.body, {
          headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=3600",
            "x-content-type-options": "nosniff"
          }
        });
      } catch (error) {
        return new Response("Unable to load photo", { status: 500 });
      }
    }

    // Load member profiles for Discover
    if (url.pathname === "/api/profiles" && request.method === "GET") {
      try {
        const result = await env.DB
          .prepare(`
            SELECT
              profiles.id,
              profiles.user_id,
              users.name,
              profiles.location,
              profiles.age,
              profiles.interests,
              profiles.bio,
              profiles.religion,
              CASE
                WHEN profiles.avatar_key IS NOT NULL
                THEN '/api/profile-photo/' || profiles.user_id
                ELSE NULL
              END AS photo_url
            FROM profiles
            JOIN users ON users.id = profiles.user_id
            ORDER BY profiles.id DESC
          `)
          .all();

        return new Response(
          JSON.stringify({
            success: true,
            profiles: result.results
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
            error: "Unable to load profiles"
          }),
          {
            status: 500,
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
