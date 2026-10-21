'use client';

import { memberListSchema, warehouseListSchema } from '@ambarci/shared';
import type { Member, Warehouse } from '@ambarci/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { InvitationGenerator } from '@/components/invitation-generator';
import { useOrganizations } from '@/components/organization-provider';
import { apiRequest, errorMessage } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/labels';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; members: Member[]; warehouses: Warehouse[] }
  | { kind: 'error'; message: string };

/** Yönetici ekranı: davet kodu üretme, üyeler ve çalışanların depo yetkileri. */
export function MembersManager(): JSX.Element {
  const { active } = useOrganizations();
  if (!active) {
    return <p>Önce ana sayfadan bir şirket kur ya da bir şirkete katıl.</p>;
  }
  if (active.role !== 'ADMIN') {
    return <p>Bu sayfa yalnızca şirket yöneticilerine açık.</p>;
  }
  // Şirket değişince ekran sıfırdan kurulur.
  return <MembersPanel key={active.id} organizationId={active.id} />;
}

function MembersPanel({ organizationId }: { organizationId: string }): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      apiRequest('/v1/members', { organizationId, schema: memberListSchema }),
      apiRequest('/v1/warehouses', { organizationId, schema: warehouseListSchema }),
    ])
      .then(([members, warehouses]) => current && setState({ kind: 'ready', members, warehouses }))
      .catch((reason: unknown) => current && setState({ kind: 'error', message: errorMessage(reason) }));
    return () => {
      current = false;
    };
  }, [organizationId]);

  async function toggleAccess(member: Member, warehouseId: string, grant: boolean): Promise<void> {
    const key = `${member.id}:${warehouseId}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await apiRequest(`/v1/members/${member.id}/warehouses/${warehouseId}`, {
        method: grant ? 'PUT' : 'DELETE',
        organizationId,
      });
      setState((previous) =>
        previous.kind !== 'ready'
          ? previous
          : {
              ...previous,
              members: previous.members.map((item) =>
                item.id !== member.id
                  ? item
                  : {
                      ...item,
                      warehouseIds: grant
                        ? [...item.warehouseIds, warehouseId]
                        : item.warehouseIds.filter((id) => id !== warehouseId),
                    },
              ),
            },
      );
    } catch (reason) {
      setActionError(errorMessage(reason));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <InvitationGenerator organizationId={organizationId} />
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Üyeler ve depo yetkileri</h2>
        <p className="text-sm">
          Yöneticiler tüm depolarda işlem yapabilir. Çalışanlar yalnızca işaretli depolarda işlem yapabilir.
        </p>
        {state.kind === 'loading' ? <p aria-live="polite">Üyeler yükleniyor…</p> : null}
        {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
        {actionError ? <p role="alert">{actionError}</p> : null}
        {state.kind === 'ready' ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b">
                  <th className="p-2">Üye</th>
                  <th className="p-2">Rol</th>
                  {state.warehouses.map((warehouse) => (
                    <th key={warehouse.id} className="p-2">
                      {warehouse.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.members.map((member) => (
                  <tr key={member.id} className="border-b">
                    <td className="p-2">
                      {member.email ?? member.userId}
                      {member.isActive ? '' : ' (pasif)'}
                    </td>
                    <td className="p-2">{ROLE_LABELS[member.role]}</td>
                    {state.warehouses.map((warehouse) => {
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
