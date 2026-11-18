import { ZodError } from "zod";

const fieldTypes: Record<string, string> = {
  string: "文字", number: "数字", int: "整数", boolean: "true 或 false", array: "列表", object: "一组具名参数",
};

// Receipts are read by the resident. Keep the separate diagnostic code for operators.
export function actionProblem(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue.path.join(".") || "参数";
    const units: Record<string, string> = { string: " 个字符", array: " 项", tuple: " 项" };
    const unit = "origin" in issue ? units[issue.origin] ?? "" : "";
    if (/^[\u3400-\u9fff]/.test(issue.message))
      return field + "：" + issue.message;
    switch (issue.code) {
      case "invalid_type": return field + " 需要填写" + (fieldTypes[issue.expected] ?? "有效值");
      case "invalid_value": return field + " 可选 " + issue.values.join("、");
      case "unrecognized_keys": return field + " 不接受 " + issue.keys.join("、");
      case "too_small": return field + (issue.inclusive ? " 至少为 " : " 须大于 ") + issue.minimum + unit;
      case "too_big": return field + (issue.inclusive ? " 最多为 " : " 须小于 ") + issue.maximum + unit;
      default: return "请检查 " + field + " 的写法";
    }
  }
  if (error instanceof Error && error.name === "Error" && !("code" in error) && !/^(?:D1_|SQLITE_)/.test(error.message) &&
      /^[^\r\n]*[\u3400-\u9fff][^\r\n]*$/.test(error.message)) return error.message.slice(0, 240);
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "这次等待太久，可以稍后再试。";
  return "暂时无法完成，可以稍后再试。";
}

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
