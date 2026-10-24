'use client';

import type { Invitation, OrganizationRole } from '@ambarci/shared';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { errorMessage } from '@/lib/api-client';
import { formatDateTime, ROLE_LABELS } from '@/lib/labels';

/** Yönetici için tek kullanımlık, süreli davet kodu üretir (aktif şirket adına). */
export function InvitationGenerator(): JSX.Element {
  const { $api } = useApi();
  const create = $api.useMutation('post', '/v1/invitations');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = create.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setCopied(false);
    try {
      setInvitation(
        await create.mutateAsync({
          body: { role: String(form.get('role')) as OrganizationRole, expiresInDays: Number(form.get('expiresInDays')) },
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
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
    <Card>
      <CardHeader>
        <CardTitle>Davet kodu üret</CardTitle>
        <CardDescription>Kod tek kullanımlıktır ve seçilen süre sonunda geçersiz olur.</CardDescription>
      </CardHeader>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-wrap items-end gap-3">
        <Field id="invitation-role" label="Rol" className="w-44">
          <NativeSelect id="invitation-role" name="role" defaultValue="EMPLOYEE">
            <option value="EMPLOYEE">{ROLE_LABELS.EMPLOYEE}</option>
            <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
          </NativeSelect>
        </Field>
        <Field id="invitation-days" label="Geçerlilik (gün)" className="w-36">
          <Input id="invitation-days" name="expiresInDays" type="number" min={1} max={30} defaultValue={7} required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Üretiliyor…' : 'Kod üret'}
        </Button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
      {invitation ? (
        <div className="flex flex-col gap-2 rounded-md border border-divider bg-canvas p-4" aria-live="polite">
          <p className="flex flex-wrap items-center gap-3">
            <span className="text-text-muted">Kod:</span>
            <strong className="text-headline-md tracking-widest text-primary tabular-nums">{invitation.code}</strong>
            <Button variant="secondary" size="sm" onClick={() => void copyCode(invitation.code)}>
              <Copy aria-hidden />
              {copied ? 'Kopyalandı' : 'Kodu kopyala'}
            </Button>
          </p>
          <p className="text-text-muted">
            {ROLE_LABELS[invitation.role]} olarak katılım için, {formatDateTime(invitation.expiresAt)} tarihine kadar
            ve bir kez kullanılabilir. Kodu yalnızca davet ettiğin kişiyle paylaş.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
