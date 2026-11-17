import { ZodError } from "zod";

// Never put prompts, chat text, URLs, credentials or raw upstream bodies in logs.
export function failureReason(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return "invalid_parameters/" + (issue.path.join(".").replace(/[^\w.]/g, "").slice(0, 60) || "root") + "/" + issue.code;
  }
  if (!(error instanceof Error)) return "unknown_error";
  const message = error.message;
  if (/^[\u3400-\u9fff\s，。()（）0-9]{1,80}$/.test(message) ||
      /^(?:Mirror HTTP \d{3}|Public images are pending|Resident database path changed; live data saved in recovery|Invalid resident backup)$/.test(message))
    return message;
  const code = (error as NodeJS.ErrnoException).code ??
    (error.cause as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z_0-9]{1,49}$/.test(code)) return code;
  return /^[A-Za-z]{1,30}Error$/.test(error.name) ? error.name : "operation_failed";
}
