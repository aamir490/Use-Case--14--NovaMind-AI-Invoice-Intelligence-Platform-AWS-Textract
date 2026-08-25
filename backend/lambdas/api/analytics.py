"""
API Lambda — Analytics endpoints

GET /analytics/summary      → totals and KPIs
GET /analytics/risk-trend   → risk scores over time
GET /analytics/vendor-stats → invoice counts and avg risk by vendor
GET /analytics/anomaly-types → breakdown of anomaly types

All data is computed by scanning the current tenant's invoices.
For large datasets, consider a separate aggregation job.

Environment variables (set by CDK):
  INVOICES_TABLE - DynamoDB invoices table name
"""
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import boto3
from boto3.dynamodb.conditions import Key

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.response import success, error, get_tenant_id

INVOICES_TABLE = os.environ.get("INVOICES_TABLE", "invoices")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(INVOICES_TABLE)


def _get_all_invoices(tenant_id: str) -> list:
    """Fetch all invoices for a tenant (paginated internally)."""
    items = []
    kwargs = {"KeyConditionExpression": Key("tenant_id").eq(tenant_id)}
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    return items


def handler(event: dict, context) -> dict:
    try:
        tenant_id = get_tenant_id(event)
        path = event.get("path", "")

        if path.endswith("/summary"):
            return _summary(tenant_id, event)
        elif path.endswith("/risk-trend"):
            return _risk_trend(tenant_id, event)
        elif path.endswith("/vendor-stats"):
            return _vendor_stats(tenant_id, event)
        elif path.endswith("/anomaly-types"):
            return _anomaly_types(tenant_id, event)
        else:
            return _summary(tenant_id, event)

    except ValueError as e:
        return {"statusCode": 400, "body": str(e)}
    except Exception as e:
        print(f"[Analytics] Error: {e}")
        return error("Internal server error", event=event)


def _summary(tenant_id: str, event: dict) -> dict:
    invoices = _get_all_invoices(tenant_id)
    total = len(invoices)
    completed = [i for i in invoices if i.get("status") == "COMPLETED"]

    high_risk = sum(1 for i in completed if i.get("risk_level") == "HIGH")
    medium_risk = sum(1 for i in completed if i.get("risk_level") == "MEDIUM")
    low_risk = sum(1 for i in completed if i.get("risk_level") == "LOW")

    scores = [int(i["risk_score"]) for i in completed if i.get("risk_score") is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else 0

    proc_times = [int(i["processing_time_ms"]) for i in completed if i.get("processing_time_ms")]
    avg_proc_time = round(sum(proc_times) / len(proc_times)) if proc_times else 0

    return success({
        "total_invoices": total,
        "completed_invoices": len(completed),
        "high_risk_count": high_risk,
        "medium_risk_count": medium_risk,
        "low_risk_count": low_risk,
        "average_risk_score": avg_score,
        "average_processing_time_ms": avg_proc_time,
    }, event=event)


def _risk_trend(tenant_id: str, event: dict) -> dict:
    """Return risk scores grouped by day for the last 30 days."""
    invoices = _get_all_invoices(tenant_id)
    completed = [i for i in invoices if i.get("status") == "COMPLETED" and i.get("processed_at")]

    daily: dict = defaultdict(list)
    for inv in completed:
        try:
            day = inv["processed_at"][:10]  # YYYY-MM-DD
            daily[day].append(int(inv.get("risk_score", 0)))
        except (KeyError, ValueError):
            continue

    trend = sorted([
        {"date": day, "avg_risk_score": round(sum(scores) / len(scores), 1), "count": len(scores)}
        for day, scores in daily.items()
    ], key=lambda x: x["date"])

    return success({"trend": trend}, event=event)


def _vendor_stats(tenant_id: str, event: dict) -> dict:
    invoices = _get_all_invoices(tenant_id)
    completed = [i for i in invoices if i.get("status") == "COMPLETED"]

    vendor_data: dict = defaultdict(lambda: {"count": 0, "risk_scores": []})
    for inv in completed:
        vendor = inv.get("vendor_name") or "Unknown"
        vendor_data[vendor]["count"] += 1
        if inv.get("risk_score") is not None:
            vendor_data[vendor]["risk_scores"].append(int(inv["risk_score"]))

    stats = sorted([
        {
            "vendor": vendor,
            "invoice_count": data["count"],
            "avg_risk_score": round(sum(data["risk_scores"]) / len(data["risk_scores"]), 1)
            if data["risk_scores"] else 0,
        }
        for vendor, data in vendor_data.items()
    ], key=lambda x: x["avg_risk_score"], reverse=True)

    return success({"vendors": stats}, event=event)


def _anomaly_types(tenant_id: str, event: dict) -> dict:
    invoices = _get_all_invoices(tenant_id)
    counts: dict = defaultdict(int)

    for inv in invoices:
        for anomaly in inv.get("anomalies", []):
            atype = anomaly.get("type", "OTHER")
            counts[atype] += 1

    breakdown = sorted([
        {"type": t, "count": c}
        for t, c in counts.items()
    ], key=lambda x: x["count"], reverse=True)

    return success({"anomaly_types": breakdown}, event=event)
