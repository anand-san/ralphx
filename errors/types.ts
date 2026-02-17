import type { FailureCategory } from "../state/types";

export interface RalphxError {
  category: FailureCategory;
  message: string;
  details?: string;
  recoverable: boolean;
  suggestedAction?: string;
}

export class RalphxRuntimeError extends Error {
  category: FailureCategory;
  recoverable: boolean;
  suggestedAction?: string;

  constructor(params: {
    category: FailureCategory;
    message: string;
    recoverable: boolean;
    suggestedAction?: string;
  }) {
    super(params.message);
    this.name = "RalphxRuntimeError";
    this.category = params.category;
    this.recoverable = params.recoverable;
    this.suggestedAction = params.suggestedAction;
  }
}
