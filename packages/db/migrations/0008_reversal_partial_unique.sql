-- Ters kayıt (#78): bir işlemin en fazla bir etkin ters kaydı olur. Önceki tam tekillik kısıtı iptal edilen ya da
-- süresi dolan ters kaydı da saydığı için işlem bir daha geri alınamazdı. Kısmi indeks yalnızca etkin ters kayıtları
-- (onay bekleyen, uygulanmış) sayar. İki ifade migration'ın tek transaction'ında çalışır: arada kısıtsız an kalmaz.
ALTER TABLE "operations" DROP CONSTRAINT "operations_org_reversed_operation_key";--> statement-breakpoint
CREATE UNIQUE INDEX "operations_org_reversed_operation_active_key" ON "operations" USING btree ("organization_id","reversed_operation_id") WHERE "operations"."status" not in ('CANCELLED', 'EXPIRED', 'FAILED');
