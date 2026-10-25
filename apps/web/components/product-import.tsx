'use client';

import { describeApiError } from '@ambarci/api-client';
import { findImportDuplicates, hasOpeningStock, PRODUCT_IMPORT_MAX_ROWS, productImportRowSchema } from '@ambarci/shared';
import type { ProductImportResult, ProductImportRow } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWarehouses } from '@/components/use-warehouses';
import { formatDecimal } from '@/lib/format';
import { issuesToFieldErrors } from '@/lib/form-errors';
import { columnTitleOf, ImportFileError, readImportFile, templateCsv } from '@/lib/product-import-file';
import type { ImportCandidate } from '@/lib/product-import-file';

interface RowError {
  field: string;
  message: string;
}

/** Önizlemedeki satır: dosyadan okunan hâli, şemadan geçmişse API'ye gidecek hâli ve hataları. */
interface PreviewRow {
  candidate: ImportCandidate;
  parsed: ProductImportRow | null;
  errors: RowError[];
}

/**
 * Satırları API'nin kullandığı şemayla ve aynı tekrar kontrolüyle doğrular. Kaydetmeden önce hatalar satır satır
 * görünür; API aynı kontrolü bir kez daha yapar ve şirkette zaten kullanılan kodları ekler.
 */
function validate(candidates: ImportCandidate[]): PreviewRow[] {
  const rows: PreviewRow[] = candidates.map((candidate) => {
    const result = productImportRowSchema.safeParse(candidate);
    return {
      candidate,
      parsed: result.success ? result.data : null,
      errors: result.success
        ? []
        : Object.entries(issuesToFieldErrors(result.error.issues)).map(([field, message]) => ({ field, message })),
    };
  });
  for (const duplicate of findImportDuplicates(candidates)) {
    rows[duplicate.index]?.errors.push({ field: duplicate.path.join('.'), message: duplicate.message });
  }
  return rows;
}

function isRowError(value: unknown): value is { row: number; field: string; message: string } {
  const candidate = value as { row?: unknown; field?: unknown; message?: unknown } | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.row === 'number' &&
    typeof candidate.field === 'string' &&
    typeof candidate.message === 'string'
  );
}

function downloadTemplate(): void {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ambarci-urun-sablonu.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/** Excel/CSV ile ürün içe aktarma (yalnızca yönetici). Dosya tarayıcıda okunur (ADR-004). */
export function ProductImport(): JSX.Element {
  return (
    <>
      <Link href="/products" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'self-start' })}>
        <ArrowLeft aria-hidden />
        Ürünler
      </Link>
      <PageHeader
        title="Ürünleri içe aktar"
        description="Excel (.xlsx) ya da CSV dosyasından en fazla 1.000 ürün. Ya bütün satırlar kaydedilir ya hiçbiri."
      />
      <OrganizationGate adminOnly>{() => <ImportFlow />}</OrganizationGate>
    </>
  );
}

