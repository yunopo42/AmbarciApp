'use client';

import { invitationSchema } from '@ambarci/shared';
import type { Invitation, OrganizationRole } from '@ambarci/shared';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { apiRequest, errorMessage } from '@/lib/api';
import { formatDateTime, ROLE_LABELS } from '@/lib/labels';

/** Yönetici için tek kullanımlık, süreli davet kodu üretir. */
export function InvitationGenerator({ organizationId }: { organizationId: string }): JSX.Element {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      setInvitation(
        await apiRequest('/v1/invitations', {
          method: 'POST',
          organizationId,
          body: { role: String(form.get('role')) as OrganizationRole, expiresInDays: Number(form.get('expiresInDays')) },
          schema: invitationSchema,
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-semibold">Davet kodu üret</h2>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>Rol</span>
          <select name="role" defaultValue="EMPLOYEE" className="rounded border px-2 py-2">
            <option value="EMPLOYEE">{ROLE_LABELS.EMPLOYEE}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Geçerlilik (gün)</span>
          <input name="expiresInDays" type="number" min={1} max={30} defaultValue={7} required className="w-24 rounded border px-2 py-2" />
        </label>
        <button type="submit" disabled={pending} className="rounded border px-4 py-2 font-medium">
          {pending ? 'Üretiliyor…' : 'Kod üret'}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {invitation ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p>
            Kod: <strong className="font-mono text-lg tracking-widest">{invitation.code}</strong>
          </p>
          <p className="text-sm">
            {ROLE_LABELS[invitation.role]} olarak katılım için, {formatDateTime(invitation.expiresAt)} tarihine kadar
            ve bir kez kullanılabilir. Kodu yalnızca davet ettiğin kişiyle paylaş.
          </p>
          <button type="button" onClick={() => void copyCode(invitation.code)} className="self-start rounded border px-3 py-1">
            {copied ? 'Kopyalandı' : 'Kodu kopyala'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
