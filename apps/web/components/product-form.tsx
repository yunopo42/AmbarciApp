'use client';

import { productInputSchema } from '@ambarci/shared';
import type { Product } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { FormEvent, JSX, KeyboardEvent } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { ProductMovements } from '@/components/product-movements';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, fieldDescriptionIds } from '@/components/ui/field';
import { Checkbox, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api-client';
import { decimalToInput, inputToDecimal } from '@/lib/format';
import { apiErrorToForm, issuesToFieldErrors } from '@/lib/form-errors';
import type { FieldErrors } from '@/lib/form-errors';

/** API'nin çakışma kodları ve hatanın gösterileceği alan (docs/katalog.md, kural 3–5). */
const PRODUCT_CONFLICT_FIELDS: Record<string, string> = {
  PRODUCT_SKU_TAKEN: 'sku',
  PRODUCT_BARCODE_TAKEN: 'barcode',
  UNIT_BARCODE_TAKEN: 'units',
  UNIT_IN_USE: 'units',
  BASE_UNIT_LOCKED: 'baseUnit',
};

interface UnitRow {
  /** Yalnızca React listesi için; API'ye gitmez. */
  key: number;
  unit: string;
  factor: string;
  barcode: string;
}

/** Formdaki hâli: alanlar metin, ondalıklar virgüllü yazılabilir; gönderilirken API biçimine çevrilir. */
interface ProductFormValues {
  sku: string;
  name: string;
  baseUnit: string;
  barcode: string;
  minStock: string;
  units: UnitRow[];
  aliases: string[];
  isActive: boolean;
}

function sameText(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

const backLink = (
  <Link href="/products" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-start' })}>
    <ArrowLeft aria-hidden />
    Ürünler
  </Link>
);

/** Yeni ürün sayfası (yalnızca yönetici). */
export function NewProduct(): JSX.Element {
  return (
    <>
      {backLink}
      <PageHeader title="Yeni ürün" description="Ürünü ek birimleri ve sahadaki adlarıyla birlikte kaydet." />
      <OrganizationGate adminOnly>{() => <ProductForm product={null} canEdit />}</OrganizationGate>
    </>
  );
}

/** Ürün düzenleme sayfası. Çalışan aynı sayfayı salt okunur görür; API de değiştirmesine izin vermez (403). */
export function EditProduct({ productId }: { productId: string }): JSX.Element {
  return (
    <>
      {backLink}
      <OrganizationGate>{(organization) => <ProductLoader productId={productId} canEdit={organization.role === 'ADMIN'} />}</OrganizationGate>
    </>
  );
}

function ProductLoader({ productId, canEdit }: { productId: string; canEdit: boolean }): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/products/{productId}', { params: { path: { productId } } });

  if (query.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        Ürün yükleniyor…
      </p>
    );
  }
  if (query.isError) {
    return <Alert>{errorMessage(query.error)}</Alert>;
  }
  return (
    <>
      <PageHeader
        title={canEdit ? 'Ürünü düzenle' : 'Ürün'}
        description={canEdit ? `${query.data.sku} · ${query.data.name}` : 'Ürünü yalnızca şirket yöneticisi değiştirebilir.'}
      />
      <ProductForm product={query.data} canEdit={canEdit} />
      <ProductMovements productId={productId} baseUnit={query.data.baseUnit} />
    </>
  );
}

