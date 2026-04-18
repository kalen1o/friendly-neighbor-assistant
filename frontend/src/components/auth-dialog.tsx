"use client";

import { useState } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getMe,
  login,
  register as registerUser,
  type UserInfo,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { OAuthButtons } from "@/components/oauth-buttons";

// ── Form schemas ──

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "At least 6 characters"),
});

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string()
    .min(8, "At least 8 characters")
    .regex(/[a-z]/, "Need a lowercase letter")
    .regex(/[A-Z]/, "Need an uppercase letter")
    .regex(/[0-9]/, "Need a number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

// ── Password strength indicator ──

const PASSWORD_RULES = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Lowercase (a-z)", test: (p: string) => /[a-z]/.test(p) },
  { label: "Uppercase (A-Z)", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Number (0-9)", test: (p: string) => /[0-9]/.test(p) },
];

function PasswordStrength({ password }: { password: string }) {
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  const total = PASSWORD_RULES.length;
  const strength = passed / total;
  const hasInput = password.length > 0;

  return (
    <div className="space-y-2 rounded-lg bg-muted/50 p-2.5">
      {/* Strength bar — only show color when user started typing */}
      <div className="flex gap-1">
        {PASSWORD_RULES.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              hasInput && i < passed
                ? strength <= 0.25
                  ? "bg-red-500"
                  : strength <= 0.5
                  ? "bg-orange-500"
                  : strength <= 0.75
                  ? "bg-yellow-500"
                  : "bg-green-500"
                : "bg-muted-foreground/15"
            }`}
          />
        ))}
      </div>
      {/* Label */}
      {hasInput && (
        <p className={`text-[10px] font-medium ${
          strength <= 0.25 ? "text-red-500"
          : strength <= 0.5 ? "text-orange-500"
          : strength <= 0.75 ? "text-yellow-600 dark:text-yellow-400"
          : "text-green-600 dark:text-green-400"
        }`}>
          {strength <= 0.25 ? "Weak" : strength <= 0.5 ? "Fair" : strength <= 0.75 ? "Good" : "Strong"}
        </p>
      )}
      {/* Rules checklist — always visible */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {PASSWORD_RULES.map((rule) => {
          const ok = hasInput && rule.test(password);
          const failed = hasInput && !rule.test(password);
          return (
            <div
              key={rule.label}
              className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                ok
                  ? "text-green-600 dark:text-green-400"
                  : failed
                  ? "text-red-500/70"
                  : "text-muted-foreground/50"
              }`}
            >
              <span className="text-xs">{ok ? "✓" : failed ? "✗" : "○"}</span>
              <span>{rule.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Password Input ──

function PasswordInput({
  id,
  placeholder = "••••••••",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
      <Input
        id={id}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        className="pl-9 pr-9"
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(!visible)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ── Auth Dialog ──

export interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (user: UserInfo) => void;
}

export function AuthDialog({
  open,
  onOpenChange,
  onSuccess,
}: AuthDialogProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedPassword = registerForm.watch("password");

  const handleLogin = async (data: LoginForm) => {
    setError(null);
    try {
      await login(data.email, data.password);
      const me = await getMe();
      onSuccess(me);
      onOpenChange(false);
      loginForm.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    }
  };

  const handleRegister = async (data: RegisterForm) => {
    setError(null);
    try {
      await registerUser(data.email, data.password, data.name);
      const me = await getMe();
      onSuccess(me);
      onOpenChange(false);
      registerForm.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
    loginForm.reset();
    registerForm.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col items-center px-6 pt-8 pb-2">
          <Image src="/small-logo.png" alt="Friendly Neighbor" width={48} height={48} className="mb-3 rounded-2xl" />
          <h2 className="text-lg font-semibold">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in to continue to Friendly Neighbor"
              : "Get started with Friendly Neighbor"}
          </p>
        </div>

        {/* Tabs */}
        <div className="mx-6 mt-4 flex rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => { if (mode !== "login") switchMode(); }}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all ${
              mode === "login"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { if (mode !== "register") switchMode(); }}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all ${
              mode === "register"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign up
          </button>
        </div>

        {/* Form */}
        <div className="px-6 pb-8 pt-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <OAuthButtons />

          {mode === "login" ? (
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email" className="text-xs">Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    {...loginForm.register("email")}
                  />
                </div>
                {loginForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password" className="text-xs">Password</Label>
                <PasswordInput id="login-password" {...loginForm.register("password")} />
                {loginForm.formState.errors.password && (
                  <p className="text-xs text-destructive">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                {loginForm.formState.isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reg-name" className="text-xs">Name</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="reg-name"
                    placeholder="Your name"
                    className="pl-9"
                    {...registerForm.register("name")}
                  />
                </div>
                {registerForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{registerForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-email" className="text-xs">Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    {...registerForm.register("email")}
                  />
                </div>
                {registerForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{registerForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-password" className="text-xs">Password</Label>
                <PasswordInput id="reg-password" {...registerForm.register("password")} />
                <PasswordStrength password={watchedPassword} />
                {registerForm.formState.errors.password && (
                  <p className="text-xs text-destructive">{registerForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg-confirm" className="text-xs">Confirm Password</Label>
                <PasswordInput id="reg-confirm" {...registerForm.register("confirmPassword")} />
                {registerForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">{registerForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={registerForm.formState.isSubmitting}>
                {registerForm.formState.isSubmitting ? "Creating account..." : "Create account"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
