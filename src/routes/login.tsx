import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { requestOtp as requestOtpApi, verifyOtp as verifyOtpApi } from "@/lib/api";
import { signInWithPassword, applySessionFromAuthResponse, isAdminOrAbove } from "@/lib/session";
import { KeyRound, Mail, MailQuestion, ShieldCheck, RefreshCw, Lock, Loader2, Building2, Sparkles, Activity } from "lucide-react";


const searchSchema = z.object({
  redirect: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Sign in · PulseLedger — CG Boulevard" },
      { name: "description", content: "OTP-based sign in for whitelisted residents and admins." },
    ],
  }),
});

// Six-box OTP entry -- the "new-age app" pattern (banking apps, Stripe, etc.)
// instead of one plain text field. Supports auto-advance while typing,
// backspace-to-previous, pasting/autofilling a full 6-digit code into any
// box, and fires onComplete exactly once when the code first becomes full
// (not on every subsequent edit, so correcting a digit doesn't re-trigger it).
function OtpBoxes({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
}) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  function applyNext(next: string, focusIndex: number) {
    const prevDigits = value.replace(/\D/g, "").length;
    const nextDigits = next.replace(/\D/g, "").length;
    onChange(next);
    if (focusIndex >= 0) inputsRef.current[Math.min(focusIndex, 5)]?.focus();
    if (prevDigits < 6 && nextDigits === 6) onComplete(next);
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 1) {
      const chars = value.padEnd(6, " ").split("");
      chars[index] = digits;
      applyNext(chars.join("").replace(/ /g, "").slice(0, 6), digits ? index + 1 : index);
      return;
    }
    // Multi-character input = a paste or SMS autofill landing in one box.
    const chars = value.padEnd(6, " ").split("");
    for (let i = 0; i < digits.length && index + i < 6; i++) {
      chars[index + i] = digits[i];
    }
    const next = chars.join("").replace(/ /g, "").slice(0, 6);
    applyNext(next, index + digits.length);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  return (
    <div className="flex gap-2" role="group" aria-label="One-time code, 6 digits">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of 6`}
          className="h-12 w-11 sm:h-14 sm:w-12 rounded-lg border border-input bg-background text-center text-xl font-semibold tracking-widest focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow disabled:opacity-50"
        />
      ))}
    </div>
  );
}

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
    // FIX (2026-08-15): this used to check `role === "admin"` only, which
    // silently excluded "superadmin" once that became its own distinct
    // value -- a superadmin logging in via password fell through to the
    // resident destination instead. Use isAdminOrAbove() so both roles land
    // in the admin area, even if they were bounced from a resident URL.
    const dest = isAdminOrAbove(res.session!.role)
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

  async function verify(code: string = otp) {
    setBusy(true);
    try {
      const j = await verifyOtpApi(email, code);
      // FIX (2026-08-15): this used to hand-roll its own session object and
      // write straight to localStorage, duplicating (and collapsing
      // "superadmin" into "admin" in) the exact logic signInWithPassword
      // already had. Now both login paths go through the same helper.
      const session = applySessionFromAuthResponse({ ...j.user, email: j.user?.email ?? email });

      toast.success(`Signed in as ${session.name} (${session.role})`);
      const dest = isAdminOrAbove(session.role)
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
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#0082c9] to-[#005f91] text-white shadow-md shadow-blue-500/20 flex-shrink-0">
                <Activity className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
              </div>
              <div className="flex flex-col">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-none">
                  Pulse<span className="text-[#0082c9]">Ledger</span>
                </h1>
                <span className="text-[11px] sm:text-xs font-bold text-muted-foreground uppercase tracking-[0.15em] mt-1.5">
                  CG Boulevard Apartment Ledger Portal
                </span>
              </div>
            </div>
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
                {/* FIX (2026-08-15): kept short here on purpose -- the fuller
                    troubleshooting message (spam + registration contact)
                    lives only on the post-send screen below, where someone
                    actually waiting for a code that hasn't arrived can act
                    on it. Showing the same message twice was redundant. */}
                <p className="text-xs text-muted-foreground">
                  If OTP is not in Inbox, check Spam/Junk folder.
                </p>
              </div>
            )}

            {mode === "otp" && stage === "otp" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="otp-0"><KeyRound className="inline h-3.5 w-3.5 mr-1" /> One-time code</Label>
                  <OtpBoxes
                    value={otp}
                    onChange={setOtp}
                    onComplete={(code) => { if (!busy) verify(code); }}
                    disabled={busy}
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => verify()} disabled={otp.length !== 6 || busy}>
                    {busy ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
                    ) : "Verify & sign in"}
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
                {/* FIX (2026-08-15): upgraded from plain muted-foreground
                    text to a proper callout -- easy-to-miss fine print meant
                    residents kept retrying/resending instead of noticing the
                    guidance. Same content as before, shown identically to
                    every visitor reaching this stage regardless of whether
                    their email turns out to be registered -- never confirms
                    or denies status, matching /request-otp's uniform
                    response, so this stays safe from an email-enumeration
                    standpoint. */}
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mt-1">
                  <MailQuestion className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    Still nothing after a few minutes? Check Spam/Junk, then email{" "}
                    <a href="mailto:rwa@cgboulevard.com" className="font-semibold underline underline-offset-2">
                      rwa@cgboulevard.com
                    </a>{" "}
                    to confirm your email is registered.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
