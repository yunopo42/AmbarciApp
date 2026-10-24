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
import { ROLE_LABELS } from '@/lib/labels';

/** Yöneticinin verdiği davet koduyla şirkete katılır; katılınan şirket aktif şirket yapılır. */
export function JoinOrganizationForm(): JSX.Element {
  const { reload } = useOrganizations();
  const { $api } = useApi();
  const accept = $api.useMutation('post', '/v1/invitations/accept');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const pending = accept.isPending;
  const codeId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const code = String(new FormData(formElement).get('code') ?? '');
    setError(null);
    setJoined(null);
    try {
      const organization = await accept.mutateAsync({ body: { code } });
      setJoined(`${organization.name} şirketine ${ROLE_LABELS[organization.role].toLocaleLowerCase('tr-TR')} olarak katıldın.`);
      formElement.reset();
      await reload(organization.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Davet koduyla katıl</CardTitle>
        <CardDescription>Yöneticinden aldığın kodu gir. Büyük/küçük harf ve tire farkı önemli değil.</CardDescription>
      </CardHeader>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Field id={codeId} label="Davet kodu">
          <Input
            id={codeId}
            name="code"
            autoComplete="off"
            minLength={8}
            maxLength={32}
            required
            className="tracking-widest uppercase tabular-nums"
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        {joined ? <Alert variant="applied">{joined}</Alert> : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Katılınıyor…' : 'Katıl'}
        </Button>
      </form>
    </Card>
  );
}
