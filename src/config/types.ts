import { z } from "zod";
import { AccountSchema, AppConfigSchema } from "./schema.js";

export type AccountConfig = z.infer<typeof AccountSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