function ProductForm({ product, canEdit }: { product: Product | null; canEdit: boolean }): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const create = $api.useMutation('post', '/v1/products');
  const update = $api.useMutation('put', '/v1/products/{productId}');
  const nextKey = useRef(0);
  const newKey = (): number => (nextKey.current += 1);

  const [values, setValues] = useState<ProductFormValues>(() => ({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    baseUnit: product?.baseUnit ?? '',
    barcode: product?.barcode ?? '',
    minStock: decimalToInput(product?.minStock ?? null),
    units: (product?.units ?? []).map((unit, index) => ({
      key: -(index + 1),
      unit: unit.unit,
      factor: decimalToInput(unit.factor),
      barcode: unit.barcode ?? '',
    })),
    aliases: product?.aliases ?? [],
    isActive: product?.isActive ?? true,
  }));
  const [aliasDraft, setAliasDraft] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateUnit(key: number, patch: Partial<Omit<UnitRow, 'key'>>): void {
    setValues((current) => ({
      ...current,
      units: current.units.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }

  function addAlias(): void {
    const alias = aliasDraft.trim();
    if (!alias) {
      return;
    }
    if (values.aliases.some((existing) => sameText(existing) === sameText(alias))) {
      setErrors((current) => ({ ...current, aliasDraft: 'Bu ad zaten listede.' }));
      return;
    }
    set('aliases', [...values.aliases, alias]);
    setAliasDraft('');
    setErrors(({ aliasDraft: _removed, ...rest }) => rest);
  }

  function handleAliasKey(event: KeyboardEvent<HTMLInputElement>): void {
    // Enter formu göndermesin; adı listeye eklesin.
    if (event.key === 'Enter') {
      event.preventDefault();
      addAlias();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    // Önce paylaşılan şemayla istemcide kontrol: API'nin kullandığı şemanın aynısı (packages/shared).
    const parsed = productInputSchema.safeParse({
      sku: values.sku,
      name: values.name,
      baseUnit: values.baseUnit,
      barcode: values.barcode.trim() || null,
      minStock: values.minStock.trim() ? inputToDecimal(values.minStock) : null,
      units: values.units.map((row) => ({
        unit: row.unit,
        factor: inputToDecimal(row.factor),
        barcode: row.barcode.trim() || null,
      })),
      aliases: values.aliases,
      isActive: values.isActive,
    });
    if (!parsed.success) {
      setErrors(issuesToFieldErrors(parsed.error.issues));
      setFormError('Formda düzeltilmesi gereken alanlar var.');
      return;
    }
    setErrors({});
    try {
      const saved = product
        ? await update.mutateAsync({ params: { path: { productId: product.id } }, body: parsed.data })
        : await create.mutateAsync({ body: parsed.data });
      // Liste (her sayfa ve arama) ve ürünün kendi sayfası sunucudan yeniden okunur.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/v1/products').queryKey }),
        queryClient.invalidateQueries({
          queryKey: $api.queryOptions('get', '/v1/products/{productId}', { params: { path: { productId: saved.id } } }).queryKey,
        }),
      ]);
      router.push('/products');
    } catch (reason) {
      const result = apiErrorToForm(reason, PRODUCT_CONFLICT_FIELDS);
      setErrors(result.fieldErrors);
      setFormError(result.formError);
    }
  }

  const unitErrors = Object.entries(errors).filter(([path]) => path === 'units' || /^units\.\d+$/.test(path));
  const aliasErrors = Object.entries(errors).filter(([path]) => path === 'aliases' || path.startsWith('aliases.'));

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-6">
      {formError ? <Alert>{formError}</Alert> : null}
      <fieldset disabled={!canEdit || saving} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ürün bilgileri</CardTitle>
          </CardHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="sku" label="SKU (stok kodu)" error={errors.sku}>
              <Input
                id="sku"
                value={values.sku}
                maxLength={40}
                autoComplete="off"
                onChange={(event) => set('sku', event.target.value)}
                aria-invalid={Boolean(errors.sku)}
                aria-describedby={fieldDescriptionIds('sku', { error: errors.sku })}
              />
            </Field>
            <Field id="name" label="Ürün adı" error={errors.name}>
              <Input
                id="name"
                value={values.name}
                maxLength={200}
                onChange={(event) => set('name', event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={fieldDescriptionIds('name', { error: errors.name })}
              />
            </Field>
            <Field
              id="baseUnit"
              label="Ana birim"
              hint="Stok bu birimde tutulur (adet, metre, kg). Hareketi olan ürünün ana birimi değiştirilemez."
              error={errors.baseUnit}
            >
              <Input
                id="baseUnit"
                value={values.baseUnit}
                maxLength={40}
                onChange={(event) => set('baseUnit', event.target.value)}
                aria-invalid={Boolean(errors.baseUnit)}
                aria-describedby={fieldDescriptionIds('baseUnit', { hint: true, error: errors.baseUnit })}
              />
            </Field>
            <Field id="barcode" label="Barkod (isteğe bağlı)" error={errors.barcode}>
              <Input
                id="barcode"
                value={values.barcode}
                maxLength={64}
                autoComplete="off"
                className="tabular-nums"
                onChange={(event) => set('barcode', event.target.value)}
                aria-invalid={Boolean(errors.barcode)}
                aria-describedby={fieldDescriptionIds('barcode', { error: errors.barcode })}
              />
            </Field>
            <Field
              id="minStock"
              label="Kritik stok (isteğe bağlı)"
              hint={`Ana birimde${values.baseUnit.trim() ? ` (${values.baseUnit.trim()})` : ''}, ör. 12,5. Boş bırakılırsa kritik stok uyarısı yapılmaz.`}
              error={errors.minStock}
            >
              <Input
                id="minStock"
                value={values.minStock}
                inputMode="decimal"
                className="tabular-nums"
                onChange={(event) => set('minStock', event.target.value)}
                aria-invalid={Boolean(errors.minStock)}
                aria-describedby={fieldDescriptionIds('minStock', { hint: true, error: errors.minStock })}
              />
            </Field>
            {product ? (
              <div className="flex flex-col gap-1">
                <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body-md-medium">
                  <Checkbox checked={values.isActive} onChange={(event) => set('isActive', event.target.checked)} />
                  Aktif
                </label>
                <p className="text-label-md font-normal text-text-muted">
                  Pasif ürün listelerde ve yeni işlemlerde görünmez; geçmiş hareketleri ve kaydı silinmez.
                </p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ek birimler</CardTitle>
            <CardDescription>
              Ana birim dışında kullanılan birimler ve kaç ana birim ettikleri (ör. 1 koli = 12 adet). İşlemde kullanılmış
              birim silinemez; katsayısı değişebilir, geçmiş hareketler eski katsayıyı saklar.
            </CardDescription>
          </CardHeader>
          {unitErrors.map(([path, message]) => (
            <p key={path} className="text-label-md text-critical">
              {message}
            </p>
          ))}
          {values.units.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {values.units.map((row, index) => {
                const unitError = errors[`units.${index}.unit`];
                const factorError = errors[`units.${index}.factor`];
                const barcodeError = errors[`units.${index}.barcode`];
                const order = index + 1;
                return (
                  <li key={row.key} className="grid items-start gap-3 rounded-md border border-divider p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                    <Field id={`unit-${row.key}`} label={`${order}. birim`} error={unitError}>
                      <Input
                        id={`unit-${row.key}`}
                        value={row.unit}
                        maxLength={40}
                        placeholder="koli"
                        onChange={(event) => updateUnit(row.key, { unit: event.target.value })}
                        aria-invalid={Boolean(unitError)}
                        aria-describedby={fieldDescriptionIds(`unit-${row.key}`, { error: unitError })}
                      />
                    </Field>
                    <Field
                      id={`factor-${row.key}`}
                      label={`Kaç ${values.baseUnit.trim() || 'ana birim'}`}
                      error={factorError}
                    >
                      <Input
                        id={`factor-${row.key}`}
                        value={row.factor}
                        inputMode="decimal"
                        placeholder="12"
                        className="tabular-nums"
                        onChange={(event) => updateUnit(row.key, { factor: event.target.value })}
                        aria-invalid={Boolean(factorError)}
                        aria-describedby={fieldDescriptionIds(`factor-${row.key}`, { error: factorError })}
                      />
                    </Field>
                    <Field id={`unit-barcode-${row.key}`} label="Barkod (isteğe bağlı)" error={barcodeError}>
                      <Input
                        id={`unit-barcode-${row.key}`}
                        value={row.barcode}
                        maxLength={64}
                        autoComplete="off"
                        className="tabular-nums"
                        onChange={(event) => updateUnit(row.key, { barcode: event.target.value })}
                        aria-invalid={Boolean(barcodeError)}
                        aria-describedby={fieldDescriptionIds(`unit-barcode-${row.key}`, { error: barcodeError })}
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      className="md:mt-6"
                      aria-label={`${order}. birimi kaldır`}
                      onClick={() => {
                        set('units', values.units.filter((item) => item.key !== row.key));
                        // Birim hataları satır sırasına bağlı; satır silinince kayan hatalar yanlış satırda kalmasın.
                        setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => !path.startsWith('units'))));
                      }}
                    >
                      <X aria-hidden />
                      Kaldır
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <Button
            variant="secondary"
            className="self-start"
            disabled={values.units.length >= 10}
            onClick={() => set('units', [...values.units, { key: newKey(), unit: '', factor: '', barcode: '' }])}
          >
            <Plus aria-hidden />
            Birim ekle
          </Button>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alternatif adlar</CardTitle>
            <CardDescription>
              Sahada kullanılan diğer adlar (ör. &quot;üçlü priz&quot;). Asistan ve arama ürünü bu adlarla da bulur.
            </CardDescription>
          </CardHeader>
          {values.aliases.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Alternatif adlar">
              {values.aliases.map((alias) => (
                <li key={alias} className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-card py-1 pr-1 pl-3">
                  {alias}
                  <button
                    type="button"
                    className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-divider focus-visible:outline-2 focus-visible:outline-primary-action"
                    aria-label={`"${alias}" adını kaldır`}
                    onClick={() => set('aliases', values.aliases.filter((item) => item !== alias))}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {aliasErrors.map(([path, message]) => (
            <p key={path} className="text-label-md text-critical">
              {message}
            </p>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <Field id="aliasDraft" label="Yeni ad" error={errors.aliasDraft} className="w-full sm:max-w-sm">
              <Input
                id="aliasDraft"
                value={aliasDraft}
                maxLength={100}
                onChange={(event) => setAliasDraft(event.target.value)}
                onKeyDown={handleAliasKey}
                aria-invalid={Boolean(errors.aliasDraft)}
                aria-describedby={fieldDescriptionIds('aliasDraft', { error: errors.aliasDraft })}
              />
            </Field>
            <Button variant="secondary" onClick={addAlias} disabled={!aliasDraft.trim() || values.aliases.length >= 30}>
              <Plus aria-hidden />
              Ekle
            </Button>
          </div>
        </Card>
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
          <Link href="/products" className={buttonVariants({ variant: 'secondary' })}>
            Vazgeç
          </Link>
        </div>
      ) : null}
    </form>
  );
}
