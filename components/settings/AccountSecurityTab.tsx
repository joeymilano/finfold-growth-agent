"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { useAuthUser } from "@/components/auth/AuthUserProvider";
import { CompletionSoundCard } from "@/components/settings/CompletionSoundCard";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ArrowRight, Camera, CheckCircle2, Loader2, Lock, LogOut, Mail, Shield } from "@/components/ui/icons";
import { useLocale } from "@/hooks/useLocale";
import { analyzePassword } from "@/lib/password-policy";

type UserInfo = { email: string; avatarUrl: string | null; userId: string } | null;

/** Mirrors the avatar route: still images only (animated GIF/WebP are rejected server-side). */
const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Our API errors are already localized; network/parse failures are not. */
function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.name === "Error" && error.message ? error.message : fallback;
}

/**
 * AccountSecurityTab — avatar, login email, password, and session sign-out.
 *
 * All privileged Supabase operations (password update, email update,
 * avatar upload + user metadata update) are routed through backend API
 * routes so that the secret service-role key is never exposed to the
 * browser. Account identity comes from the root AuthUserProvider.
 */
export function AccountSecurityTab() {
  const router = useRouter();
  const locale = useLocale();
  const { user: authUser, refresh: refreshAuthUser } = useAuthUser();
  const [user, setUser] = useState<UserInfo>(null);

  // Avatar
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Email
  const [newEmail, setNewEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  // Hidden only for accounts known to have no password yet; the server still
  // decides, and asking for it (current_password_required) reveals the field.
  const [currentPasswordAsked, setCurrentPasswordAsked] = useState(false);
  const needsCurrentPassword = authUser?.hasPassword !== false || currentPasswordAsked;
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  // Enter-key submits bypass the disabled button; a ref closes the gap
  // before the loading state re-renders.
  const emailSubmitRef = useRef(false);
  const passwordSubmitRef = useRef(false);

  useEffect(() => {
    if (!authUser) return;
    setUser({
      email: authUser.email,
      avatarUrl: authUser.avatarUrl,
      userId: authUser.id,
    });
    setAvatarPreview(authUser.avatarUrl);
  }, [authUser]);

  async function uploadAvatar(file: File) {
    if (!user) return;
    if (file.size > 2 * 1024 * 1024) {
      setAvatarStatus({ ok: false, msg: locale === "en" ? "Image must be under 2MB." : "图片不能超过 2MB。" });
      return;
    }
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
      setAvatarStatus({ ok: false, msg: locale === "en" ? "Please select a JPG, PNG, or WebP image." : "请选择 JPG、PNG 或 WebP 格式的图片。" });
      return;
    }

    setAvatarLoading(true);
    setAvatarStatus(null);

    // Local preview immediately
    const localUrl = URL.createObjectURL(file);
    setAvatarPreview(localUrl);

    try {
      // Upload avatar via backend API route
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", user.userId);

      const res = await fetch("/api/auth/avatar", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || (locale === "en" ? "Upload failed, please retry." : "上传失败，请重试。"));
      }

      const publicUrl = data.avatarUrl;
      setAvatarPreview(publicUrl);
      setUser((u) => u ? { ...u, avatarUrl: publicUrl } : u);
      setAvatarStatus({ ok: true, msg: locale === "en" ? "Avatar updated." : "头像已更新。" });

      // Notify sidebar to refresh
      window.dispatchEvent(new Event("finfold-avatar-change"));
    } catch (err) {
      setAvatarStatus({ ok: false, msg: requestErrorMessage(err, locale === "en" ? "Upload failed, please retry." : "上传失败，请重试。") });
      setAvatarPreview(user.avatarUrl);
    } finally {
      setAvatarLoading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void uploadAvatar(file);
    // reset so same file can be re-selected
    e.target.value = "";
  }

  async function updateEmail() {
    if (emailSubmitRef.current) return;
    if (!newEmail.trim()) { setEmailStatus({ ok: false, msg: locale === "en" ? "Please enter a new email address." : "请输入新邮箱地址。" }); return; }
    emailSubmitRef.current = true;
    setEmailLoading(true);
    setEmailStatus(null);
    try {
      // Route through backend API to keep secret key server-side
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (locale === "en" ? "Update failed, please retry." : "更新失败，请重试。"));
      }
      setEmailStatus({ ok: true, msg: locale === "en" ? "Confirmation email sent. Click the link in your new inbox to confirm." : "确认邮件已发送，请在新邮箱中点击确认链接后生效。" });
      setNewEmail("");
    } catch (err) {
      setEmailStatus({ ok: false, msg: requestErrorMessage(err, locale === "en" ? "Update failed, please retry." : "更新失败，请重试。") });
    } finally {
      emailSubmitRef.current = false;
      setEmailLoading(false);
    }
  }

  async function updatePassword() {
    if (passwordSubmitRef.current) return;
    const pwdResult = analyzePassword(newPassword);
    if (!pwdResult.valid) { setPwStatus({ ok: false, msg: locale === "en" ? (pwdResult.messageEn || "Password does not meet requirements.") : `密码不满足要求：${pwdResult.messageZh}。` }); return; }
    if (newPassword !== confirmPassword) { setPwStatus({ ok: false, msg: locale === "en" ? "Passwords do not match." : "两次密码不一致。" }); return; }
    passwordSubmitRef.current = true;
    setPwLoading(true);
    setPwStatus(null);
    try {
      // Route through backend API to keep secret key server-side
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword, ...(currentPassword ? { currentPassword } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "current_password_required") setCurrentPasswordAsked(true);
        throw new Error(data.error || (locale === "en" ? "Update failed, please retry." : "更新失败，请重试。"));
      }
      setPwStatus({ ok: true, msg: locale === "en" ? "Password updated. Other devices have been signed out." : "密码已更新，其他设备已退出登录。" });
      void refreshAuthUser();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwStatus({ ok: false, msg: requestErrorMessage(err, locale === "en" ? "Update failed, please retry." : "更新失败，请重试。") });
    } finally {
      passwordSubmitRef.current = false;
      setPwLoading(false);
    }
  }

  async function logout() {
    setLogoutLoading(true);
    try {
      // Route through backend API to keep secret key server-side
      await fetch("/api/auth/logout", { method: "POST" });
      await refreshAuthUser();
      router.replace("/login");
    } finally {
      setLogoutLoading(false);
    }
  }

  if (!user) return null;

  const initial = (user.email[0] ?? "?").toUpperCase();

  return (
    <div className="grid max-w-3xl gap-6">
      {/* Avatar + account info */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Shield className="h-4 w-4 text-action-strong dark:text-action" />
          {locale === "en" ? "Account Info" : "账号信息"}
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          {/* Avatar with upload overlay */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="focus-ring group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-brand shadow-glow-brand"
              title={locale === "en" ? "Click to change avatar" : "点击更换头像"}
            >
              <UserAvatar
                avatarUrl={avatarPreview}
                fallback={initial}
                alt={user.email}
                className="h-20 w-20 text-2xl"
                circleClassName="bg-brand text-on-brand"
              />
              {/* Hover overlay */}
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {avatarLoading
                  ? <Loader2 className="h-5 w-5 animate-spin text-white" />
                  : <Camera className="h-5 w-5 text-white" />}
                {!avatarLoading && <span className="text-[10px] font-semibold text-white">{locale === "en" ? "Change" : "更换"}</span>}
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_ACCEPTED_TYPES.join(",")}
              className="hidden"
              onChange={onFileChange}
            />
          </div>

          {/* Email */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-base font-semibold text-fg truncate">{user.email}</p>
            <p className="mt-2 text-xs text-fg-muted">
              {locale === "en" ? "Click avatar to upload a new image. Still JPG / PNG / WebP, max 2MB." : "点击头像可上传新图片，支持 JPG / PNG / WebP 静态图，最大 2MB。"}
            </p>
          </div>
        </div>

        {avatarStatus ? (
          <p className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${avatarStatus.ok ? "border border-positive/30 bg-positive/10 text-positive" : "border border-risk/30 bg-risk/10 text-risk"}`}>
            {avatarStatus.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
            {avatarStatus.msg}
          </p>
        ) : null}
      </section>

      {/* Change email */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Mail className="h-4 w-4 text-action-strong dark:text-action" />
          {locale === "en" ? "Change Email" : "修改邮箱"}
        </div>
        <p className="text-xs text-fg-muted">{locale === "en" ? "Enter a new email address and we'll send a confirmation link to it." : "输入新邮箱后，我们会向新地址发送一封确认邮件，点击后生效。"}</p>
        <label className="grid gap-1.5 text-sm font-medium text-fg">
          {locale === "en" ? "New email address" : "新邮箱地址"}
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void updateEmail()}
            className="focus-ring panel-inset rounded-lg px-3 py-2.5 text-fg placeholder:text-fg-muted"
            placeholder="new@example.com"
          />
        </label>
        {emailStatus ? (
          <p className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${emailStatus.ok ? "border border-positive/30 bg-positive/10 text-positive" : "border border-risk/30 bg-risk/10 text-risk"}`}>
            {emailStatus.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
            {emailStatus.msg}
          </p>
        ) : null}
        <button type="button" onClick={() => void updateEmail()} disabled={emailLoading} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action/45 bg-action/[0.08] px-4 py-2.5 text-sm font-semibold text-action-strong transition hover:bg-action/[0.14] disabled:opacity-60 dark:text-action">
          {emailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {locale === "en" ? "Send confirmation email" : "发送确认邮件"} <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {/* Change password */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Lock className="h-4 w-4 text-action-strong dark:text-action" />
          {locale === "en" ? "Change Password" : "修改密码"}
        </div>
        <p className="text-xs text-fg-muted">{needsCurrentPassword
          ? (locale === "en" ? "At least 8 characters with letters and numbers. Other devices are signed out after the change." : "密码至少 8 位，需含字母和数字。修改后其他设备会退出登录。")
          : (locale === "en" ? "You signed in with Google or GitHub, so you can set a password here and also sign in with your email. At least 8 characters with letters and numbers." : "你是通过 Google 或 GitHub 登录的，可以在这里设置一个密码，之后也能用邮箱登录。密码至少 8 位，需含字母和数字。")}</p>
        {needsCurrentPassword ? (
          <label className="grid gap-1.5 text-sm font-medium text-fg">
            {locale === "en" ? "Current password" : "当前密码"}
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="settings-current-password"
              className="focus-ring panel-inset rounded-lg px-3 py-2.5 text-fg placeholder:text-fg-muted"
              placeholder={locale === "en" ? "Enter your current password" : "输入当前密码"} autoComplete="current-password" />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-sm font-medium text-fg">
          {locale === "en" ? "New password" : "新密码"}
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            data-testid="settings-new-password"
            className="focus-ring panel-inset rounded-lg px-3 py-2.5 text-fg placeholder:text-fg-muted"
            placeholder={locale === "en" ? "8+ chars, letters & numbers" : "至少 8 位，含字母和数字"} autoComplete="new-password" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-fg">
          {locale === "en" ? "Confirm new password" : "确认新密码"}
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            data-testid="settings-confirm-password"
            onKeyDown={(e) => e.key === "Enter" && void updatePassword()}
            className="focus-ring panel-inset rounded-lg px-3 py-2.5 text-fg placeholder:text-fg-muted"
            placeholder={locale === "en" ? "Enter again" : "再输入一次"} autoComplete="new-password" />
        </label>
        {pwStatus ? (
          <p className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${pwStatus.ok ? "border border-positive/30 bg-positive/10 text-positive" : "border border-risk/30 bg-risk/10 text-risk"}`}>
            {pwStatus.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : null}
            {pwStatus.msg}
          </p>
        ) : null}
        <button type="button" onClick={() => void updatePassword()} disabled={pwLoading} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action/45 bg-action/[0.08] px-4 py-2.5 text-sm font-semibold text-action-strong transition hover:bg-action/[0.14] disabled:opacity-60 dark:text-action">
          {pwLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {locale === "en" ? "Update password" : "更新密码"} <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {/* Completion sound preference */}
      <CompletionSoundCard />

      {/* Session */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <LogOut className="h-4 w-4 text-risk" />
          {locale === "en" ? "Session" : "登录会话"}
        </div>
        <p className="text-xs text-fg-muted">
          {locale === "en" ? "Sign out on this device and return to the login page." : "退出当前设备上的登录状态，并返回登录页。"}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          disabled={logoutLoading}
          className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-lg border border-risk/25 bg-risk/10 px-4 py-3 text-sm font-semibold text-risk transition-colors hover:border-risk/40 hover:bg-risk/15 disabled:opacity-60"
        >
          {logoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {locale === "en" ? "Log out" : "退出登录"}
        </button>
      </section>
    </div>
  );
}
