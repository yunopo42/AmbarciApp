'use client';

import { describeApiError } from '@ambarci/api-client';
import { createOperationSchema } from '@ambarci/shared';
import type { PartyType, Product } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { ProductPicker } from '@/components/product-picker';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, fieldDescriptionIds } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { useWarehouses } from '@/components/use-warehouses';
import { formatDecimal, inputToDecimal } from '@/lib/format';
import { issuesToFieldErrors } from '@/lib/form-errors';
import type { FieldErrors } from '@/lib/form-errors';
import { OPERATION_TYPE_LABELS, PARTY_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

/** Ekrandan açılan beş işlem türü. Açılış stoğu (OPENING) seed betiğiyle girilir. */
const FORM_TYPES = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE'] as const;
type FormType = (typeof FORM_TYPES)[number];

const TYPE_HINTS: Record<FormType, string> = {
  STOCK_IN: 'Depoya mal girer. Birim maliyet girilirse hareketli ortalama maliyet güncellenir.',
  STOCK_OUT: 'Depodan mal çıkar. Stok yetmezse işlem onaylanmaz.',
  TRANSFER: 'Mal bir depodan ötekine geçer; hedef depoya çıktığı deponun ortalama maliyetiyle girer.',
  COUNT: 'Sayılan miktar girilir. Fark, onay anındaki stoğa göre hesaplanır (sayım fazlası ya da noksanı).',
  WASTE: 'Kırılan, bozulan ya da kaybolan mal stoktan düşülür.',
};

/** Girişte tedarikçi, çıkışta müşteri seçilebilir; diğer türlerde cari yok. */
const PARTY_TYPE_OF: Partial<Record<FormType, PartyType>> = { STOCK_IN: 'SUPPLIER', STOCK_OUT: 'CUSTOMER' };

interface Line {
  /** Yalnızca React listesi için. */
  key: number;
  product: Product | null;
  /** Boşsa ürünün ana birimi. */
  unit: string;
  quantity: string;
  unitCost: string;
}

/** İşlem açma hatasının (422 OPERATION_LINES_INVALID) kalem ayrıntısı. */
interface LineError {
  lineNo: number;
  field: string;
  message: string;
}

function isLineError(value: unknown): value is LineError {
  const candidate = value as Partial<LineError> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.lineNo === 'number' &&
    typeof candidate.field === 'string' &&
    typeof candidate.message === 'string'
  );
}

/** Yeni stok işlemi (fiş). Kaydedilen işlem onay bekler; stok, özet ekranında onaylanınca değişir. */
export function OperationForm(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Yeni stok işlemi"
        description="İşlem önce onay bekleyen olarak kaydedilir. Stok, sonraki ekranda özeti görüp onayladığında değişir."
      />
      <OrganizationGate>{() => <OperationFormBody />}</OrganizationGate>
    </>
  );
}

