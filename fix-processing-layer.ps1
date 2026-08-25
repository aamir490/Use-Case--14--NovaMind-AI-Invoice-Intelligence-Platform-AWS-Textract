$zipPath = "C:\Users\aamir\AppData\Local\Temp\shared-layer-v2.zip"

Write-Host "Publishing layer for processing stack..."
$json = aws lambda publish-layer-version --layer-name invoice-shared-dev --description "Shared layer" --compatible-runtimes python3.12 --zip-file fileb://$zipPath
$result = $json | ConvertFrom-Json
$newArn = $result.LayerVersionArn
Write-Host "New ARN: $newArn"

$functions = "invoice-ocr-dev","invoice-ai-analysis-dev","invoice-risk-scoring-dev","invoice-store-results-dev","invoice-sqs-trigger-dev"

foreach ($fn in $functions) {
    Write-Host "Updating $fn ..."
    aws lambda update-function-configuration --function-name $fn --layers $newArn | Out-Null
    aws lambda wait function-updated --function-name $fn
    Write-Host "  done"
}

Write-Host "All processing Lambdas updated."
