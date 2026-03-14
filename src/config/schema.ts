import { z } from "zod";

const envVarRefOrLiteral = z.string().transform((val, ctx) => {
  if (val.startsWith("$")) {
    const envKey = val.slice(1);
    const resolved = process.env[envKey];
    if (!resolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `env var ${envKey} is not set (referenced as ${val})`,
      });
      return z.NEVER;
    }
    return resolved;
  }
  return val;
});

export const AccountSchema = z.object({
  name: z.string().min(1, "account name is required"),
  host: z.string().min(1, "host is required"),
  port: z
    .number()
    .int()
    .refine((p) => p === 993, {
      message: "port must be 993 (TLS/SSL enforced; plain-text IMAP is rejected)",
    }),
  username: z.string().min(1, "username is required"),
  password: envVarRefOrLiteral,
  display_name: z.string().optional(),
});

export const AppConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, "at least one account is required"),
  polling: z
    .object({
      interval_seconds: z.number().int().positive().optional(),
    })
    .optional(),
});
