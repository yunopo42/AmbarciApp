'use client';

import { organizationMembershipSchema } from '@ambarci/shared';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useOrganizations } from '@/components/organization-provider';
import { apiRequest, errorMessage } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/labels';

/** Yöneticinin verdiği davet koduyla şirkete katılır; katılınan şirket aktif şirket yapılır. */
export function JoinOrganizationForm(): JSX.Element {
  const { reload } = useOrganizations();
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const code = String(new FormData(formElement).get('code') ?? '');
    setPending(true);
    setError(null);
    setJoined(null);
    try {
      const organization = await apiRequest('/v1/invitations/accept', {
        method: 'POST',
        body: { code },
        schema: organizationMembershipSchema,
      });
      setJoined(`${organization.name} şirketine ${ROLE_LABELS[organization.role].toLocaleLowerCase('tr-TR')} olarak katıldın.`);
      formElement.reset();
      await reload(organization.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-semibold">Davet koduyla katıl</h2>
      <p className="text-sm">Yöneticinden aldığın kodu gir. Büyük/küçük harf ve tire farkı önemli değil.</p>
      <label className="flex flex-col gap-1">
        <span>Davet kodu</span>
        <input name="code" autoComplete="off" minLength={8} maxLength={32} required className="rounded border px-3 py-2 uppercase" />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {joined ? <p aria-live="polite">{joined}</p> : null}
      <button type="submit" disabled={pending} className="rounded border px-4 py-2 font-medium">
        {pending ? 'Katılınıyor…' : 'Katıl'}
      </button>
    </form>
  );
}
