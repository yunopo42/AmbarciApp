'use client';

import { partyInputSchema, partyTypeSchema, recordStatusFilterSchema } from '@ambarci/shared';
import type { Party, PartyType, RecordStatusFilter } from '@ambarci/shared';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import type { PaginationState } from '@tanstack/react-table';
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
import { SearchInput } from '@/components/ui/search-input';
import { errorMessage } from '@/lib/api-client';
import { apiErrorToForm, issuesToFieldErrors } from '@/lib/form-errors';
import type { FieldErrors } from '@/lib/form-errors';
import { PARTY_TYPE_LABELS, RECORD_STATUS_LABELS } from '@/lib/labels';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const PAGE_SIZE = 25;
const PARTY_CONFLICT_FIELDS: Record<string, string> = { PARTY_TAX_ID_TAKEN: 'taxId' };

const column = createColumnHelper<typeof dataTableFeatures, Party>();

const partyColumns: DataTableColumns<Party> = column.columns([
  column.accessor('name', {
    header: 'Ad',
    cell: (info) => <span className="text-body-md-medium">{info.getValue()}</span>,
  }),
  column.accessor('type', { header: 'Tür', cell: (info) => PARTY_TYPE_LABELS[info.getValue()] }),
  column.accessor('taxId', {
    header: 'VKN / TCKN',
    cell: (info) => <span className="tabular-nums">{info.getValue() ?? '—'}</span>,
  }),
  column.accessor('isActive', { header: 'Durum', cell: (info) => <RecordStatusBadge isActive={info.getValue()} /> }),
]);

/** Tür süzgeci: boş değer "hepsi" demek; API'ye `type` gönderilmez. */
type PartyTypeFilter = PartyType | '';

type Editing = Party | 'new' | null;

/** Cariler (tedarikçi ve müşteri): arama, tür ve durum süzgeci, sayfalama sunucuda. Değiştirme yalnızca yöneticide. */
export function PartyList(): JSX.Element {
  const { active } = useOrganizations();
  const canEdit = active?.role === 'ADMIN';
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <>
      <PageHeader
        title="Cariler"
        description="Tedarikçiler ve müşteriler. Giriş ve çıkış işlemlerinde karşı taraf olarak seçilir."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              Yeni cari
            </Button>
          ) : null
        }
      />
      <OrganizationGate>
        {() => (
          <>
            <PartyTable canEdit={canEdit} onEdit={setEditing} />
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
                  <PartyFormDialog party={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
                ) : null}
              </Dialog>
            ) : null}
          </>
        )}
      </OrganizationGate>
    </>
  );
}

function PartyTable({ canEdit, onEdit }: { canEdit: boolean; onEdit: (party: Party) => void }): JSX.Element {
  const { $api } = useApi();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<PartyTypeFilter>('');
  const [status, setStatus] = useState<RecordStatusFilter>('active');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const debouncedSearch = useDebouncedValue(search.trim());

  const query = $api.useQuery(
    'get',
    '/v1/parties',
    {
      params: {
        query: {
          search: debouncedSearch || undefined,
          type: type || undefined,
          status,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );

  const columns = useMemo<DataTableColumns<Party>>(
    () =>
      canEdit
        ? [
            ...partyColumns,
            column.display({
              id: 'actions',
              header: () => <span className="sr-only">İşlemler</span>,
              cell: ({ row }) => (
                <Button variant="ghost" size="sm" onClick={() => onEdit(row.original)} aria-label={`${row.original.name} carisini düzenle`}>
                  <Pencil aria-hidden />
                  Düzenle
                </Button>
              ),
              meta: { className: 'w-0 text-right' },
            }),
          ]
        : partyColumns,
    [canEdit, onEdit],
  );

  function resetPage(): void {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Field id="party-search" label="Ara" className="w-full sm:max-w-sm">
          <SearchInput
            id="party-search"
            placeholder="Ad ya da vergi numarası"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
          />
        </Field>
        <Field id="party-type" label="Tür" className="w-40">
          <NativeSelect
            id="party-type"
            value={type}
            onChange={(event) => {
              const value = event.target.value;
              setType(value === '' ? '' : partyTypeSchema.parse(value));
              resetPage();
            }}
          >
            <option value="">Tümü</option>
            {partyTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {PARTY_TYPE_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="party-status" label="Durum" className="w-40">
          <NativeSelect
            id="party-status"
            value={status}
            onChange={(event) => {
              setStatus(recordStatusFilterSchema.parse(event.target.value));
              resetPage();
            }}
          >
            {recordStatusFilterSchema.options.map((option) => (
              <option key={option} value={option}>
                {RECORD_STATUS_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {query.isError ? <Alert>{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? (
        <p aria-live="polite" className="text-text-muted">
          Cariler yükleniyor…
        </p>
      ) : query.data ? (
        <DataTable
          label="Cariler"
          columns={columns}
          data={query.data.items}
          getRowId={(party) => party.id}
          emptyMessage={debouncedSearch || type ? 'Süzgece uyan cari yok.' : 'Bu listede cari yok.'}
          pagination={{ state: pagination, onChange: setPagination, rowCount: query.data.total }}
          isFetching={query.isPlaceholderData}
        />
      ) : null}
    </div>
  );
}

function PartyFormDialog({ party, onDone }: { party: Party | null; onDone: () => void }): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const create = $api.useMutation('post', '/v1/parties');
  const update = $api.useMutation('put', '/v1/parties/{partyId}');
  const [name, setName] = useState(party?.name ?? '');
  const [type, setType] = useState<PartyType>(party?.type ?? 'SUPPLIER');
  const [taxId, setTaxId] = useState(party?.taxId ?? '');
  const [isActive, setIsActive] = useState(party?.isActive ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const parsed = partyInputSchema.safeParse({ name, type, taxId: taxId.trim() || null, isActive });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      if (party) {
        await update.mutateAsync({ params: { path: { partyId: party.id } }, body: parsed.data });
      } else {
        await create.mutateAsync({ body: parsed.data });
      }
      await queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/v1/parties').queryKey });
      onDone();
    } catch (reason) {
      const result = apiErrorToForm(reason, PARTY_CONFLICT_FIELDS);
      setErrors(result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{party ? 'Cariyi düzenle' : 'Yeni cari'}</DialogTitle>
        <DialogDescription>Cari silinmez; çalışılmayacaksa pasife alınır, geçmiş işlemlerdeki kaydı kalır.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert>{formError}</Alert> : null}
        <fieldset disabled={saving} className="flex flex-col gap-4">
          <Field id="party-name" label="Ad" error={errors.name}>
            <Input
              id="party-name"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={fieldDescriptionIds('party-name', { error: errors.name })}
            />
          </Field>
          <Field id="party-form-type" label="Tür" error={errors.type}>
            <NativeSelect id="party-form-type" value={type} onChange={(event) => setType(partyTypeSchema.parse(event.target.value))}>
              {partyTypeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {PARTY_TYPE_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="party-tax-id" label="VKN / TCKN (isteğe bağlı)" hint="VKN 10, TCKN 11 hane; şirket içinde benzersiz." error={errors.taxId}>
            <Input
              id="party-tax-id"
              value={taxId}
              inputMode="numeric"
              maxLength={11}
              autoComplete="off"
              className="tabular-nums"
              onChange={(event) => setTaxId(event.target.value)}
              aria-invalid={Boolean(errors.taxId)}
              aria-describedby={fieldDescriptionIds('party-tax-id', { hint: true, error: errors.taxId })}
            />
          </Field>
          {party ? (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body-md-medium">
              <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              Aktif
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
