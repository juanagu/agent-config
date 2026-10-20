"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { t: Dictionary["profile"]; initialName: string };

export function ProfileForm({ t, initialName }: Props) {
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/me/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    setMessage(res.ok ? { kind: "ok", text: t.saved } : { kind: "error", text: t.nameRequired });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 px-4">
      <label className="flex flex-col gap-1">
        {t.nameLabel}
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-md border px-3" />
      </label>
      {message && <p role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      <div className="flex gap-2">
        <button type="submit" className="h-11 min-w-[200px] rounded-md bg-accent px-4">
          {t.save}
        </button>
        <button type="button" className="h-11 min-w-[200px] rounded-md border px-4">
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
