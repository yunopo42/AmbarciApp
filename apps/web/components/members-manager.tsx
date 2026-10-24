'use client';

import type { Member } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { InvitationGenerator } from '@/components/invitation-generator';
import { useOrganizations } from '@/components/organization-provider';
import { errorMessage } from '@/lib/api-client';
import { ROLE_LABELS } from '@/lib/labels';

/** Yönetici ekranı: davet kodu üretme, üyeler ve çalışanların depo yetkileri. */
export function MembersManager(): JSX.Element {
  const { active } = useOrganizations();
  if (!active) {
    return <p>Önce ana sayfadan bir şirket kur ya da bir şirkete katıl.</p>;
  }
  if (active.role !== 'ADMIN') {
    return <p>Bu sayfa yalnızca şirket yöneticilerine açık.</p>;
  }
  // Şirket değişince şirket katmanı (istemci ve önbellek) baştan kurulur.
  return <MembersPanel />;
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
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <InvitationGenerator />
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Üyeler ve depo yetkileri</h2>
        <p className="text-sm">
          Yöneticiler tüm depolarda işlem yapabilir. Çalışanlar yalnızca işaretli depolarda işlem yapabilir.
        </p>
        {members.isPending || warehouses.isPending ? <p aria-live="polite">Üyeler yükleniyor…</p> : null}
        {failed ? <p role="alert">{errorMessage(failed)}</p> : null}
        {actionError ? <p role="alert">{actionError}</p> : null}
        {members.data && warehouses.data ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Üye</th>
                  <th className="p-2">Rol</th>
                  {warehouses.data.map((warehouse) => (
                    <th key={warehouse.id} className="p-2">
                      {warehouse.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.data.map((member) => (
                  <tr key={member.id} className="border-b">
                    <td className="p-2">
                      {member.email ?? member.userId}
                      {member.isActive ? '' : ' (pasif)'}
                    </td>
                    <td className="p-2">{ROLE_LABELS[member.role]}</td>
                    {warehouses.data.map((warehouse) => {
                      const key = `${member.id}:${warehouse.id}`;
                      const granted = member.warehouseIds.includes(warehouse.id);
                      return (
                        <td key={warehouse.id} className="p-2">
                          {member.role === 'ADMIN' ? (
                            <span className="text-sm">Tümü</span>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`${member.email ?? member.userId}: ${warehouse.name} yetkisi`}
                              checked={granted}
                              disabled={busyKey === key}
                              onChange={(event) => void toggleAccess(member, warehouse.id, event.target.checked)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
