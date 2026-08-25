export type ToolCallDelta = {
  readonly index?: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type DiagnosticCode =
  | "ambiguous-identity"
  | "argument-limit"
  | "call-limit"
  | "conflicting-id"
  | "conflicting-index"
  | "conflicting-name"
  | "diagnostic-limit"
  | "invalid-delta"
  | "invalid-json"
  | "incomplete-json"
  | "missing-identity"
  | "schema-invalid"
  | "stream-finished";

export type ToolCallDiagnostic = {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly severity: "warning" | "error";
  readonly callKey?: string;
  readonly deltaNumber: number;
};

export type JsonState =
  | { readonly status: "empty" }
  | { readonly status: "valid"; readonly value: unknown }
  | { readonly status: "incomplete" }
  | { readonly status: "invalid"; readonly error: string };

export type ToolCallStatus =
  | "streaming"
  | "complete"
  | "incomplete"
  | "invalid"
  | "ambiguous"
  | "truncated";

export type ToolCallSnapshot = {
  readonly key: string;
  readonly sequence: number;
  readonly indexes: readonly number[];
  readonly ids: readonly string[];
  readonly name?: string;
  readonly arguments: string;
  readonly json: JsonState;
  readonly status: ToolCallStatus;
  readonly sources: readonly string[];
  readonly metadata: readonly Readonly<Record<string, unknown>>[];
  readonly diagnostics: readonly ToolCallDiagnostic[];
};

export type StreamSnapshot = {
  readonly finished: boolean;
  readonly deltaCount: number;
  readonly calls: readonly ToolCallSnapshot[];
  readonly diagnostics: readonly ToolCallDiagnostic[];
};

export type ToolCallEvent =
  | { readonly type: "call-created"; readonly call: ToolCallSnapshot }
  | { readonly type: "call-updated"; readonly call: ToolCallSnapshot }
  | { readonly type: "diagnostic"; readonly diagnostic: ToolCallDiagnostic };

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly message?: string };

export type ToolCallStreamOptions = {
  readonly maxCalls?: number;
  readonly maxArgumentBytes?: number;
  readonly maxDiagnostics?: number;
  readonly emptyArguments?: "object" | "preserve";
  readonly validate?: (
    value: unknown,
    call: Omit<ToolCallSnapshot, "json" | "diagnostics">,
  ) => ValidationResult;
};

export type FinishOptions = {
  readonly reason?: "end" | "cancelled" | "error";
};

export type ToolCallStream = {
  readonly push: (delta: ToolCallDelta) => readonly ToolCallEvent[];
  readonly finish: (options?: FinishOptions) => StreamSnapshot;
  readonly snapshot: () => StreamSnapshot;
  readonly reset: () => void;
};
