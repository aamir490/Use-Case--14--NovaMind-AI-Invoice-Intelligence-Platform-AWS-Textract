$since = [DateTimeOffset]::UtcNow.AddMinutes(-3).ToUnixTimeMilliseconds()

$groups = @(
    "/aws/lambda/invoice-api-upload-dev",
    "/aws/lambda/invoice-sqs-trigger-dev",
    "/aws/lambda/invoice-ocr-dev",
    "/aws/lambda/invoice-ai-analysis-dev",
    "/aws/lambda/invoice-risk-scoring-dev",
    "/aws/lambda/invoice-store-results-dev",
    "/aws/states/invoice-pipeline-dev"
)

foreach ($g in $groups) {
    $label = $g.Split("/")[-1]
    $msgs = aws logs filter-log-events --log-group-name $g --start-time $since --query "events[*].message" --output text 2>&1
    if ($msgs -and $msgs.Trim() -ne "") {
        Write-Host "=== $label ===" -ForegroundColor Cyan
        Write-Host $msgs
    }
}
