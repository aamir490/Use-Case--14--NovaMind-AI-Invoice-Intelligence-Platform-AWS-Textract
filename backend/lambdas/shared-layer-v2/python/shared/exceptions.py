"""
Custom exceptions for the Invoice Intelligence Platform.
"""


class InvoiceProcessingError(Exception):
    """Raised when invoice processing fails at any stage."""
    pass


class OCRError(InvoiceProcessingError):
    """Raised when Textract fails to process the invoice."""
    pass


class AIAnalysisError(InvoiceProcessingError):
    """Raised when Bedrock AI analysis fails."""
    pass


class UnsupportedFileTypeError(InvoiceProcessingError):
    """Raised when an unsupported file type is uploaded."""
    pass


class TenantAuthorizationError(Exception):
    """Raised when a user tries to access another tenant's data."""
    pass


class InvoiceNotFoundError(Exception):
    """Raised when an invoice does not exist."""
    pass


class RateLimitExceededError(InvoiceProcessingError):
    """Raised when Bedrock API rate limit is exhausted after retries."""
    pass
