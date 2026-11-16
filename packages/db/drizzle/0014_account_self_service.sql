ALTER TYPE "public"."email_token_purpose" ADD VALUE 'change_email';--> statement-breakpoint
ALTER TABLE "email_tokens" ADD COLUMN "current_email" text;