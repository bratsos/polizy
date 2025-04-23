/**
 * Base class for all errors originating from the Polizy system.
 */
export class PolizyError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = "PolizyError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PolizyError);
    }
  }
}

/**
 * Error thrown when there is an issue with the authorization schema configuration.
 */
export class SchemaError extends PolizyError {
  constructor(message: string) {
    super(message);
    this.name += "::SchemaError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SchemaError);
    }
  }
}

/**
 * Error thrown when there is an issue with the system configuration
 * (e.g., missing storage adapter).
 */
export class ConfigurationError extends PolizyError {
  constructor(message: string) {
    super(message);
    this.name += "::ConfigurationError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigurationError);
    }
  }
}

/**
 * Error thrown when an operation fails within the storage adapter.
 * Storage adapters should wrap their specific errors in this type.
 */
export class StorageError extends PolizyError {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name += "::StorageError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError);
    }
  }
}

/**
 * Error thrown when the maximum recursion depth is exceeded during a check.
 */
export class MaxDepthExceededError extends PolizyError {
  public subject: { type: string; id: string };
  public action: string;
  public object: { type: string; id: string };
  public depth: number;

  constructor(
    message: string,
    subject: { type: string; id: string },
    action: string,
    object: { type: string; id: string },
    depth: number,
  ) {
    super(message);
    this.name += "::MaxDepthExceededError";
    this.subject = subject;
    this.action = action;
    this.object = object;
    this.depth = depth;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MaxDepthExceededError);
    }
  }
}
