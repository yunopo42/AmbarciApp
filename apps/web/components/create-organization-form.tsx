'use client';

import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { useOrganizations } from '@/components/organization-provider';
import { errorMessage } from '@/lib/api-client';

/** Şirket kurar; kuran kullanıcı yönetici olur ve yeni şirket aktif şirket yapılır. */
export function CreateOrganizationForm(): JSX.Element {
  const { reload } = useOrganizations();
  const { $api } = useApi();
  const create = $api.useMutation('post', '/v1/organizations');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = create.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const name = String(new FormData(formElement).get('name') ?? '');
    setError(null);
    setCreated(null);
    try {
      const organization = await create.mutateAsync({ body: { name } });
      // Kullanıcının zaten şirketi varsa form ekranda kalır; sonuç gösterilip form temizlenir.
      setCreated(`${organization.name} kuruldu ve aktif şirket yapıldı.`);
      formElement.reset();
      await reload(organization.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-semibold">Şirketini kur</h2>
      <p className="text-sm">Şirketi kuran kişi yönetici olur; çalışanlarını davet koduyla eklersin.</p>
      <label className="flex flex-col gap-1">
        <span>Şirket adı</span>
        <input name="name" minLength={2} maxLength={100} required className="rounded border px-3 py-2" />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {created ? <p aria-live="polite">{created}</p> : null}
      <button type="submit" disabled={pending} className="rounded border px-4 py-2 font-medium">
        {pending ? 'Kuruluyor…' : 'Şirketi kur'}
      </button>
    </form>
  );
}
