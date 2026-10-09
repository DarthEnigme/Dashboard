"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import type { ClientAuth } from "@/lib/auth";
import { Dialog } from "../edit/Dialog";
import { inputClass, uploadFile } from "../edit/FieldInput";
import { useT } from "@/i18n/client";

type Me = NonNullable<ClientAuth["user"]>;

/** Round profile picture, or the first letter of the name on the accent gradient. */
export function Avatar({ user, size = 32 }: { user: Pick<Me, "name" | "username" | "avatar">; size?: number }) {
  const label = user.name || user.username;
  if (user.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent/50 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {label[0]?.toUpperCase()}
    </span>
  );
}

/** Your own name, profile picture and password. */
export function ProfileDialog({ user, passwordSignIn, onClose }: { user: Me; passwordSignIn: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState(user.name ?? "");
  const [avatar, setAvatar] = useState(user.avatar);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      setAvatar(await uploadFile("/api/profile/avatar", file));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setError(undefined);
    try {
      await sendJson("/api/profile/avatar", "DELETE");
      setAvatar(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    if (pw.next && pw.next !== pw.confirm) return setError(t("The new passwords don't match"));
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/profile", "PATCH", {
        name: name.trim() || null,
        ...(pw.next ? { currentPassword: pw.current, newPassword: pw.next } : {}),
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("Your profile")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <div className="flex items-center gap-4">
        <Avatar user={{ ...user, name: name || null, avatar }} size={64} />
        <div className="flex flex-wrap gap-2">
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-full bg-track px-3 py-1.5 text-sm hover:bg-hover ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            <Upload className="h-4 w-4" /> {uploading ? t("Uploading…") : avatar ? t("Change picture") : t("Upload picture")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="sr-only"
              onChange={(e) => {
                void changeAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {avatar && (
            <button type="button" onClick={removeAvatar} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
              <Trash2 className="h-4 w-4" /> {t("Remove")}
            </button>
          )}
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">{t("PNG, JPEG, WebP, GIF or AVIF up to 2 MB. Square images look best.")}</p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Display name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={user.username} maxLength={80} className={inputClass} />
      </label>
      <p className="-mt-2 text-xs text-muted">
        {t("Username:")}{" "}{user.username}{t(". Ask an admin to change your email or role.")}
      </p>

      {user.hasPassword && passwordSignIn && (
        <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
          <legend className="sr-only">{t("Change password")}</legend>
          <span className="text-sm font-semibold">{t("Change password")}</span>
          <input
            type="password"
            aria-label={t("Current password")}
            placeholder={t("Current password")}
            autoComplete="current-password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            className={inputClass}
          />
          <input
            type="password"
            aria-label={t("New password")}
            placeholder={t("New password (8+ characters)")}
            autoComplete="new-password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            className={inputClass}
          />
          <input
            type="password"
            aria-label={t("Repeat new password")}
            placeholder={t("Repeat new password")}
            autoComplete="new-password"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            className={inputClass}
          />
        </fieldset>
      )}
    </Dialog>
  );
}
