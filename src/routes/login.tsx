import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { requestOtp as requestOtpApi, verifyOtp as verifyOtpApi } from "@/lib/api";
import { signInWithPassword } from "@/lib/session";
import { KeyRound, Mail, ShieldCheck, RefreshCw, Lock, Loader2, Building2, Sparkles } from "lucide-react";


const searchSchema = z.object({
  redirect: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Sign in · CG Boulevard Apartment Ledger Portal" },
      { name: "description", content: "OTP-based sign in for whitelisted residents and admins." },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/login" });
  const [mode, setMode] = useState<"password" | "otp">("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"email" | "otp">("email");
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
        flatCode: j.user?.flatCode ?? j.user?.flat_code ?? null,
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
    <div className="min-h-screen text-foreground bg-[radial-gradient(900px_420px_at_8%_5%,hsl(var(--primary)/0.18),transparent),radial-gradient(900px_420px_at_95%_95%,hsl(var(--accent)/0.14),transparent),linear-gradient(to_bottom,hsl(var(--background)),hsl(var(--background)))] px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-6xl grid gap-4 lg:grid-cols-[1.1fr_0.9fr] items-start">
        <Card className="border-border/70 bg-card/75 backdrop-blur-sm shadow-sm">
          <CardContent className="p-5 sm:p-7 space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Secure Community Finance</Badge>
              <Badge variant="secondary" className="text-[10px]">Mobile Ready</Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">CG Boulevard Apartment Ledger Portal</h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">
              A unified workspace for transparent collections, expense tracking, and audit-ready administration for residents and committee members.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>Residents use OTP login</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                <Building2 className="h-4 w-4 text-blue-500" />
                <span>Password is for Super Admin</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="w-full border-border/70 bg-card/92 backdrop-blur-sm shadow-sm">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Welcome back</span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {mode === "password" ? "Super Admin" : "Resident OTP"}
              </Badge>
            </div>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>
              {mode === "password"
                ? "Use Super Admin email and password."
                : stage === "otp"
                  ? "Enter the 6-digit OTP sent to your email."
                  : "Enter your registered email to receive OTP."}
            </CardDescription>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={mode === "otp" ? "default" : "outline"} onClick={() => { setMode("otp"); setStage("email"); }}>
                OTP Login
              </Button>
              <Button variant={mode === "password" ? "default" : "outline"} onClick={() => setMode("password")}>Password</Button>
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
                  {busy ? "Signing in..." : "Sign in"}
                </Button>
              </>
            )}

            {mode === "otp" && stage === "email" && (
              <div className="space-y-2">
                <Button className="w-full" onClick={() => sendOtp(false)} disabled={!email || busy}>
                  {busy ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending code...</>
                  ) : "Send OTP"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  If OTP is not in Inbox, check Spam/Junk folder.
                </p>
              </div>
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
                  onClick={() => { setStage("email"); setOtp(""); }}
                >
                  Use a different email
                </button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
