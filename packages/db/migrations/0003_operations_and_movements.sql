CREATE TYPE "public"."action_source" AS ENUM('SCREEN', 'CHAT', 'DOCUMENT', 'IMPORT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('IN', 'OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_SURPLUS', 'COUNT_SHORTAGE', 'WASTE', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('RECEIVED', 'NEEDS_CLARIFICATION', 'PENDING_CONFIRMATION', 'APPLIED', 'REVERSED', 'CANCELLED', 'EXPIRED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."operation_type" AS ENUM('STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING', 'REVERSAL');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" "action_source" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_action_format" CHECK ("audit_logs"."action" ~ '^[a-z_]+[.][a-z_]+$'),
	CONSTRAINT "audit_logs_entity_type_format" CHECK ("audit_logs"."entity_type" ~ '^[a-z_]+$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity_change" numeric(14, 3) NOT NULL,
	"unit_factor" numeric(14, 6) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"quantity_after" numeric(14, 3) NOT NULL,
	"average_cost_after" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "inventory_movements_line_warehouse_key" UNIQUE("organization_id","operation_id","line_no","warehouse_id"),
	CONSTRAINT "inventory_movements_direction" CHECK (("inventory_movements"."type" in ('IN', 'TRANSFER_IN', 'COUNT_SURPLUS') and "inventory_movements"."quantity_change" > 0)
        or ("inventory_movements"."type" in ('OUT', 'TRANSFER_OUT', 'COUNT_SHORTAGE', 'WASTE') and "inventory_movements"."quantity_change" < 0)
        or ("inventory_movements"."type" = 'REVERSAL' and "inventory_movements"."quantity_change" <> 0)),
	CONSTRAINT "inventory_movements_unit_factor_positive" CHECK ("inventory_movements"."unit_factor" > 0),
	CONSTRAINT "inventory_movements_unit_cost_non_negative" CHECK ("inventory_movements"."unit_cost" >= 0),
	CONSTRAINT "inventory_movements_quantity_after_non_negative" CHECK ("inventory_movements"."quantity_after" >= 0),
	CONSTRAINT "inventory_movements_average_cost_after_non_negative" CHECK ("inventory_movements"."average_cost_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"system_quantity" numeric(14, 3) NOT NULL,
	"counted_quantity" numeric(14, 3) NOT NULL,
	"difference" numeric(14, 3) GENERATED ALWAYS AS ("counted_quantity" - "system_quantity") STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_org_operation_line_key" UNIQUE("organization_id","operation_id","line_no"),
	CONSTRAINT "stock_counts_system_quantity_non_negative" CHECK ("stock_counts"."system_quantity" >= 0),
	CONSTRAINT "stock_counts_counted_quantity_non_negative" CHECK ("stock_counts"."counted_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"target_warehouse_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text,
	"unit_cost" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_items_org_operation_line_key" UNIQUE("organization_id","operation_id","line_no"),
	CONSTRAINT "operation_items_line_no_positive" CHECK ("operation_items"."line_no" >= 1),
	CONSTRAINT "operation_items_quantity_non_negative" CHECK ("operation_items"."quantity" >= 0),
	CONSTRAINT "operation_items_unit_cost_non_negative" CHECK ("operation_items"."unit_cost" >= 0),
	CONSTRAINT "operation_items_transfer_target_differs" CHECK ("operation_items"."target_warehouse_id" <> "operation_items"."warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "operation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "operation_type" NOT NULL,
	"status" "operation_status" DEFAULT 'PENDING_CONFIRMATION' NOT NULL,
	"source" "action_source" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"party_id" uuid,
	"note" text,
	"reversed_operation_id" uuid,
	"apply_idempotency_key" text,
	"created_by" uuid,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "operations_org_idempotency_key" UNIQUE("organization_id","apply_idempotency_key"),
	CONSTRAINT "operations_org_reversed_operation_key" UNIQUE("organization_id","reversed_operation_id"),
	CONSTRAINT "operations_version_positive" CHECK ("operations"."version" >= 1),
	CONSTRAINT "operations_note_length" CHECK (char_length("operations"."note") <= 500),
	CONSTRAINT "operations_idempotency_key_length" CHECK (char_length("operations"."apply_idempotency_key") between 1 and 200),
	CONSTRAINT "operations_reversal_link" CHECK (("operations"."type" = 'REVERSAL') = ("operations"."reversed_operation_id" is not null)),
	CONSTRAINT "operations_not_self_reversal" CHECK ("operations"."reversed_operation_id" <> "operations"."id"),
	CONSTRAINT "operations_applied_at" CHECK (("operations"."status" in ('APPLIED', 'REVERSED')) = ("operations"."applied_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_event_type_format" CHECK ("outbox_events"."event_type" ~ '^[a-z_]+[.][a-z_]+$'),
	CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Elle öne alındı: drizzle-kit bu kısıtı en sona yazıyordu, ama operations_party_fk ona dayanıyor.
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_fk" FOREIGN KEY ("organization_id","operation_id","line_no") REFERENCES "public"."operation_items"("organization_id","operation_id","line_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_fk" FOREIGN KEY ("organization_id","warehouse_id","product_id") REFERENCES "public"."inventory"("organization_id","warehouse_id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_item_fk" FOREIGN KEY ("organization_id","operation_id","line_no") REFERENCES "public"."operation_items"("organization_id","operation_id","line_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_inventory_fk" FOREIGN KEY ("organization_id","warehouse_id","product_id") REFERENCES "public"."inventory"("organization_id","warehouse_id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_operation_fk" FOREIGN KEY ("organization_id","operation_id") REFERENCES "public"."operations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_unit_fk" FOREIGN KEY ("organization_id","product_id","unit") REFERENCES "public"."product_units"("organization_id","product_id","unit") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_target_warehouse_fk" FOREIGN KEY ("organization_id","target_warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_party_fk" FOREIGN KEY ("organization_id","party_id") REFERENCES "public"."parties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_reversed_operation_fk" FOREIGN KEY ("organization_id","reversed_operation_id") REFERENCES "public"."operations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_entity_idx" ON "audit_logs" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_warehouse_product_idx" ON "inventory_movements" USING btree ("organization_id","warehouse_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_product_idx" ON "inventory_movements" USING btree ("organization_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_counts_org_warehouse_product_idx" ON "stock_counts" USING btree ("organization_id","warehouse_id","product_id");--> statement-breakpoint
CREATE INDEX "operation_items_org_product_unit_idx" ON "operation_items" USING btree ("organization_id","product_id","unit");--> statement-breakpoint
CREATE INDEX "operation_items_org_warehouse_idx" ON "operation_items" USING btree ("organization_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "operation_items_org_target_warehouse_idx" ON "operation_items" USING btree ("organization_id","target_warehouse_id");--> statement-breakpoint
CREATE INDEX "operations_org_status_created_idx" ON "operations" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "operations_org_party_idx" ON "operations" USING btree ("organization_id","party_id");--> statement-breakpoint
CREATE INDEX "operations_created_by_idx" ON "operations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "operations_applied_by_idx" ON "operations" USING btree ("applied_by");--> statement-breakpoint
CREATE INDEX "outbox_events_organization_id_idx" ON "outbox_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."processed_at" is null;--> statement-breakpoint
CREATE POLICY "audit_logs_select_admin" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("audit_logs"."organization_id" in (select private.admin_organization_ids()));--> statement-breakpoint
CREATE POLICY "inventory_movements_select_member" ON "inventory_movements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("inventory_movements"."organization_id" in (select private.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "stock_counts_select_member" ON "stock_counts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("stock_counts"."organization_id" in (select private.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "operation_items_select_member" ON "operation_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("operation_items"."organization_id" in (select private.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "operations_select_member" ON "operations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("operations"."organization_id" in (select private.user_organization_ids()));