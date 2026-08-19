export class HarmanError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

export class ValidationError extends HarmanError {
  constructor(message, details) {
    super('VALIDATION_ERROR', message, details)
  }
}

export class ConflictError extends HarmanError {
  constructor(message, details) {
    super('CONFLICT', message, details)
  }
}

export class NotFoundError extends HarmanError {
  constructor(message, details) {
    super('NOT_FOUND', message, details)
  }
}

export class StateBusyError extends HarmanError {
  constructor(message, details) {
    super('STATE_BUSY', message, details)
  }
}

export class UnsupportedSchemaError extends HarmanError {
  constructor(message, details) {
    super('UNSUPPORTED_SCHEMA', message, details)
  }
}

export class StaleRevisionError extends HarmanError {
  constructor(expected, actual) {
    super('STALE_REVISION', `state revision changed: expected ${expected}, found ${actual}`, { expected, actual })
  }
}
