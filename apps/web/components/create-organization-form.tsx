'use client';

import { useId, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { useOrganizations } from '@/components/organization-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api-client';

/** Şirket kurar; kuran kullanıcı yönetici olur ve yeni şirket aktif şirket yapılır. */
export function CreateOrganizationForm(): JSX.Element {
  const { reload } = useOrganizations();
  const { $api } = useApi();
  const create = $api.useMutation('post', '/v1/organizations');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = create.isPending;
  // Form ana sayfada iki kez görünebilir (kullanıcının şirketi varken); alan kimlikleri çakışmasın.
  const nameId = useId();

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
    <Card>
      <CardHeader>
        <CardTitle>Şirketini kur</CardTitle>
        <CardDescription>Şirketi kuran kişi yönetici olur; çalışanlarını davet koduyla eklersin.</CardDescription>
      </CardHeader>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Field id={nameId} label="Şirket adı">
          <Input id={nameId} name="name" minLength={2} maxLength={100} required />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        {created ? <Alert variant="applied">{created}</Alert> : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Kuruluyor…' : 'Şirketi kur'}
        </Button>
      </form>
    </Card>
  );
}
