CREATE TYPE "public"."conversation_channel" AS ENUM('APP');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('USER', 'ASSISTANT', 'TOOL');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"message_id" uuid,
	"round_no" smallint NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"effort" text,
	"tool_calls" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"first_token_ms" integer,
	"cost_usd" numeric(12, 8) NOT NULL,
	"stop_reason" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_round_no_positive" CHECK ("ai_runs"."round_no" >= 1),
	CONSTRAINT "ai_runs_model_not_blank" CHECK (length(trim("ai_runs"."model")) > 0),
	CONSTRAINT "ai_runs_prompt_version_not_blank" CHECK (length(trim("ai_runs"."prompt_version")) > 0),
	CONSTRAINT "ai_runs_tokens_non_negative" CHECK (least("ai_runs"."input_tokens", "ai_runs"."output_tokens", "ai_runs"."cache_read_input_tokens", "ai_runs"."cache_creation_input_tokens") >= 0),
	CONSTRAINT "ai_runs_durations_non_negative" CHECK ("ai_runs"."duration_ms" >= 0 and "ai_runs"."first_token_ms" >= 0),
	CONSTRAINT "ai_runs_cost_non_negative" CHECK ("ai_runs"."cost_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "conversation_channel" DEFAULT 'APP' NOT NULL,
	"title" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_org_id_user_key" UNIQUE("organization_id","id","user_id"),
	CONSTRAINT "conversations_title_length" CHECK (char_length("conversations"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"client_message_id" uuid,
	"status" "message_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "messages_org_conversation_position_key" UNIQUE("organization_id","conversation_id","position"),
	CONSTRAINT "messages_org_conversation_client_message_key" UNIQUE("organization_id","conversation_id","client_message_id"),
	CONSTRAINT "messages_position_positive" CHECK ("messages"."position" >= 1),
	CONSTRAINT "messages_content_blocks" CHECK (case when jsonb_typeof("messages"."content") = 'array' then jsonb_array_length("messages"."content") > 0 else false end),
	CONSTRAINT "messages_client_message_id_user" CHECK (("messages"."role" = 'USER') = ("messages"."client_message_id" is not null)),
	CONSTRAINT "messages_status_user" CHECK (("messages"."role" = 'USER') = ("messages"."status" is not null))
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Elle düzeltildi: drizzle-kit "ON DELETE set null" yazıyordu. Bileşik anahtarda bu, mesaj silinince
-- organization_id'yi de boşaltmaya çalışır ve NOT NULL kısıtı silmeyi engellerdi. Kolon listesiyle (PostgreSQL 15+)
-- yalnızca message_id boşalır; kayıt şirketinde kalır.
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("organization_id","conversation_id","user_id") REFERENCES "public"."conversations"("organization_id","id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_org_created_idx" ON "ai_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_user_created_idx" ON "ai_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_org_message_idx" ON "ai_runs" USING btree ("organization_id","message_id");--> statement-breakpoint
CREATE INDEX "conversations_user_org_last_message_idx" ON "conversations" USING btree ("user_id","organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_fk_idx" ON "messages" USING btree ("organization_id","conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "product_aliases_org_alias_trgm_idx" ON "product_aliases" USING gin ("organization_id",private.fold_search("alias") extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_org_name_trgm_idx" ON "products" USING gin ("organization_id",private.fold_search("name") extensions.gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "ai_runs_select_admin" ON "ai_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("ai_runs"."organization_id" in (select private.admin_organization_ids()));--> statement-breakpoint
CREATE POLICY "conversations_select_owner" ON "conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("conversations"."user_id" = (select auth.uid()) and "conversations"."organization_id" in (select private.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "messages_select_owner" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("messages"."user_id" = (select auth.uid()) and "messages"."organization_id" in (select private.user_organization_ids()));