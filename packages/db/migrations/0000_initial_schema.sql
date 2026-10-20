CREATE TYPE "public"."alias_source" AS ENUM('MANUAL', 'LEARNED');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('ADMIN', 'EMPLOYEE');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('SUPPLIER', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('WAREHOUSE', 'BRANCH', 'VEHICLE');--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "party_type" NOT NULL,
	"tax_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_org_tax_id_key" UNIQUE("organization_id","tax_id"),
	CONSTRAINT "parties_name_not_blank" CHECK (length(trim("parties"."name")) > 0),
	CONSTRAINT "parties_tax_id_format" CHECK ("parties"."tax_id" ~ '^[0-9]{10,11}$')
);
--> statement-breakpoint
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"source" "alias_source" DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_aliases_product_alias_key" UNIQUE("organization_id","product_id","alias"),
	CONSTRAINT "product_aliases_alias_not_blank" CHECK (length(trim("product_aliases"."alias")) > 0)
);
--> statement-breakpoint
ALTER TABLE "product_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"factor" numeric(14, 6) NOT NULL,
	"barcode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_units_product_unit_key" UNIQUE("organization_id","product_id","unit"),
	CONSTRAINT "product_units_org_barcode_key" UNIQUE("organization_id","barcode"),
	CONSTRAINT "product_units_unit_not_blank" CHECK (length(trim("product_units"."unit")) > 0),
	CONSTRAINT "product_units_factor_positive" CHECK ("product_units"."factor" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"min_stock" numeric(14, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_sku_key" UNIQUE("organization_id","sku"),
	CONSTRAINT "products_org_barcode_key" UNIQUE("organization_id","barcode"),
	CONSTRAINT "products_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "products_sku_not_blank" CHECK (length(trim("products"."sku")) > 0),
	CONSTRAINT "products_name_not_blank" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_min_stock_non_negative" CHECK ("products"."min_stock" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '0' NOT NULL,
	"average_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_org_warehouse_product_key" UNIQUE("organization_id","warehouse_id","product_id"),
	CONSTRAINT "inventory_quantity_non_negative" CHECK ("inventory"."quantity" >= 0),
	CONSTRAINT "inventory_average_cost_non_negative" CHECK ("inventory"."average_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_code_key" UNIQUE("code"),
	CONSTRAINT "invitations_code_min_length" CHECK (char_length("invitations"."code") >= 8),
	CONSTRAINT "invitations_used_by_requires_used_at" CHECK ("invitations"."used_by" is null or "invitations"."used_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" DEFAULT 'EMPLOYEE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_users_org_user_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_users_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "organization_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_not_blank" CHECK (length(trim("organizations"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_warehouse_access" (
	"organization_id" uuid NOT NULL,
	"organization_user_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY("organization_id","organization_user_id","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "warehouse_type" DEFAULT 'WAREHOUSE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_org_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "warehouses_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "warehouses_name_not_blank" CHECK (length(trim("warehouses"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_member_fk" FOREIGN KEY ("organization_id","organization_user_id") REFERENCES "public"."organization_users"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_org_name_idx" ON "parties" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "product_aliases_org_alias_idx" ON "product_aliases" USING btree ("organization_id","alias");--> statement-breakpoint
CREATE INDEX "inventory_org_product_idx" ON "inventory" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "invitations_organization_id_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_created_by_idx" ON "invitations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "invitations_used_by_idx" ON "invitations" USING btree ("used_by");--> statement-breakpoint
CREATE INDEX "organization_users_user_id_idx" ON "organization_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_warehouse_access_warehouse_idx" ON "user_warehouse_access" USING btree ("organization_id","warehouse_id");