function OperationFormBody(): JSX.Element {
  const { $api } = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const create = $api.useMutation('post', '/v1/operations');
  const nextKey = useRef(1);

  const [type, setType] = useState<FormType>('STOCK_IN');
  const [warehouseId, setWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 0, product: null, unit: '', quantity: '', unitCost: '' }]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const partyType = PARTY_TYPE_OF[type];
  const parties = $api.useQuery(
    'get',
    '/v1/parties',
    { params: { query: { type: partyType, status: 'active', pageSize: 100 } } },
    { enabled: Boolean(partyType) },
  );

  // İşlem yalnızca kullanıcının yetkili olduğu aktif depolarda açılabilir.
  const options = warehouses.permitted.filter((warehouse) => warehouse.isActive);
  const sourceId = warehouseId || options[0]?.id || '';
  const targetOptions = options.filter((warehouse) => warehouse.id !== sourceId);
  const targetId = targetWarehouseId && targetWarehouseId !== sourceId ? targetWarehouseId : (targetOptions[0]?.id ?? '');
  const saving = create.isPending;

  function updateLine(key: number, patch: Partial<Omit<Line, 'key'>>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number): void {
    setLines((current) => current.filter((line) => line.key !== key));
    // Kalem hataları satır sırasına bağlı; satır silinince yanlış satırda kalmasın.
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => !path.startsWith('items'))));
  }

  function changeType(next: FormType): void {
    setType(next);
    if (PARTY_TYPE_OF[next] !== partyType) {
      setPartyId('');
    }
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    // Ürünü ya da deposu seçilmemiş kalem şemanın İngilizce "geçersiz UUID" mesajına düşmesin.
    const missing: FieldErrors = {};
    if (!sourceId) {
      missing.warehouseId = 'Depo seçin.';
    }
    if (type === 'TRANSFER' && !targetId) {
      missing.targetWarehouseId = 'Hedef depo seçin.';
    }
    lines.forEach((line, index) => {
      if (!line.product) {
        missing[`items.${index}.productId`] = 'Ürün seçin.';
      }
    });
    if (lines.length === 0) {
      missing.items = 'En az bir kalem ekleyin.';
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    // Paylaşılan şemayla kontrol: API'nin işlem açarken kullandığı şemanın aynısı.
    const parsed = createOperationSchema.safeParse({
      type,
      partyId: partyType && partyId ? partyId : undefined,
      note: note.trim() || undefined,
      items: lines.map((line) => ({
        productId: line.product?.id,
        warehouseId: sourceId,
        targetWarehouseId: type === 'TRANSFER' ? targetId : undefined,
        quantity: inputToDecimal(line.quantity),
        unit: line.unit || undefined,
        unitCost: type === 'STOCK_IN' && line.unitCost.trim() ? inputToDecimal(line.unitCost) : undefined,
      })),
    });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      const operation = await create.mutateAsync({ body: parsed.data });
      // Yeni işlem onay bekleyenler listesine girer.
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/operations'] });
      router.push(`/operations/${operation.id}`);
    } catch (reason) {
      const failure = describeApiError(reason);
      if (failure.code === 'OPERATION_LINES_INVALID' && Array.isArray(failure.details)) {
        const fieldErrors: FieldErrors = {};
        for (const detail of failure.details.filter(isLineError)) {
          const path =
            detail.field === 'warehouseId' || detail.field === 'targetWarehouseId'
              ? detail.field
              : `items.${detail.lineNo - 1}.${detail.field}`;
          fieldErrors[path] ??= detail.message;
        }
        setErrors(fieldErrors);
      } else if (failure.code === 'PARTY_NOT_FOUND') {
        setErrors({ partyId: failure.message });
      }
      setFormError(failure.message);
    }
  }

  if (warehouses.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        Depolar yükleniyor…
      </p>
    );
  }
  if (warehouses.error) {
    return <Alert>{warehouses.error}</Alert>;
  }
  if (options.length === 0) {
    return (
      <Alert>
        İşlem yapabileceğin aktif bir depo yok. Yöneticin Üyeler ekranından sana depo yetkisi vermeli ya da bir depo
        eklemeli.
      </Alert>
    );
  }

  const quantityLabel = type === 'COUNT' ? 'Sayılan miktar' : 'Miktar';
  const pickedLine = lines.find((line) => line.key === pickerFor);

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-6">
      {formError ? <Alert>{formError}</Alert> : null}
      <fieldset disabled={saving} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>İşlem</CardTitle>
          </CardHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-body-md-medium text-text">İşlem türü</legend>
            <div className="flex flex-wrap gap-2">
              {FORM_TYPES.map((option) => (
                <label key={option} className="cursor-pointer">
                  <input
                    type="radio"
                    name="operation-type"
                    value={option}
                    checked={type === option}
                    onChange={() => changeType(option)}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-12 items-center rounded-full border border-border-strong bg-card px-5 text-label-lg text-primary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-action">
                    {OPERATION_TYPE_LABELS[option]}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-text-muted">{TYPE_HINTS[type]}</p>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <Field id="warehouseId" label={type === 'TRANSFER' ? 'Çıkış deposu' : 'Depo'} error={errors.warehouseId}>
              <NativeSelect
                id="warehouseId"
                value={sourceId}
                onChange={(event) => setWarehouseId(event.target.value)}
                aria-invalid={Boolean(errors.warehouseId)}
                aria-describedby={fieldDescriptionIds('warehouseId', { error: errors.warehouseId })}
              >
                {options.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {type === 'TRANSFER' ? (
              <Field id="targetWarehouseId" label="Hedef depo" error={errors.targetWarehouseId ?? errors['items.0.targetWarehouseId']}>
                <NativeSelect
                  id="targetWarehouseId"
                  value={targetId}
                  onChange={(event) => setTargetWarehouseId(event.target.value)}
                  disabled={targetOptions.length === 0}
                >
                  {targetOptions.length === 0 ? <option value="">Başka yetkili depo yok</option> : null}
                  {targetOptions.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {partyType ? (
              <Field
                id="partyId"
                label={`${PARTY_TYPE_LABELS[partyType]} (isteğe bağlı)`}
                hint={parties.data && parties.data.total > parties.data.items.length ? 'İlk 100 cari listeleniyor.' : undefined}
                error={errors.partyId}
              >
                <NativeSelect id="partyId" value={partyId} onChange={(event) => setPartyId(event.target.value)}>
                  <option value="">Seçilmedi</option>
                  {(parties.data?.items ?? []).map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field id="note" label="Not (isteğe bağlı)" error={errors.note}>
              <Input id="note" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kalemler</CardTitle>
            <CardDescription>
              Miktar seçilen birimde girilir (ondalık için virgül: 12,5). Ana birim karşılığı ve stoğun önceki/sonraki
              hâli özet ekranında sunucuda hesaplanır.
            </CardDescription>
          </CardHeader>
          {errors.items ? <p className="text-label-md text-critical">{errors.items}</p> : null}
          <ol className="flex flex-col gap-3">
            {lines.map((line, index) => {
              const order = index + 1;
              const productError = errors[`items.${index}.productId`];
              const unitError = errors[`items.${index}.unit`];
              const quantityError = errors[`items.${index}.quantity`];
              const costError = errors[`items.${index}.unitCost`];
              const unit = line.product?.units.find((item) => item.unit === line.unit);
              return (
                <li
                  key={line.key}
                  className={cn(
                    'grid items-start gap-3 rounded-md border border-divider p-3',
                    type === 'STOCK_IN' ? 'lg:grid-cols-[2fr_1fr_1fr_1fr_auto]' : 'lg:grid-cols-[2fr_1fr_1fr_auto]',
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <span id={`line-${line.key}-product-label`} className="text-body-md-medium text-text">
                      {order}. ürün
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickerFor(line.key)}
                      aria-labelledby={`line-${line.key}-product-label line-${line.key}-product`}
                      aria-describedby={productError ? `line-${line.key}-product-error` : undefined}
                      className={cn(
                        'flex min-h-12 w-full cursor-pointer flex-col items-start justify-center rounded-md border-[1.5px] border-border-strong bg-card px-3 py-1 text-left focus-visible:outline-2 focus-visible:outline-primary-action',
                        productError && 'border-critical',
                      )}
                    >
                      <span id={`line-${line.key}-product`}>
                        {line.product ? (
                          <>
                            <span className="block text-body-md-medium text-text">{line.product.name}</span>
                            <span className="block text-label-md font-normal text-text-muted tabular-nums">{line.product.sku}</span>
                          </>
                        ) : (
                          <span className="text-text-subtle">Ürün seç…</span>
                        )}
                      </span>
                    </button>
                    {productError ? (
                      <p id={`line-${line.key}-product-error`} className="text-label-md text-critical">
                        {productError}
                      </p>
                    ) : null}
                  </div>
                  <Field
                    id={`line-${line.key}-unit`}
                    label="Birim"
                    hint={unit && line.product ? `1 ${unit.unit} = ${formatDecimal(unit.factor)} ${line.product.baseUnit}` : undefined}
                    error={unitError}
                  >
                    <NativeSelect
                      id={`line-${line.key}-unit`}
                      value={line.unit}
                      disabled={!line.product}
                      onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                      aria-describedby={fieldDescriptionIds(`line-${line.key}-unit`, { hint: Boolean(unit), error: unitError })}
                    >
                      <option value="">{line.product ? `${line.product.baseUnit} (ana birim)` : '—'}</option>
                      {(line.product?.units ?? []).map((item) => (
                        <option key={item.unit} value={item.unit}>
                          {item.unit}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id={`line-${line.key}-quantity`} label={quantityLabel} error={quantityError}>
                    <Input
                      id={`line-${line.key}-quantity`}
                      value={line.quantity}
                      inputMode="decimal"
                      className="tabular-nums"
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      aria-invalid={Boolean(quantityError)}
                      aria-describedby={fieldDescriptionIds(`line-${line.key}-quantity`, { error: quantityError })}
                    />
                  </Field>
                  {type === 'STOCK_IN' ? (
                    <Field
                      id={`line-${line.key}-cost`}
                      label="Birim maliyet (isteğe bağlı)"
                      hint={`TL, 1 ${line.unit || line.product?.baseUnit || 'birim'} için`}
                      error={costError}
                    >
                      <Input
                        id={`line-${line.key}-cost`}
                        value={line.unitCost}
                        inputMode="decimal"
                        className="tabular-nums"
                        onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                        aria-invalid={Boolean(costError)}
                        aria-describedby={fieldDescriptionIds(`line-${line.key}-cost`, { hint: true, error: costError })}
                      />
                    </Field>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="lg:mt-6"
                    disabled={lines.length === 1}
                    aria-label={`${order}. kalemi kaldır`}
                    onClick={() => removeLine(line.key)}
                  >
                    <X aria-hidden />
                    Kaldır
                  </Button>
                </li>
              );
            })}
          </ol>
          <Button
            variant="secondary"
            className="self-start"
            disabled={lines.length >= 100}
            onClick={() => {
              const key = nextKey.current;
              nextKey.current += 1;
              setLines((current) => [...current, { key, product: null, unit: '', quantity: '', unitCost: '' }]);
            }}
          >
            <Plus aria-hidden />
            Kalem ekle
          </Button>
        </Card>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Özeti gör'}
        </Button>
        <Link href="/stock" className={buttonVariants({ variant: 'secondary' })}>
          Vazgeç
        </Link>
        <p className="text-text-muted">Bu adımda stok değişmez.</p>
      </div>

      <ProductPicker
        open={pickerFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPickerFor(null);
          }
        }}
        onSelect={(product) => {
          if (pickedLine) {
            // Ürün değişince birim ana birime döner; eski ürünün birimi yeni üründe olmayabilir.
            updateLine(pickedLine.key, { product, unit: '' });
          }
          setPickerFor(null);
        }}
      />
    </form>
  );
}
