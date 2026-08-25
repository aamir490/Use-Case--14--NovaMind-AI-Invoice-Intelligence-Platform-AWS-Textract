"""
Shared Pydantic data models used across all Lambda functions.
"""
from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
from enum import Enum
import uuid
from datetime import datetime


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class AnomalySeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class AnomalyType(str, Enum):
    MATH_ERROR = "MATH_ERROR"
    DATE_INCONSISTENCY = "DATE_INCONSISTENCY"
    UNUSUAL_PRICE = "UNUSUAL_PRICE"
    NON_STANDARD_FORMAT = "NON_STANDARD_FORMAT"
    TAX_IRREGULARITY = "TAX_IRREGULARITY"
    DUPLICATE_ITEM = "DUPLICATE_ITEM"
    MISSING_FIELD = "MISSING_FIELD"
    OTHER = "OTHER"


class ProcessingStatus(str, Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class LineItem(BaseModel):
    item: str
    price: str
    quantity: Optional[str] = None


class Anomaly(BaseModel):
    type: AnomalyType
    severity: AnomalySeverity
    description: str
    field: Optional[str] = None


class Invoice(BaseModel):
    tenant_id: str
    invoice_id: str
    invoice_number: Optional[str] = None
    vendor_name: Optional[str] = None
    due_date: Optional[str] = None
    receipt_date: Optional[str] = None
    total_amount: Optional[str] = None
    currency: Optional[str] = "USD"
    status: ProcessingStatus = ProcessingStatus.PENDING
    risk_score: Optional[int] = None
    risk_level: Optional[RiskLevel] = None
    line_items: List[LineItem] = Field(default_factory=list)
    anomalies: List[Anomaly] = Field(default_factory=list)
    ai_explanation: Optional[str] = None
    s3_key: Optional[str] = None
    processed_text_s3_key: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    processed_at: Optional[str] = None
    processing_time_ms: Optional[int] = None
    raw_textract_response: Optional[dict] = None


class ProcessingJob(BaseModel):
    job_id: str
    invoice_id: str
    tenant_id: str
    status: ProcessingStatus = ProcessingStatus.PENDING
    stage: Optional[str] = None
    error_message: Optional[str] = None
    started_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class AIAnalysisResult(BaseModel):
    anomalies: List[Anomaly] = Field(default_factory=list)
    summary: str = ""
    confidence: float = 0.0


class PipelinePayload(BaseModel):
    """
    Passed between Step Functions states.
    Each Lambda reads this, adds its output, and returns it.
    """
    invoice_id: str
    tenant_id: str
    s3_key: str
    job_id: str
    # Populated by OCR Lambda
    ocr_data: Optional[dict] = None
    # Populated by AI Analysis Lambda
    ai_result: Optional[dict] = None
    # Populated by Risk Scoring Lambda
    risk_score: Optional[int] = None
    risk_level: Optional[str] = None
