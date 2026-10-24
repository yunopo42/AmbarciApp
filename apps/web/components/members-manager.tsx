'use client';

import type { Member } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { InvitationGenerator } from '@/components/invitation-generator';
import { OrganizationGate } from '@/components/organization-gate';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CardDescription, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api-client';
import { ROLE_LABELS } from '@/lib/labels';

/** Yönetici ekranı: davet kodu üretme, üyeler ve çalışanların depo yetkileri. */
export function MembersManager(): JSX.Element {
  // Şirket değişince şirket katmanı (istemci ve önbellek) baştan kurulur.
  return <OrganizationGate adminOnly>{() => <MembersPanel />}</OrganizationGate>;
}

function MembersPanel(): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const members = $api.useQuery('get', '/v1/members');
  const warehouses = $api.useQuery('get', '/v1/warehouses');
  const grant = $api.useMutation('put', '/v1/members/{memberId}/warehouses/{warehouseId}');
  const revoke = $api.useMutation('delete', '/v1/members/{memberId}/warehouses/{warehouseId}');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function toggleAccess(member: Member, warehouseId: string, granted: boolean): Promise<void> {
    setBusyKey(`${member.id}:${warehouseId}`);
    setActionError(null);
    try {
      const params = { path: { memberId: member.id, warehouseId } };
      await (granted ? grant : revoke).mutateAsync({ params });
      // Üye listesi sunucudan yeniden okunur; ekrandaki işaretler veritabanındaki yetkiyle aynı kalır.
      await queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/v1/members').queryKey });
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusyKey(null);
    }
  }

  const failed = members.isError ? members.error : warehouses.isError ? warehouses.error : null;

  return (
    <div className="flex flex-col gap-6">
      <InvitationGenerator />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Üyeler ve depo yetkileri</CardTitle>
          <CardDescription>
            Yöneticiler tüm depolarda işlem yapabilir. Çalışanlar yalnızca işaretli depolarda işlem yapabilir.
          </CardDescription>
        </div>
        {members.isPending || warehouses.isPending ? (
          <p aria-live="polite" className="text-text-muted">
            Üyeler yükleniyor…
          </p>
        ) : null}
        {failed ? <Alert>{errorMessage(failed)}</Alert> : null}
        {actionError ? <Alert>{actionError}</Alert> : null}
        {members.data && warehouses.data ? (
          <Table aria-label="Üyeler ve depo yetkileri">
            <TableHeader>
              <TableRow className="h-auto border-0">
                <TableHead>Üye</TableHead>
                <TableHead>Rol</TableHead>
                {warehouses.data.map((warehouse) => (
                  <TableHead key={warehouse.id} className="text-center">
                    {warehouse.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.map((member) => {
                const memberName = member.email ?? member.userId;
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body-md-medium">{memberName}</span>
                        {member.isActive ? null : <Badge variant="muted">Pasif</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                    {warehouses.data.map((warehouse) => {
                      const key = `${member.id}:${warehouse.id}`;
                      const granted = member.warehouseIds.includes(warehouse.id);
                      return (
                        <TableCell key={warehouse.id} className="text-center">
                          {member.role === 'ADMIN' ? (
                            <span className="text-text-muted">Tümü</span>
                          ) : (
                            // Görünen kutu 22 px, tıklanabilir alan 48 px (docs/tasarim.md, onay kutusu).
                            <label className="inline-flex size-12 cursor-pointer items-center justify-center">
                              <Checkbox
                                aria-label={`${memberName}: ${warehouse.name} yetkisi`}
                                checked={granted}
                                disabled={busyKey === key}
                                onChange={(event) => void toggleAccess(member, warehouse.id, event.target.checked)}
                              />
                            </label>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
