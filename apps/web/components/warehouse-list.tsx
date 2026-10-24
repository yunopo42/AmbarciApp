'use client';

import { warehouseInputSchema, warehouseTypeSchema } from '@ambarci/shared';
import type { Warehouse, WarehouseType } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { useOrganizations } from '@/components/organization-provider';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { RecordStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, fieldDescriptionIds } from '@/components/ui/field';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import { errorMessage } from '@/lib/api-client';
import { apiErrorToForm, issuesToFieldErrors } from '@/lib/form-errors';
import type { FieldErrors } from '@/lib/form-errors';
import { WAREHOUSE_TYPE_LABELS } from '@/lib/labels';

const WAREHOUSE_CONFLICT_FIELDS: Record<string, string> = { WAREHOUSE_NAME_TAKEN: 'name' };

const column = createColumnHelper<typeof dataTableFeatures, Warehouse>();

const warehouseColumns: DataTableColumns<Warehouse> = column.columns([
  column.accessor('name', {
    header: 'Ad',
    cell: (info) => <span className="text-body-md-medium">{info.getValue()}</span>,
  }),
  column.accessor('type', { header: 'Tür', cell: (info) => WAREHOUSE_TYPE_LABELS[info.getValue()] }),
  column.accessor('isActive', { header: 'Durum', cell: (info) => <RecordStatusBadge isActive={info.getValue()} /> }),
]);

/** "Yeni depo" ya da düzenlenen depo; null iken pencere kapalı. */
type Editing = Warehouse | 'new' | null;

/**
 * Depolar, şubeler ve araç depoları. Liste kısa olduğu için sayfalamasız; pasif depolar da rozetle görünür.
 * Ekleme ve düzenleme yalnızca yöneticiye görünür.
 */
export function WarehouseList(): JSX.Element {
  const { active } = useOrganizations();
  const canEdit = active?.role === 'ADMIN';
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <>
      <PageHeader
        title="Depolar"
        description="Depo, şube ve araç depoları. Asistan depoyu adıyla bulur."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              Yeni depo
            </Button>
          ) : null
        }
      />
      <OrganizationGate>
        {() => (
          <>
            <WarehouseTable canEdit={canEdit} onEdit={setEditing} />
            {canEdit ? (
              <Dialog
                open={editing !== null}
                onOpenChange={(open) => {
                  if (!open) {
                    setEditing(null);
                  }
                }}
              >
                {editing !== null ? (
                  <WarehouseFormDialog warehouse={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
                ) : null}
              </Dialog>
            ) : null}
          </>
        )}
      </OrganizationGate>
    </>
  );
}

function WarehouseTable({ canEdit, onEdit }: { canEdit: boolean; onEdit: (warehouse: Warehouse) => void }): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/warehouses');

  // Düzenle düğmesi pencereyi açan fonksiyona bağlı; kolonlar yalnızca o değişince yeniden kurulur.
  const columns = useMemo<DataTableColumns<Warehouse>>(
    () =>
      canEdit
        ? [
            ...warehouseColumns,
            column.display({
              id: 'actions',
              header: () => <span className="sr-only">İşlemler</span>,
              cell: ({ row }) => (
                <Button variant="ghost" size="sm" onClick={() => onEdit(row.original)} aria-label={`${row.original.name} deposunu düzenle`}>
                  <Pencil aria-hidden />
                  Düzenle
                </Button>
              ),
              meta: { className: 'w-0 text-right' },
            }),
          ]
        : warehouseColumns,
    [canEdit, onEdit],
  );

  if (query.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        Depolar yükleniyor…
      </p>
    );
  }
  if (query.isError) {
    return <Alert>{errorMessage(query.error)}</Alert>;
  }
  return (
    <DataTable
      label="Depolar"
      columns={columns}
      data={query.data}
      getRowId={(warehouse) => warehouse.id}
      emptyMessage={canEdit ? 'Henüz depo yok. "Yeni depo" ile ilk deponu ekle.' : 'Bu şirkette henüz depo yok.'}
    />
  );
}

function WarehouseFormDialog({ warehouse, onDone }: { warehouse: Warehouse | null; onDone: () => void }): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const create = $api.useMutation('post', '/v1/warehouses');
  const update = $api.useMutation('put', '/v1/warehouses/{warehouseId}');
  const [name, setName] = useState(warehouse?.name ?? '');
  const [type, setType] = useState<WarehouseType>(warehouse?.type ?? 'WAREHOUSE');
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const parsed = warehouseInputSchema.safeParse({ name, type, isActive });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      if (warehouse) {
        await update.mutateAsync({ params: { path: { warehouseId: warehouse.id } }, body: parsed.data });
      } else {
        await create.mutateAsync({ body: parsed.data });
      }
      // Depo listesini kullanan her ekran (depolar, üyelerin depo yetkileri) sunucudan yeniden okur.
      await queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/v1/warehouses').queryKey });
      onDone();
    } catch (reason) {
      const result = apiErrorToForm(reason, WAREHOUSE_CONFLICT_FIELDS);
      setErrors(result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{warehouse ? 'Depoyu düzenle' : 'Yeni depo'}</DialogTitle>
        <DialogDescription>Depo adı şirket içinde benzersiz olmalı. Depo silinmez; kullanılmayacaksa pasife alınır.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert>{formError}</Alert> : null}
        <fieldset disabled={saving} className="flex flex-col gap-4">
          <Field id="warehouse-name" label="Ad" error={errors.name}>
            <Input
              id="warehouse-name"
              value={name}
              maxLength={100}
              placeholder="Merkez Depo"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={fieldDescriptionIds('warehouse-name', { error: errors.name })}
            />
          </Field>
          <Field id="warehouse-type" label="Tür" error={errors.type}>
            <NativeSelect id="warehouse-type" value={type} onChange={(event) => setType(warehouseTypeSchema.parse(event.target.value))}>
              {warehouseTypeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {WAREHOUSE_TYPE_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {warehouse ? (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body-md-medium">
              <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              Aktif (pasif depo yeni işlemlerde kullanılamaz)
            </label>
          ) : null}
        </fieldset>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button type="submit" disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
