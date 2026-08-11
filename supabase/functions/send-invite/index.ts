// Supabase Edge Function — sends an invite email via Resend.
// Deliberately avoids importing @supabase/supabase-js: that package pulls in
// Node-only realtime/websocket code that crashes the Edge Function sandbox
// with a generic 502 (EDGE_FUNCTION_ERROR) on some deployments. Talking to
// Supabase's Auth/REST endpoints with plain fetch avoids the dependency
// entirely and is just as capable for this use case.
//
// Deploy: supabase functions deploy send-invite
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY  — from resend.com dashboard
//   APP_URL         — e.g. https://st10340293.github.io/production-tracker
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically by the platform.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const APP_URL = Deno.env.get("APP_URL") || "";

    if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured on the server." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated." }, 401);

    const restHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
      "Content-Type": "application/json",
    };

    // 1. Who's calling?
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: restHeaders });
    if (!userRes.ok) return json({ error: "Not authenticated." }, 401);
    const user = await userRes.json();

    const { projectId, inviteeEmail, role } = await req.json();
    if (!projectId || !inviteeEmail || !role) return json({ error: "Missing projectId, inviteeEmail, or role." }, 400);

    // 2. Load the project — RLS on the `projects` table (via the caller's own
    // JWT passed through in Authorization) makes this only return a row if
    // the caller is a member.
    const projRes = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?id=eq.${projectId}&select=title,owner_id`,
      { headers: restHeaders }
    );
    if (!projRes.ok) return json({ error: "Could not look up the project." }, 502);
    const projRows = await projRes.json();
    const project = projRows[0];
    if (!project) return json({ error: "Project not found or access denied." }, 403);
    if (project.owner_id !== user.id) return json({ error: "Only the project owner can send invites." }, 403);

    // 3. Inviter's display name, best-effort.
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=full_name`,
      { headers: restHeaders }
    );
    const profRows = profRes.ok ? await profRes.json() : [];
    const inviterName = profRows[0]?.full_name || user.email;

    const signupLink = APP_URL ? `${APP_URL}/signup.html` : "signup.html";

    // 4. Actually send the email.
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Production Tracker <onboarding@resend.dev>",
        to: [inviteeEmail],
        subject: `${inviterName} invited you to "${project.title}" on Production Tracker`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;">
            <p><b>${inviterName}</b> invited you to collaborate on <b>${project.title}</b> as a <b>${role}</b>.</p>
            <p>Sign up (or log in, if you already have an account) using this email address —
               <b>${inviteeEmail}</b> — and you'll be added to the project automatically.</p>
            <p><a href="${signupLink}" style="display:inline-block;padding:10px 18px;background:#e8622c;color:#fff;text-decoration:none;border-radius:4px;">Create your account</a></p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return json({ error: `Email provider error: ${errText}` }, 502);
    }

    return json({ success: true });
  } catch (e) {
    console.error("send-invite error:", e);
    return json({ error: e.message || "Unexpected error sending invite email." }, 500);
  }
});