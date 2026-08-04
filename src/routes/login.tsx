import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { requestOtp as requestOtpApi, verifyOtp as verifyOtpApi } from "@/lib/api";
import { signInWithPassword } from "@/lib/session";
import { KeyRound, Mail, ShieldCheck, RefreshCw, Lock } from "lucide-react";


const searchSchema = z.object({
  redirect: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Sign in · Apartment Ledger Pro" },
      { name: "description", content: "OTP-based sign in for whitelisted residents and admins." },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/login" });
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"email" | "otp">("email");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  function startCooldown() {
    setCooldown(20);
    const t = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(t); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  async function submitPassword() {
    if (!email.includes("@")) { toast.error("Enter a valid email address"); return; }
    if (!password) { toast.error("Enter your password"); return; }
    setBusy(true);
    const res = await signInWithPassword(email, password);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.reason === "invalid_credentials" ? "Invalid email or password." : "Could not sign in. Try again.");
      return;
    }
    toast.success(`Signed in as ${res.session!.name}`);
    // Admins/superadmins always land on the admin area, even if they were
    // bounced from a resident URL — otherwise the redirect param wins and
    // makes it look like they signed in as a resident.
    const dest = res.session!.role === "admin"
      ? "/admin/actions"
      : ((redirect as string) || "/resident/overview");
    navigate({ to: dest });
  }



  async function sendOtp(isResend = false) {
    if (!email.includes("@")) { toast.error("Enter a valid email address"); return; }
    setBusy(true);
    try {
      await requestOtpApi(email);
      // Always show the same success message — do not leak whitelist status.
      toast.success(isResend ? "OTP resent — check your email" : "OTP sent — check your email");
      setStage("otp");
      startCooldown();
      // Real API mode: never expose OTP in UI.
      setDevHint(null);
    } catch {
      toast.error("Could not send OTP. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const j = await verifyOtpApi(email, otp);
      const roles: string[] = Array.isArray(j.user?.roles) ? j.user.roles : [];
      const role: "admin" | "resident" = (roles.includes("admin") || roles.includes("superadmin"))
        ? "admin"
        : "resident";
      const session = {
        email: j.user?.email ?? email.toLowerCase(),
        name: j.user?.name || j.user?.email || email,
        role,
        issuedAt: Date.now(),
      };
      if (typeof window !== "undefined") {
        window.localStorage.setItem("apf.session", JSON.stringify(session));
        window.dispatchEvent(new Event("apf-session-change"));
      }

      toast.success(`Signed in as ${session.name} (${session.role})`);
      const dest = session.role === "admin"
        ? "/admin/actions"
        : ((redirect as string) || "/resident/overview");
      navigate({ to: dest });
    } catch {
      toast.error("That code is invalid or expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <Badge variant="outline" className="text-[10px]">
              {mode === "password" ? "Password login" : "OTP login · whitelisted only"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            {mode === "password"
              ? "Sign in with your email and password. Superadmins use this route."
              : "Enter your email. If it's on the community whitelist you'll receive a 6-digit code valid for 15 minutes."}
          </CardDescription>
          <div className="flex gap-1 pt-1">
            <Button size="sm" variant={mode === "password" ? "default" : "outline"} onClick={() => setMode("password")}>Password</Button>
            <Button size="sm" variant={mode === "otp" ? "default" : "outline"} onClick={() => setMode("otp")}>OTP</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email"><Mail className="inline h-3.5 w-3.5 mr-1" /> Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mode === "otp" && stage === "otp"}
              autoComplete="email"
            />
          </div>

          {mode === "password" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pw"><Lock className="inline h-3.5 w-3.5 mr-1" /> Password</Label>
                <Input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                  autoComplete="current-password"
                />
              </div>
              <Button className="w-full" onClick={submitPassword} disabled={busy || !email || !password}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </>
          )}

          {mode === "otp" && stage === "email" && (
            <Button className="w-full" onClick={() => sendOtp(false)} disabled={!email}>
              Send OTP
            </Button>
          )}

          {mode === "otp" && stage === "otp" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="otp"><KeyRound className="inline h-3.5 w-3.5 mr-1" /> One-time code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={verify} disabled={otp.length !== 6}>
                  Verify & sign in
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sendOtp(true)}
                  disabled={cooldown > 0}
                  aria-label="Resend OTP"
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {cooldown > 0 ? `${cooldown}s` : "Resend"}
                </Button>
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                onClick={() => { setStage("email"); setOtp(""); setDevHint(null); }}
              >
                Use a different email
              </button>

              {devHint && (
                <Alert>
                  <AlertTitle className="text-xs">Prototype hint (mock inbox)</AlertTitle>
                  <AlertDescription className="font-mono text-lg tracking-widest">{devHint}</AlertDescription>
                </Alert>
              )}
            </>
          )}

          <div className="pt-2 border-t border-border text-[11px] text-muted-foreground space-y-1">
            <div>Superadmin: <code>admin@example.com</code> / <code>ChangeMe!2026</code></div>
            <div>OTP whitelist demo: <code>treasurer@example.com</code>, <code>resident@example.com</code></div>
            <Link to="/" className="underline underline-offset-2">Back to landing</Link>
          </div>
        </CardContent>

      </Card>
    </div>
  );
}
