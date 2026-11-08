ALTER TABLE "operations" ADD COLUMN "source_message_id" uuid;--> statement-breakpoint
-- Elle düzeltildi: drizzle-kit "ON DELETE set null" yazıyordu. Bileşik anahtarda bu, mesaj silinince
-- organization_id'yi de boşaltmaya çalışır ve NOT NULL kısıtı silmeyi engellerdi. Kolon listesiyle (PostgreSQL 15+)
-- yalnızca source_message_id boşalır; işlem şirketinde kalır (0006'daki ai_runs_message_fk ile aynı).
ALTER TABLE "operations" ADD CONSTRAINT "operations_source_message_fk" FOREIGN KEY ("organization_id","source_message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE SET NULL ("source_message_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operations_org_source_message_idx" ON "operations" USING btree ("organization_id","source_message_id");--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_source_message_chat" CHECK ("operations"."source_message_id" is null or "operations"."source" = 'CHAT');