function ImportFlow(): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const save = $api.useMutation('post', '/v1/products/import');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [result, setResult] = useState<ProductImportResult | null>(null);
  const [reading, setReading] = useState(false);
  /** Yalnızca geçerli satırlar aktarıldıysa atlanan satırların numaraları (sonuç mesajı için). */
  const [skipped, setSkipped] = useState<number[]>([]);

  const activeWarehouses = warehouses.permitted.filter((warehouse) => warehouse.isActive);
  const selectedWarehouse = warehouseId || activeWarehouses[0]?.id || '';
  const errorCount = preview?.filter((row) => row.errors.length > 0).length ?? 0;
  const needsWarehouse = preview?.some((row) => hasOpeningStock(row.candidate)) ?? false;
  const validCount = (preview?.length ?? 0) - errorCount;
  const shown = useMemo(
    () => (onlyErrors ? (preview ?? []).filter((row) => row.errors.length > 0) : (preview ?? [])),
    [preview, onlyErrors],
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    setFileError(null);
    setFormError(null);
    setResult(null);
    setSkipped([]);
    setPreview(null);
    setFileName(file?.name ?? null);
    if (!file) {
      return;
    }
    setReading(true);
    try {
      const candidates = await readImportFile(file);
      if (candidates.length === 0) {
        setFileError('Dosyada ürün satırı yok.');
      } else if (candidates.length > PRODUCT_IMPORT_MAX_ROWS) {
        setFileError(`Dosyada ${candidates.length} satır var; bir seferde en fazla ${PRODUCT_IMPORT_MAX_ROWS} ürün aktarılabilir.`);
      } else {
        setPreview(validate(candidates));
      }
    } catch (reason) {
      setFileError(
        reason instanceof ImportFileError ? reason.message : 'Dosya okunamadı. Bozuk olabilir; Excel\'de açıp yeniden kaydedin.',
      );
    } finally {
      setReading(false);
    }
  }

  /** API'nin satır hatalarını önizlemedeki satırlara ekler (şirkette zaten kullanılan SKU ve barkodlar). */
  function attachApiErrors(errors: { row: number; field: string; message: string }[]): void {
    setPreview((current) =>
      (current ?? []).map((row) => ({
        ...row,
        errors: [
          ...row.errors,
          ...errors.filter((error) => error.row === row.candidate.row).map(({ field, message }) => ({ field, message })),
        ],
      })),
    );
  }

  /**
   * Satırları API'ye gönderir. `onlyValid` ise hatalı satırlar atlanır ve yalnızca geçerliler gider; gönderilenler için
   * kural yine "ya hepsi ya hiçbiri": API'de bir satır bile reddedilirse hiçbiri kaydedilmez.
   */
  async function handleSave(onlyValid: boolean): Promise<void> {
    if (!preview || (!onlyValid && errorCount > 0)) {
      return;
    }
    const sending = preview.filter((row) => row.errors.length === 0);
    const rows = sending.flatMap((row) => (row.parsed ? [row.parsed] : []));
    if (rows.length === 0) {
      return;
    }
    setFormError(null);
    try {
      const saved = await save.mutateAsync({
        body: { warehouseId: rows.some(hasOpeningStock) ? selectedWarehouse : undefined, rows },
      });
      setResult(saved);
      setSkipped(preview.filter((row) => row.errors.length > 0).map((row) => row.candidate.row));
      setPreview(null);
      setFileName(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/v1/products').queryKey }),
        // Başlangıç stokunun açılış işlemleri Stok sayfasındaki onay bekleyenler listesine girer.
        queryClient.invalidateQueries({ queryKey: ['get', '/v1/operations'] }),
      ]);
    } catch (reason) {
      const failure = describeApiError(reason);
      if (failure.code === 'IMPORT_ROWS_INVALID' && Array.isArray(failure.details)) {
        attachApiErrors(failure.details.filter(isRowError));
        setOnlyErrors(true);
      }
      setFormError(failure.message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Dosyayı hazırla</CardTitle>
          <CardDescription>
            Şablonu indirip Excel&apos;de doldurun; .xlsx ya da .csv olarak kaydedin. Zorunlu sütunlar: SKU, Ürün adı, Ana
            birim. Ondalıklar virgülle yazılabilir (12,5). Alternatif adları dikey çizgiyle ayırın (priz|grup priz).
            Başlangıç stoku ana birimdedir; birim maliyet ana birim başınadır.
          </CardDescription>
        </CardHeader>
        <Button variant="secondary" className="self-start" onClick={downloadTemplate}>
          <Download aria-hidden />
          Şablonu indir (.csv)
        </Button>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Dosyayı seç</CardTitle>
          <CardDescription>Dosya bu tarayıcıda okunur; sunucuya yalnızca doğrulanmış satırlar gider.</CardDescription>
        </CardHeader>
        <Field id="import-file" label="Dosya (.xlsx ya da .csv, en fazla 5 MB)" error={fileError}>
          <Input
            id="import-file"
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => void handleFile(event)}
            disabled={reading || save.isPending}
            className="py-2 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-label-md file:text-primary"
          />
        </Field>
        {reading ? (
          <p aria-live="polite" className="text-text-muted">
            Dosya okunuyor…
          </p>
        ) : null}
      </Card>

      {result ? (
        <Alert variant="applied">
          <p>{result.created} ürün eklendi.</p>
          {skipped.length > 0 ? (
            <p className="mt-1">
              Hatalı {skipped.length} satır atlandı (satır {skipped.join(', ')}). Dosyada düzeltip yeniden yükleyebilirsiniz;
              bu kez eklenenler &quot;şirkette kullanılıyor&quot; diye işaretlenir ve yine atlanabilir.
            </p>
          ) : null}
          {result.openingOperationIds.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              <p>Başlangıç stoku onay bekliyor; stok onaylayınca değişir:</p>
              <ul className="list-disc pl-5">
                {result.openingOperationIds.map((operationId, index) => (
                  <li key={operationId}>
                    <Link href={`/operations/${operationId}`} className="text-body-md-medium underline">
                      Açılış işlemi {index + 1}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Önizleme</CardTitle>
            <CardDescription>
              {fileName}: {preview.length} satır okundu, {preview.length - errorCount} geçerli, {errorCount} hatalı.
              {errorCount > 0 ? ' Hatalı satırları dosyada düzeltip dosyayı yeniden seçin.' : ''}
            </CardDescription>
          </CardHeader>

          {needsWarehouse ? (
            <Field
              id="import-warehouse"
              label="Başlangıç stokunun gireceği depo"
              hint="Bu depo için onay bekleyen açılış işlemi açılır; stok, işlemi onaylayınca değişir."
              className="w-full sm:max-w-sm"
            >
              <NativeSelect
                id="import-warehouse"
                value={selectedWarehouse}
                onChange={(event) => setWarehouseId(event.target.value)}
                aria-describedby="import-warehouse-hint"
              >
                {activeWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          <label className="flex min-h-12 cursor-pointer items-center gap-3 self-start text-body-md-medium">
            <Checkbox checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />
            Yalnızca hatalı satırları göster
          </label>

          <Table aria-label="İçe aktarma önizlemesi">
            <TableHeader>
              <TableRow className="h-auto border-0">
                <TableHead className="w-0">Satır</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Ürün adı</TableHead>
                <TableHead>Ana birim</TableHead>
                <TableHead>Ek birim</TableHead>
                <TableHead>Alternatif adlar</TableHead>
                <TableHead className="text-right">Başlangıç stoku</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <PreviewTableRow key={row.candidate.row} row={row} />
              ))}
            </TableBody>
          </Table>

          {formError ? <Alert>{formError}</Alert> : null}
          {errorCount > 0 && validCount > 0 ? (
            <p className="text-text-muted">
              Hatalı satırları atlayıp yalnızca geçerli {validCount} satırı içe aktarabilirsiniz; hatalı {errorCount} satırı
              düzeltip ayrıca yüklersiniz.
            </p>
          ) : null}
          {needsWarehouse && activeWarehouses.length === 0 ? (
            <Alert>Başlangıç stoku için aktif bir depo yok. Önce Depolar ekranından depo ekleyin.</Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void handleSave(false)}
              disabled={save.isPending || errorCount > 0 || (needsWarehouse && !selectedWarehouse)}
            >
              {save.isPending ? 'Kaydediliyor…' : `${preview.length} ürünü içe aktar`}
            </Button>
            {errorCount > 0 && validCount > 0 ? (
              <Button
                variant="secondary"
                onClick={() => void handleSave(true)}
                disabled={save.isPending || (needsWarehouse && !selectedWarehouse)}
              >
                Yalnızca geçerli {validCount} satırı içe aktar
              </Button>
            ) : null}
            <Link href="/products" className={buttonVariants({ variant: 'secondary' })}>
              Vazgeç
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function PreviewTableRow({ row }: { row: PreviewRow }): JSX.Element {
  const { candidate, errors } = row;
  const unit = candidate.product.units[0];
  return (
    <TableRow className={errors.length > 0 ? 'bg-critical-soft' : undefined}>
      <TableCell className="text-text-muted tabular-nums">{candidate.row}</TableCell>
      <TableCell className="text-body-md-medium tabular-nums">{candidate.product.sku || '—'}</TableCell>
      <TableCell>{candidate.product.name || '—'}</TableCell>
      <TableCell>{candidate.product.baseUnit || '—'}</TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {unit ? `1 ${unit.unit} = ${formatDecimal(unit.factor)} ${candidate.product.baseUnit}` : '—'}
      </TableCell>
      <TableCell>{candidate.product.aliases.join(', ') || '—'}</TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {candidate.openingQuantity ? `${formatDecimal(candidate.openingQuantity)} ${candidate.product.baseUnit}` : '—'}
      </TableCell>
      <TableCell>
        {errors.length === 0 ? (
          <Badge variant="applied">Geçerli</Badge>
        ) : (
          <ul className="flex flex-col gap-1">
            {errors.map((error) => (
              <li key={`${error.field}:${error.message}`} className="text-label-md font-normal text-critical">
                <span className="text-label-md">{columnTitleOf(error.field)}:</span> {error.message}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
    </TableRow>
  );
}
