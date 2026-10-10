type NotificationRecord = {
  id?: string;
  recipient_id?: string;
  title?: string;
  body?: string;
  entity_type?: string;
  entity_id?: string;
  read_at?: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const encoder = new TextEncoder();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function matchesSecret(provided: string, expected: string): boolean {
  const left = encoder.encode(provided);
  const right = encoder.encode(expected);
  if (!expected || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left[index]! ^ right[index]!;
  }
  return mismatch === 0;
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getFcmAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  ].join(".");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("FCM authentication failed");
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error("FCM returned no access token");
  return result.access_token;
}

async function removeInvalidToken(
  token: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<void> {
  const url = new URL(`${supabaseUrl}/rest/v1/push_tokens`);
  url.searchParams.set("token", `eq.${token}`);
  await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  const providedSecret = request.headers.get("x-push-webhook-secret") ?? "";
  if (!matchesSecret(providedSecret, expectedSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!supabaseUrl || !serviceRoleKey || !serviceAccountJson) {
    return json({ error: "Push service is not configured" }, 503);
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json() as WebhookPayload;
  } catch {
    return json({ error: "Invalid webhook payload" }, 400);
  }

  if (payload.type !== "INSERT" || payload.table !== "notifications") {
    return json({ ignored: true });
  }

  const notification = payload.record;
  const recipientId = notification?.recipient_id;
  if (!notification || !recipientId || notification.read_at) {
    return json({ ignored: true });
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      return json({ error: "FCM service account is invalid" }, 503);
    }

    const tokenUrl = new URL(`${supabaseUrl}/rest/v1/push_tokens`);
    tokenUrl.searchParams.set("select", "token");
    tokenUrl.searchParams.set("user_id", `eq.${recipientId}`);
    const tokenResponse = await fetch(tokenUrl, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!tokenResponse.ok) throw new Error("Could not load device tokens");
    const registrations = await tokenResponse.json() as { token: string }[];
    if (registrations.length === 0) return json({ sent: 0 });

    const accessToken = await getFcmAccessToken(serviceAccount);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`;
    let sent = 0;
    let removed = 0;

    for (const registration of registrations) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: registration.token,
            notification: {
              title: notification.title ?? "Fisco update",
              body: notification.body ?? "",
            },
            data: {
              notification_id: notification.id ?? "",
              entity_type: notification.entity_type ?? "",
              entity_id: notification.entity_id ?? "",
            },
            android: {
              priority: "HIGH",
              notification: { channel_id: "fisco_activity", sound: "default" },
            },
            apns: { payload: { aps: { sound: "default" } } },
          },
        }),
      });

      if (response.ok) {
        sent++;
        continue;
      }

      const failure = await response.json().catch(() => null) as {
        error?: { details?: { errorCode?: string }[] };
      } | null;
      const isUnregistered = failure?.error?.details?.some(
        (detail) => detail.errorCode === "UNREGISTERED",
      ) ?? false;
      if (isUnregistered) {
        await removeInvalidToken(registration.token, supabaseUrl, serviceRoleKey);
        removed++;
      }
    }

    return json({ sent, removed });
  } catch {
    return json({ error: "Push delivery failed" }, 500);
  }
});
